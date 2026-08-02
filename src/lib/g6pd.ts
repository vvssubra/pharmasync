// src/lib/g6pd.ts
//
// Search and grouping over the G6PD table. Pure functions — the data lives in
// g6pdDrugs.ts.

import { G6PD_CLASSES, type G6pdClass, type G6pdDrug, type G6pdRisk } from "./g6pdDrugs";

/** One drug with the context it needs to stand alone in a result list. */
export interface G6pdMatch extends G6pdDrug {
  className: string;
  risk: G6pdRisk;
}

function normalise(value: string): string {
  return value.toLowerCase().trim();
}

/** Every drug across every class, flattened for searching. */
export function allDrugs(classes: G6pdClass[] = G6PD_CLASSES): G6pdMatch[] {
  return classes.flatMap(c => c.drugs.map(d => ({ ...d, className: c.name, risk: c.risk })));
}

/**
 * Matches a drug by name, alternative name or family. Substring rather than
 * prefix: a pharmacist typing "oxazole" should still find co-trimoxazole, and
 * typing "sulfa" should surface the whole family.
 *
 * Definite-risk hits sort ahead of possible-risk ones — if a drug appears in
 * both tiers the more serious answer must not be below the fold.
 */
export function searchDrugs(query: string, classes: G6pdClass[] = G6PD_CLASSES): G6pdMatch[] {
  const term = normalise(query);
  if (!term) return [];
  return allDrugs(classes)
    .filter(d =>
      normalise(d.name).includes(term) ||
      (d.aka ? normalise(d.aka).includes(term) : false) ||
      (d.family ? normalise(d.family).includes(term) : false)
    )
    .sort((a, b) => {
      if (a.risk !== b.risk) return a.risk === "definite" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function classesByRisk(risk: G6pdRisk, classes: G6pdClass[] = G6PD_CLASSES): G6pdClass[] {
  return classes.filter(c => c.risk === risk);
}

/** Drugs the source lists under both tiers — worth showing as the worse one. */
export function drugsInBothTiers(classes: G6pdClass[] = G6PD_CLASSES): string[] {
  const byName = new Map<string, Set<G6pdRisk>>();
  for (const d of allDrugs(classes)) {
    const key = normalise(d.name);
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key)!.add(d.risk);
  }
  return [...byName.entries()]
    .filter(([, risks]) => risks.size > 1)
    .map(([name]) => name)
    .sort();
}
