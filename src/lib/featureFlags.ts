// Local deployment feature flags.
// AI features (chat widget, antibiotic suggest, pathway check) call Supabase
// Edge Functions backed by a self-hosted LLM (Ollama) on the same stack.
// Deployments without the AI services leave VITE_AI_ENABLED unset (or "false")
// in .env to hide the UI; set VITE_AI_ENABLED="true" where the stack runs them.
export const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === "true";

// Verbatim dose lookup against the local knowledge-service sidecar (Obsidian
// vault embeddings). Enabled only where the sidecar is reachable from the
// browser — VITE_KNOWLEDGE_URL is its base URL (default: local dev sidecar).
export const KNOWLEDGE_ENABLED = import.meta.env.VITE_KNOWLEDGE_ENABLED === "true";
export const KNOWLEDGE_URL: string = import.meta.env.VITE_KNOWLEDGE_URL ?? "http://localhost:8787";
