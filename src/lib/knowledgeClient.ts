// Thin client for the local knowledge-service sidecar (offline dose lookup).
// Separate auth model from Supabase edge functions — an optional shared
// secret header, not a bearer session token — so it gets its own client
// rather than reusing the edge-function fetch pattern.
import { KNOWLEDGE_URL } from "./featureFlags";

export type PatientGroup = "Adult" | "Paediatric" | "Any";

export interface DoseMatch {
  drug: string;
  indication: string;
  patient_group: PatientGroup;
  source: string;
  body: string;
  score: number;
  /** Optional short regimen authored for the "Use" button; falls back to the
   * first line of `body` (the preferred regimen) when absent — see
   * `exampleDoseFor`. */
  example_dose?: string;
}

// Short regimen to seed the Antibiotic Regimen field with when the doctor
// clicks "Use" — the full `body` (all alternatives + caveats) stays on
// screen for comparison but is too long to drop into the field verbatim.
export function exampleDoseFor(match: DoseMatch): string {
  const explicit = match.example_dose?.trim();
  if (explicit) return explicit;
  return match.body.split("\n")[0].trim();
}

export interface SuggestDoseRequest {
  query: string;
  patient_group?: PatientGroup;
}

export interface SuggestDoseResult {
  matches: DoseMatch[];
  message?: string;
}

export async function suggestDose(request: SuggestDoseRequest): Promise<SuggestDoseResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const knowledgeKey = import.meta.env.VITE_KNOWLEDGE_KEY;
  if (knowledgeKey) headers["x-knowledge-key"] = knowledgeKey;

  const resp = await fetch(`${KNOWLEDGE_URL}/suggest-dose`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  if (!resp.ok) {
    throw new Error(`suggest-dose request failed with status ${resp.status}`);
  }

  const data = await resp.json() as SuggestDoseResult;
  return { matches: data.matches ?? [], message: data.message };
}
