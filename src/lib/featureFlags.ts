// Local deployment feature flags.
// AI features (chat widget, antibiotic suggest, pathway check) call Supabase
// Edge Functions that need a paid Anthropic API key + internet. For the office
// self-hosted install those functions are not deployed, so the UI is hidden by
// leaving VITE_AI_ENABLED unset (or "false") in .env.
// Set VITE_AI_ENABLED="true" to re-enable (e.g. local dev against the cloud project).
export const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === "true";

// pathway-check is a rule-based NAG 2024 lookup (Phase 4), not an LLM call —
// zero marginal cost, so it defaults on independently of AI_ENABLED (which
// gates the chat widget and antibiotic-suggest, the two features that do
// call Ollama). Set VITE_PATHWAY_CHECK_ENABLED="false" to disable it too.
export const PATHWAY_CHECK_ENABLED = import.meta.env.VITE_PATHWAY_CHECK_ENABLED !== "false";

// Stream ai-query's answer token-by-token instead of waiting for the full
// response — first token arrives in ~10s instead of a blank ~25s on a
// CPU-only Ollama box. Set VITE_AI_STREAMING="false" if Kong buffers SSE
// (tokens arrive as one blob instead of incrementally).
export const AI_STREAMING = import.meta.env.VITE_AI_STREAMING !== "false";

// Client-side timeout for an ai-query call, deliberately longer than the
// edge function's own OLLAMA_TIMEOUT_MS (default 60000) so the server wins
// the race and returns a friendly 504 instead of the client giving up first.
export const AI_TIMEOUT_MS = Number(import.meta.env.VITE_AI_TIMEOUT_MS) || 90000;

// Local dose-suggestion sidecar (knowledge-service). Fully offline — Ollama
// embeddings against an Obsidian vault, no cloud calls. Independent of
// AI_ENABLED so it can run in the office install even with cloud AI off.
// Set VITE_KNOWLEDGE_ENABLED="true" once the sidecar is running (see
// knowledge-service/README.md).
export const KNOWLEDGE_ENABLED = import.meta.env.VITE_KNOWLEDGE_ENABLED === "true";
export const KNOWLEDGE_URL = import.meta.env.VITE_KNOWLEDGE_URL ?? "http://localhost:8787";
