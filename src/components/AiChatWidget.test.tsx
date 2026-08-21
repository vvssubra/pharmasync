import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AiChatWidget from "./AiChatWidget";
import { useAuth } from "@/contexts/AuthContext";

// The component uses raw fetch (not supabase.functions.invoke) to call
// ai-query, so only auth.getSession needs mocking here — tests below mock
// global.fetch directly per-case.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: { access_token: "tok" } }, error: null })
      ),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ role: "fms", user: { id: "u1" } })),
}));

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWidget() {
  return render(
    <QueryClientProvider client={makeQC()}>
      <AiChatWidget />
    </QueryClientProvider>
  );
}

function jsonResponse(body: unknown, status = 200) {
  // A real Response rather than a hand-rolled stand-in: the previous object was
  // missing 12 members and only compiled behind a cast.
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

async function openAndAsk(question: string) {
  fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));
  const input = screen.getByPlaceholderText(/ask a question/i);
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
}

describe("AiChatWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ role: "fms", user: { id: "u1" } } as ReturnType<typeof useAuth>);
  });

  it("renders floating chat button", () => {
    renderWidget();
    expect(screen.getByRole("button", { name: /ask ai/i })).toBeInTheDocument();
  });

  it("opens panel when button clicked", () => {
    renderWidget();
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));
    expect(screen.getByPlaceholderText(/ask a question/i)).toBeInTheDocument();
  });

  it("shows character count", () => {
    renderWidget();
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));
    const input = screen.getByPlaceholderText(/ask a question/i);
    fireEvent.change(input, { target: { value: "Hello" } });
    expect(screen.getByText(/5 \/ 500/)).toBeInTheDocument();
  });

  it("renders nothing for a role outside the allowed set", () => {
    vi.mocked(useAuth).mockReturnValue({ role: "logistic_pharmacist", user: { id: "u1" } } as ReturnType<typeof useAuth>);
    const { container } = renderWidget();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is no role at all", () => {
    vi.mocked(useAuth).mockReturnValue({ role: null, user: { id: "u1" } } as ReturnType<typeof useAuth>);
    const { container } = renderWidget();
    expect(container.firstChild).toBeNull();
  });

  it("renders for every allowed role", () => {
    for (const role of ["admin", "pharmacist", "fms", "mo", "super_admin"]) {
      vi.mocked(useAuth).mockReturnValue({ role, user: { id: "u1" } } as ReturnType<typeof useAuth>);
      const { container, unmount } = renderWidget();
      expect(container.firstChild).not.toBeNull();
      unmount();
    }
  });

  it("sends a question and displays the JSON answer", async () => {
    global.fetch = vi.fn(() => jsonResponse({ answer: "Here is your answer.", source: "faq", elapsed_ms: 10 }));
    renderWidget();
    await openAndAsk("How do I record a Terimaan?");
    expect(await screen.findByText("Here is your answer.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/ai-query"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows the server's retry_after_seconds on a 429, not a hardcoded limit", async () => {
    global.fetch = vi.fn(() => jsonResponse({ error: "Rate limit exceeded", retry_after_seconds: 120 }, 429));
    renderWidget();
    await openAndAsk("Anything");
    expect(await screen.findByText(/2 minute/i)).toBeInTheDocument();
  });

  it("shows a friendly message on a 504 timeout from the server", async () => {
    global.fetch = vi.fn(() => jsonResponse({ error: "timeout" }, 504));
    renderWidget();
    await openAndAsk("Anything");
    expect(await screen.findByText(/taking longer than expected/i)).toBeInTheDocument();
  });

  it("shows a Cancel button while loading, and cancelling aborts the request", async () => {
    global.fetch = vi.fn((_url: string, opts?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }) as Promise<Response>;
    });
    renderWidget();
    await openAndAsk("Anything");

    const cancelButton = await screen.findByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(await screen.findByText(/cancelled/i)).toBeInTheDocument();
  });
});
