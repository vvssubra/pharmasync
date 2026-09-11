// Client-side contract for the antibiotic-suggest edge function.
//
// The response shape changed on 2026-08-03 (f1835e5): a single `suggestion`
// string became a `regimens` array. The VPS edge runtime does not pull from
// GitHub (docs/AI_DEPLOYMENT_RUNBOOK.md §3), so the frontend can be a newer
// build than the function it calls. Rendering `regimens.map` against the old
// shape threw and blanked the whole antibiotic form on click, with nothing in
// the UI to say why — so the response is validated here and every failure is
// reported with enough detail to act on.
import type { ComputedRegimen } from "./nagPathways";

export interface AiSuggestion {
  /** Every regimen option NAG_PATHWAYS documents for the matched pathway —
   *  empty when no pathway matched (see `source: "refer"` below). */
  regimens: ComputedRegimen[];
  rationale: string;
  warning: string | null;
  /** "refer" means no regimen was produced — no pathway matched, or the only
   *  match was written for a different patient group. `regimens` is empty,
   *  and `rationale` carries the refer-to-specialist message instead. */
  source: "rules" | "refer";
}

function isRegimen(value: unknown): value is ComputedRegimen {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return typeof r.drug === "string" && typeof r.text === "string" && typeof r.tier === "string";
}

/** Null when the body is not a current antibiotic-suggest response. */
export function parseAiSuggestion(body: unknown): AiSuggestion | null {
  if (!body || typeof body !== "object") return null;
  const { regimens, rationale, warning, source } = body as Record<string, unknown>;
  if (!Array.isArray(regimens) || !regimens.every(isRegimen)) return null;
  if (typeof rationale !== "string") return null;
  if (warning !== null && typeof warning !== "string") return null;
  if (source !== "rules" && source !== "refer") return null;
  return { regimens, rationale, warning: warning as string | null, source };
}

export const STALE_SERVER_MESSAGE =
  "AI suggestion failed: the server returned an outdated response. Ask your admin to redeploy the antibiotic-suggest edge function.";

/** One actionable line per failure class, instead of a single generic
 *  "unavailable" that hid 401/403/400/503 behind the same words. */
export function describeAiSuggestFailure(status: number, serverError?: string): string {
  switch (status) {
    case 401:
      return "AI suggestion failed: your session has expired. Please sign in again.";
    case 403:
      return `AI suggestion refused: ${serverError || "your role is not permitted to use it"}.`;
    case 400:
      return `AI suggestion rejected the form input${serverError ? ` (${serverError})` : ""}. Check the diagnosis, allergy and weight fields.`;
    case 429:
      return "AI suggestion limit reached. Please try again later.";
    case 503:
      return "AI suggestion service is temporarily unavailable. Please try again in a moment.";
    default:
      return `AI suggestion unavailable (HTTP ${status})${serverError ? `: ${serverError}` : ""}. Please try again.`;
  }
}
