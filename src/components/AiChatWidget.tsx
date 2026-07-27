// src/components/AiChatWidget.tsx
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AI_STREAMING, AI_TIMEOUT_MS } from "@/lib/featureFlags";
import { Bot, Send, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
// Sourced directly from the edge function's own FAQ corpus so the example
// chips are guaranteed to hit the direct-answer tier — no separate copy to
// drift out of sync.
import { FAQ_ENTRIES } from "../../supabase/functions/_shared/faq";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const ALLOWED_WIDGET_ROLES = ["admin", "pharmacist", "fms", "mo", "super_admin"];

function buildRoleExamples(): Record<string, string[]> {
  const examples: Record<string, string[]> = {};
  for (const role of ALLOWED_WIDGET_ROLES) {
    examples[role] = FAQ_ENTRIES.filter((e) => e.roles.includes(role)).slice(0, 3).map((e) => e.aliases[0]);
  }
  return examples;
}
const ROLE_EXAMPLES = buildRoleExamples();

const PROGRESS_THRESHOLD_MS = 6000;

export default function AiChatWidget() {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isAllowed = !!role && ALLOWED_WIDGET_ROLES.includes(role);
  const examples = role ? (ROLE_EXAMPLES[role] ?? []) : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function consumeStream(body: ReadableStream<Uint8Array>) {
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const raw of events) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as { delta?: string };
          if (evt.delta) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + evt.delta };
              return next;
            });
          }
        } catch {
          // Skip a malformed chunk rather than aborting the whole stream
        }
      }
    }
  }

  async function sendMessage() {
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    setRateLimitMsg(null);
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);
    setElapsedMs(0);

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    const progressStartedAt = Date.now();
    const progressTimer = setInterval(() => setElapsedMs(Date.now() - progressStartedAt), 1000);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token ?? "";

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-query`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ question: q, stream: AI_STREAMING }),
          signal: controller.signal,
        }
      );

      if (resp.status === 429) {
        const data = await resp.json().catch(() => ({} as { retry_after_seconds?: number }));
        const retryAfter = data.retry_after_seconds;
        setRateLimitMsg(
          retryAfter
            ? `You've reached the query limit. Try again in ${Math.max(1, Math.ceil(retryAfter / 60))} minute(s).`
            : "You've reached the query limit. Please try again later."
        );
        return;
      }

      if (resp.status === 504) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "The assistant is taking longer than expected — your clinic's server may be under load. Please try again." },
        ]);
        return;
      }

      if (!resp.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Something went wrong. Please try again." },
        ]);
        return;
      }

      const contentType = resp.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && resp.body) {
        await consumeStream(resp.body);
      } else {
        const data = await resp.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.answer ?? "No response received." },
        ]);
      }
    } catch {
      if (controller.signal.aborted) {
        setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled." }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Network error. Please check your connection." },
        ]);
      }
    } finally {
      clearTimeout(timeoutId);
      clearInterval(progressTimer);
      abortRef.current = null;
      setLoading(false);
      setElapsedMs(0);
    }
  }

  function cancelMessage() {
    abortRef.current?.abort();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  if (!isAllowed) return null;

  return (
    <>
      {/* Floating button */}
      <button
        aria-label="Ask AI"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary shadow-lg hover:bg-primary/90 transition-colors"
      >
        <Bot className="h-5 w-5 text-primary-foreground" />
      </button>

      {/* Slide-up panel */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="w-full h-[500px] flex flex-col p-0">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Bot className="h-4 w-4" />
              Pharmacy AI Assistant
            </SheetTitle>
          </SheetHeader>

          <ScrollArea className="flex-1 px-4 py-3">
            {messages.length === 0 && (
              <div className="text-sm text-muted-foreground mt-6 space-y-3">
                <div className="text-center space-y-1">
                  <Bot className="h-8 w-8 mx-auto opacity-30" />
                  <p>Ask me about your pharmacy data, or how to use PharmaSync.</p>
                </div>
                <div className="space-y-1.5">
                  {examples.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(ex)}
                      className="w-full text-left text-xs px-3 py-2 rounded-md border border-border bg-muted/40 hover:bg-muted transition-colors"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2 text-sm flex flex-col gap-1 text-muted-foreground max-w-[85%]">
                    <div className="flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Thinking...
                    </div>
                    {elapsedMs >= PROGRESS_THRESHOLD_MS && (
                      <p className="text-xs">
                        Still working ({Math.round(elapsedMs / 1000)}s) — the assistant runs on your clinic's own
                        server, so answers take a little longer.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div ref={bottomRef} />
          </ScrollArea>

          <div className="border-t px-4 py-3 space-y-2">
            {rateLimitMsg && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                {rateLimitMsg}
              </p>
            )}
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 500))}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                className="resize-none min-h-[60px] text-sm"
                disabled={loading}
              />
              {loading ? (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={cancelMessage}
                  className="h-auto self-end"
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className="h-auto self-end"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-right text-xs text-muted-foreground">
              {input.length} / 500
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
