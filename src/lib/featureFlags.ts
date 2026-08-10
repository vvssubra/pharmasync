// Local deployment feature flags.
// AI features (chat widget, antibiotic suggest, pathway check) call Supabase
// Edge Functions backed by a self-hosted Ollama container on the same VPS —
// no external API, no recurring cost, and patient data never leaves the box.
// Set VITE_AI_ENABLED="false" to hide the AI UI entirely (see the rollback
// section of docs/AI_DEPLOYMENT_RUNBOOK.md).
export const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === "true";

// Roles permitted to call antibiotic-suggest / pathway-check. MUST stay in
// step with ALLOWED_ROLES in both of those edge functions — showing the
// Suggest button to a role the endpoint rejects yields a silent 403 on click,
// which is exactly what happened when this list was "mo" only on the server
// while the /request route admitted admin/pharmacist/super_admin too.
export const AI_SUGGEST_ROLES = ["mo", "fms", "admin", "pharmacist", "super_admin"];

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
