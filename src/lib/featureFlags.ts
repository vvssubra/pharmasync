// Local deployment feature flags.
// AI features (chat widget, antibiotic suggest, pathway check) call Supabase
// Edge Functions that need a paid Anthropic API key + internet. For the office
// self-hosted install those functions are not deployed, so the UI is hidden by
// leaving VITE_AI_ENABLED unset (or "false") in .env.
// Set VITE_AI_ENABLED="true" to re-enable (e.g. local dev against the cloud project).
export const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === "true";
