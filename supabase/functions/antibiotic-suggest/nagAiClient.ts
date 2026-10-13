// supabase/functions/antibiotic-suggest/nagAiClient.ts
// The one network call of the AI dose lookup: asks Claude to locate the NAG
// section for a case and copy its dose lines. Everything it returns is
// re-checked by verifyAiAnswer() (nagAi.ts) before the doctor sees it.
//
// Env (edge runtime):
//   NAG_AI_ENABLED=true        — feature switch; anything else keeps the lookup off
//   ANTHROPIC_API_KEY          — required when enabled
//   NAG_AI_MODEL               — default claude-opus-5-5
//   NAG_AI_EFFORT              — low | medium | high (default medium)
//   NAG_AI_TIMEOUT_MS          — default 45000

import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { NAG_CORPUS_SECTIONS } from "../_shared/nagCorpus.generated.ts";
import {
  NAG_AI_INSTRUCTIONS,
  NAG_AI_SCHEMA,
  buildCaseMessage,
  buildCorpusPrompt,
  parseRawAnswer,
  verifyAiAnswer,
  type NagAiCase,
  type VerifiedAiAnswer,
} from "./nagAi.ts";

export function nagAiEnabled(): boolean {
  return Deno.env.get("NAG_AI_ENABLED") === "true" && !!Deno.env.get("ANTHROPIC_API_KEY");
}

export class NagAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NagAiError";
  }
}

// Built once per isolate: identical bytes on every request keep the prompt
// cache warm across doctors.
const CORPUS_PROMPT = buildCorpusPrompt(NAG_CORPUS_SECTIONS);

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({
    apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
    timeout: Number(Deno.env.get("NAG_AI_TIMEOUT_MS") ?? "45000"),
    maxRetries: 1,
  });
  return client;
}

function effort(): "low" | "medium" | "high" {
  const e = Deno.env.get("NAG_AI_EFFORT");
  return e === "low" || e === "high" ? e : "medium";
}

export interface NagAiOutcome {
  answer: VerifiedAiAnswer;
  tokensUsed: number;
  model: string;
}

// Server-side refusal fallback exists for the Opus/Sonnet/Fable lines only;
// Haiku rejects the parameter, so it is sent only where it is supported.
function supportsDefaultFallback(model: string): boolean {
  return /^claude-(opus|sonnet|fable)-/.test(model);
}

export async function lookupNagRegimen(c: NagAiCase): Promise<NagAiOutcome> {
  const model = Deno.env.get("NAG_AI_MODEL") ?? "claude-opus-5-5";
  const response = await getClient().beta.messages.create({
    model,
    max_tokens: 16000,
    // On a safety-classifier decline, re-run on Anthropic's recommended
    // fallback model inside the same call instead of failing the click.
    ...(supportsDefaultFallback(model)
      ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
      : {}),
    output_config: {
      effort: effort(),
      format: { type: "json_schema", schema: NAG_AI_SCHEMA },
    },
    system: [
      { type: "text", text: NAG_AI_INSTRUCTIONS },
      { type: "text", text: CORPUS_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: buildCaseMessage(c) }],
  });

  const usage = response.usage;
  const tokensUsed =
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);

  if (response.stop_reason === "refusal") throw new NagAiError("model declined the request");
  if (response.stop_reason === "max_tokens") throw new NagAiError("model output was truncated");

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new NagAiError("model returned invalid JSON");
  }
  const raw = parseRawAnswer(json);
  if (!raw) throw new NagAiError("model returned an unexpected shape");

  return {
    answer: verifyAiAnswer(raw, NAG_CORPUS_SECTIONS, c.patientGroup, c.allergyStatus),
    tokensUsed,
    model: response.model,
  };
}
