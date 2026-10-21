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

export interface SuggestedRegimen extends ComputedRegimen {
  /** Set on "nag_ai" regimens: breadcrumb of the NAG section the server
   *  verified every quoted dose line against. */
  sourcePath?: string;
}

export interface AiSuggestion {
  /** Every regimen option NAG_PATHWAYS documents for the matched pathway —
   *  empty when no pathway matched (see `source: "refer"` below). */
  regimens: SuggestedRegimen[];
  rationale: string;
  warning: string | null;
  /** "refer" means no regimen was produced — no pathway matched, or the only
   *  match was written for a different patient group. `regimens` is empty,
   *  and `rationale` carries the refer-to-specialist message instead.
   *  "nag_ai" means no built-in pathway matched, and Claude located the case
   *  in the full NAG 2024 corpus; each regimen's text is a dose line the
   *  server checked word-for-word against `sourcePath`. */
  source: "rules" | "refer" | "nag_ai";
}

function isRegimen(value: unknown): value is ComputedRegimen {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return typeof r.drug === "string" && typeof r.text === "string" && typeof r.tier === "string"
    && (r.sourcePath === undefined || typeof r.sourcePath === "string");
}

/** Null when the body is not a current antibiotic-suggest response. */
export function parseAiSuggestion(body: unknown): AiSuggestion | null {
  if (!body || typeof body !== "object") return null;
  const { regimens, rationale, warning, source } = body as Record<string, unknown>;
  if (!Array.isArray(regimens) || !regimens.every(isRegimen)) return null;
  if (typeof rationale !== "string") return null;
  if (warning !== null && typeof warning !== "string") return null;
  if (source !== "rules" && source !== "refer" && source !== "nag_ai") return null;
  return { regimens, rationale, warning: warning as string | null, source };
}

// Connectors in Malaysian names — never stripped on their own, they are
// ordinary words that can appear in clinical text.
const NAME_CONNECTORS = new Set(["bin", "binti", "bt", "bte", "a/l", "a/p", "al", "ap", "anak", "anak lelaki", "anak perempuan"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes this patient's name and IC from free text (diagnosis, allergy
 * detail) before it is sent for an AI suggestion — a doctor sometimes types
 * them there. The suggestion request itself never carries the name or IC
 * fields; the edge function additionally redacts anything IC-shaped.
 */
export function stripPatientIdentifiers(text: string, patientName: string, patientIC: string): string {
  let out = text;
  const icDigits = patientIC.replace(/\D/g, "");
  if (icDigits.length >= 6) {
    // Match the IC however it was typed: digits with optional dashes/spaces between any of them.
    const flexible = icDigits.split("").map(escapeRegExp).join("[\\s-]?");
    out = out.replace(new RegExp(flexible, "g"), "[IC removed]");
  }
  const name = patientName.trim();
  if (name.length >= 2) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(name).replace(/\s+/g, "\\s+")}\\b`, "gi"), "[name removed]");
    for (const token of name.split(/\s+/)) {
      if (token.length < 3 || NAME_CONNECTORS.has(token.toLowerCase())) continue;
      out = out.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, "gi"), "[name removed]");
    }
  }
  return out;
}

export const STALE_SERVER_MESSAGE =
  "AI suggestion failed: the server returned an outdated response. Ask your admin to redeploy the antibiotic-suggest edge function.";

/** One actionable line per failure class, instead of a single generic
 *  "unavailable" that hid 401/403/400/503 behind the same words. */
export function describeAiSuggestFailure(status: number, serverError?: string, fields?: string[]): string {
  switch (status) {
    case 401:
      return "AI suggestion failed: your session has expired. Please sign in again.";
    case 403:
      return `AI suggestion refused: ${serverError || "your role is not permitted to use it"}.`;
    case 400:
      return `AI suggestion rejected the form input${serverError ? ` (${serverError})` : ""}. ${
        fields?.length ? `Check: ${fields.join(", ")}.` : "Check the diagnosis, allergy and weight fields."
      }`;
    case 429:
      return "AI suggestion limit reached. Please try again later.";
    case 503:
      return "AI suggestion service is temporarily unavailable. Please try again in a moment.";
    default:
      return `AI suggestion unavailable (HTTP ${status})${serverError ? `: ${serverError}` : ""}. Please try again.`;
  }
}
