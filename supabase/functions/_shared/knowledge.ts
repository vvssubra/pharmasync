// supabase/functions/_shared/knowledge.ts
// Server-side client for the knowledge-service sidecar (Obsidian vault
// verbatim dose notes), reached over the internal Docker network. Grounding
// is best-effort: any failure returns [] so the AI call proceeds without it.

export interface KnowledgeMatch {
  drug: string;
  indication: string;
  patient_group: string;
  source: string;
  body: string;
  example_dose?: string;
  score: number;
}

export async function fetchDoseMatches(
  query: string,
  patientGroup?: "Adult" | "Paediatric" | "Any",
): Promise<KnowledgeMatch[]> {
  const base = Deno.env.get("KNOWLEDGE_SERVICE_URL");
  if (!base || !query.trim()) return [];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = Deno.env.get("KNOWLEDGE_KEY");
  if (key) headers["x-knowledge-key"] = key;

  try {
    const resp = await fetch(`${base}/suggest-dose`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({ query, patient_group: patientGroup }),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { matches?: KnowledgeMatch[] };
    return Array.isArray(data.matches) ? data.matches : [];
  } catch {
    return [];
  }
}

/** Serialize matches as a system-prompt block; empty string when none. */
export function doseMatchesBlock(matches: KnowledgeMatch[]): string {
  if (matches.length === 0) return "";
  const entries = matches.map((m) =>
    `- ${m.drug} — ${m.indication} (${m.patient_group}, source: ${m.source}):\n${m.body}`
  );
  return `## Verified local dosing notes (verbatim — prefer these doses over anything else):\n${entries.join("\n")}`;
}
