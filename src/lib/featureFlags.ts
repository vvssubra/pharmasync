// Local deployment feature flags.
// AI features (chat widget, antibiotic suggest, pathway check) call Supabase
// Edge Functions that need a paid Anthropic API key + internet. For the office
// self-hosted install those functions are not deployed, so the UI is hidden by
// leaving VITE_AI_ENABLED unset (or "false") in .env.
// Set VITE_AI_ENABLED="true" to re-enable (e.g. local dev against the cloud project).
export const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === "true";

// Local dose-suggestion sidecar (knowledge-service). Fully offline — Ollama
// embeddings against an Obsidian vault, no cloud calls. Independent of
// AI_ENABLED so it can run in the office install even with cloud AI off.
// Set VITE_KNOWLEDGE_ENABLED="true" once the sidecar is running (see
// knowledge-service/README.md).
export const KNOWLEDGE_ENABLED = import.meta.env.VITE_KNOWLEDGE_ENABLED === "true";
export const KNOWLEDGE_URL = import.meta.env.VITE_KNOWLEDGE_URL ?? "http://localhost:8787";
