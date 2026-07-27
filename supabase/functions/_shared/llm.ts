// supabase/functions/_shared/llm.ts
// Thin wrapper around a self-hosted Ollama instance on the same VPS,
// replacing the Anthropic SDK across all three AI edge functions. Zero
// recurring cost, patient data never leaves the box.

import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GenerateOpts {
  messages: LlmMessage[];
  numPredict?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  usage: Usage;
  durationMs: number;
}

export class LlmTimeoutError extends Error {
  constructor(message = "LLM request timed out") {
    super(message);
    this.name = "LlmTimeoutError";
  }
}

function ollamaUrl(): string {
  return Deno.env.get("OLLAMA_URL") ?? "http://ollama:11434";
}

function modelName(): string {
  return Deno.env.get("OLLAMA_MODEL") ?? "qwen2.5:1.5b-instruct-q4_K_M";
}

function numCtx(): number {
  return Number(Deno.env.get("OLLAMA_NUM_CTX") ?? "2048");
}

function timeoutMs(): number {
  return Number(Deno.env.get("OLLAMA_TIMEOUT_MS") ?? "60000");
}

interface ChatOpts {
  messages: LlmMessage[];
  format?: unknown;
  numPredict?: number;
  temperature?: number;
  stream?: boolean;
}

async function ollamaChat(opts: ChatOpts): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await fetch(`${ollamaUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName(),
        stream: opts.stream ?? false,
        keep_alive: "24h",
        messages: opts.messages,
        ...(opts.format ? { format: opts.format } : {}),
        options: {
          temperature: opts.temperature ?? 0,
          num_predict: opts.numPredict ?? 512,
          num_ctx: numCtx(),
          seed: 0,
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new LlmTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function usageFrom(json: { prompt_eval_count?: number; eval_count?: number }): Usage {
  const promptTokens = json.prompt_eval_count ?? 0;
  const completionTokens = json.eval_count ?? 0;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

async function chat(opts: ChatOpts): Promise<GenerateResult> {
  const start = Date.now();
  const resp = await ollamaChat({ ...opts, stream: false });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Ollama request failed: ${resp.status} ${body.slice(0, 200)}`);
  }
  const json = await resp.json();
  return {
    text: json.message?.content ?? "",
    usage: usageFrom(json),
    durationMs: Date.now() - start,
  };
}

export async function generate(opts: GenerateOpts): Promise<GenerateResult> {
  return chat({ messages: opts.messages, numPredict: opts.numPredict, temperature: opts.temperature ?? 0 });
}

/**
 * SSE-shaped stream of Ollama's token deltas, for the chat widget. Each
 * event is `data: {"delta": "..."}\n\n`; the final event is
 * `data: {"done": true, "usage": {...}}\n\n` followed by `data: [DONE]\n\n`.
 */
export async function generateStream(opts: GenerateOpts): Promise<ReadableStream<Uint8Array>> {
  const resp = await ollamaChat({
    messages: opts.messages,
    numPredict: opts.numPredict,
    temperature: opts.temperature ?? 0,
    stream: true,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`Ollama stream request failed: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let chunk: { message?: { content?: string }; done?: boolean; prompt_eval_count?: number; eval_count?: number };
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }
        const delta = chunk.message?.content ?? "";
        if (delta) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
        }
        if (chunk.done) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, usage: usageFrom(chunk) })}\n\n`));
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

function extractJson(text: string): unknown {
  const fenceStripped = text.replace(/```json\s*|```/gi, "").trim();
  const match = fenceStripped.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export interface GenerateJsonOpts extends GenerateOpts {
  /** JSON Schema passed to Ollama's `format` field for grammar-constrained decoding. */
  jsonSchema?: unknown;
  /** Deterministic safe default returned if the model's output never validates. */
  fallback: unknown;
}

export interface GenerateJsonResult<T> {
  data: T;
  source: "llm" | "fallback";
  usage: Usage;
  durationMs: number;
}

/**
 * Reliable structured output from a small model: grammar-constrained
 * decoding (format), fence-stripping + regex extraction, Zod validation,
 * one retry at a higher temperature in plain JSON mode, then a deterministic
 * fallback. Never throws on bad model output — only on a transport failure
 * (which callers should let bubble up as a 500/504).
 */
export async function generateJson<S extends z.ZodTypeAny>(
  schema: S,
  opts: GenerateJsonOpts,
): Promise<GenerateJsonResult<z.infer<S>>> {
  const attempt = async (temperature: number, useSchema: boolean) => {
    const result = await chat({
      messages: opts.messages,
      format: useSchema ? opts.jsonSchema : "json",
      numPredict: opts.numPredict,
      temperature,
    });
    const raw = extractJson(result.text);
    const parsed = schema.safeParse(raw);
    return { parsed, usage: result.usage, durationMs: result.durationMs };
  };

  let attemptResult = await attempt(opts.temperature ?? 0, !!opts.jsonSchema);
  if (!attemptResult.parsed.success) {
    attemptResult = await attempt(0.2, false);
  }

  if (!attemptResult.parsed.success) {
    return {
      data: opts.fallback as z.infer<S>,
      source: "fallback",
      usage: attemptResult.usage,
      durationMs: attemptResult.durationMs,
    };
  }
  return {
    data: attemptResult.parsed.data,
    source: "llm",
    usage: attemptResult.usage,
    durationMs: attemptResult.durationMs,
  };
}

export interface LlmHealth {
  up: boolean;
  models: string[];
  loaded: boolean;
  latencyMs: number | null;
}

export async function llmHealth(): Promise<LlmHealth> {
  const start = Date.now();
  try {
    const [tagsResp, psResp] = await Promise.all([
      fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${ollamaUrl()}/api/ps`, { signal: AbortSignal.timeout(5000) }),
    ]);
    const latencyMs = Date.now() - start;
    if (!tagsResp.ok) return { up: false, models: [], loaded: false, latencyMs };

    const tags = await tagsResp.json();
    const models: string[] = (tags.models ?? []).map((m: { name: string }) => m.name);

    let loaded = false;
    if (psResp.ok) {
      const ps = await psResp.json();
      loaded = (ps.models ?? []).some((m: { name: string }) => m.name === modelName());
    }

    return { up: true, models, loaded, latencyMs };
  } catch {
    return { up: false, models: [], loaded: false, latencyMs: null };
  }
}
