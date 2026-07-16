// supabase/functions/_shared/hermes.ts
// Thin client for the self-hosted Hermes model served by Ollama on the same
// Docker network. Replaces the Anthropic SDK — same {text, tokensUsed} shape
// the callers feed into writeAuditLog.

export interface HermesOptions {
  system: string;
  user: string;
  /** Constrain output to valid JSON via Ollama's format:"json" mode. */
  json?: boolean;
  /** Maps to options.num_predict. */
  maxTokens?: number;
  temperature?: number;
  /** Context window; the prompt budget upstream must stay under this. */
  numCtx?: number;
  timeoutMs?: number;
}

export interface HermesResult {
  text: string;
  tokensUsed: number;
}

export async function hermesChat(opts: HermesOptions): Promise<HermesResult> {
  const base = Deno.env.get("OLLAMA_URL") ?? "http://ollama:11434";
  const model = Deno.env.get("OLLAMA_MODEL") ?? "hermes3:8b";

  const resp = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // A hang becomes a normal throw into each function's existing
    // catch → audit(500) → "AI service temporarily unavailable" path.
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    body: JSON.stringify({
      model,
      stream: false,
      ...(opts.json ? { format: "json" } : {}),
      // Keep the model resident between calls — CPU reload costs minutes.
      keep_alive: "30m",
      options: {
        temperature: opts.temperature ?? 0.1,
        num_predict: opts.maxTokens ?? 512,
        num_ctx: opts.numCtx ?? 8192,
      },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`ollama_http_${resp.status}: ${detail.slice(0, 200)}`);
  }

  const data = await resp.json() as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };

  return {
    text: data.message?.content ?? "",
    tokensUsed: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
  };
}
