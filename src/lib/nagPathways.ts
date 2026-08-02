// src/lib/nagPathways.ts
// Seed data transcribed verbatim from knowledge-service/vault-sample/*.md
// (NAG 2024 dosing notes already used by the local knowledge-service dose
// lookup). Replaces the 500KB Storage-hosted nag-2024.txt document that
// pathway-check and antibiotic-suggest previously fed whole into an LLM
// prompt — no CPU-only model can afford that context, and this data is
// small enough to evaluate with plain rules instead.
//
// Mirrored verbatim into supabase/functions/_shared/nagPathways.ts
// (parity-tested) because the edge bundle cannot import outside
// supabase/functions/. Lives here (not just in _shared) so the antibiotic
// form can compute a weight-based dose locally, without a network call —
// see resolveLocalDose() in src/lib/abxDose.ts.
//
// The import lines are deliberately outside the shared-nagpathways markers:
// the two mirrored files resolve these modules differently (bundler-style
// extensionless specifiers here vs Deno's required ".ts" in _shared), so the
// parity test only checks byte-identity from the first export onward.
import type { PatientGroup } from "./doseQuery";
import type { AbxWeightRule } from "./abxDose";

// <<<shared-nagpathways
export interface NagPathway {
  id: string;
  indication: string;
  /** Phrasings this pathway should match against — derivePathwayIndication()
   *  output, the source note's frontmatter indication, and common free-text
   *  diagnosis wording. */
  aliases: string[];
  patientGroup: PatientGroup;
  firstLine: string;
  alternatives: { when: string; regimen: string }[];
  durationDaysRange: [number, number];
  allowedDrugs: string[];
  cautions: string[];
  source: string;
  /** Only set when the first-line regimen is genuinely weight-based
   *  (mg/kg math), as opposed to a fixed dose with a weight threshold
   *  (e.g. pharyngitis's "250mg BD child <27kg" is NOT weight-based). */
  weightBased?: AbxWeightRule;
  /** Weight-based version of the allergy alternative, when the alternatives[]
   *  regimen is itself dosed by weight (e.g. paediatric azithromycin). */
  allergyWeightBased?: AbxWeightRule;
}

export const NAG_PATHWAYS: NagPathway[] = [
  {
    id: "pharyngitis",
    indication: "Acute Pharyngitis",
    aliases: ["pharyngitis", "acute pharyngitis", "centor", "sore throat", "tonsillitis"],
    patientGroup: "Any",
    firstLine: "Penicillin V 500mg PO BD x 10 days (adult); 250mg PO BD x 10 days (child <27kg)",
    alternatives: [
      { when: "Penicillin allergy", regimen: "Azithromycin 12mg/kg (max 500mg) OD x 5 days" },
    ],
    durationDaysRange: [5, 10],
    allowedDrugs: ["Penicillin V", "Azithromycin"],
    cautions: ["Only treat if Centor score >= 3 — most sore throat is viral."],
    source: "NAG 2024 — Acute Pharyngitis (Centor score >=3)",
    allergyWeightBased: { kind: "mgPerKgPerDose", drug: "Azithromycin", mgPerKgPerDose: 12, maxMgPerDose: 500, frequency: "OD", durationDaysRange: [5, 5] },
  },
  {
    id: "cap",
    indication: "Community Acquired Pneumonia",
    aliases: ["community acquired pneumonia", "community-acquired pneumonia", "cap", "pneumonia"],
    patientGroup: "Adult",
    firstLine: "Amoxicillin 500mg-1g PO TDS x 5-7 days (mild, outpatient)",
    alternatives: [
      { when: "Penicillin allergy", regimen: "Doxycycline 100mg PO BD x 7 days" },
    ],
    durationDaysRange: [5, 7],
    allowedDrugs: ["Amoxicillin", "Doxycycline"],
    cautions: ["For mild, outpatient CAP only — refer if severe or requiring hospitalisation."],
    source: "NAG 2024 — Community-Acquired Pneumonia",
  },
  {
    id: "aom",
    indication: "Acute Otitis Media",
    aliases: ["acute otitis media", "aom", "otitis media", "ear infection"],
    patientGroup: "Paediatric",
    firstLine: "Amoxicillin 80-90 mg/kg/day PO divided BD x 5-7 days",
    alternatives: [
      { when: "Penicillin allergy", regimen: "Azithromycin 10mg/kg OD day 1, then 5mg/kg OD days 2-5" },
    ],
    durationDaysRange: [5, 7],
    allowedDrugs: ["Amoxicillin", "Azithromycin"],
    cautions: ["Paediatric weight-based dosing — confirm current weight."],
    source: "NAG 2024 — Acute Otitis Media",
    weightBased: { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "divided BD", durationDaysRange: [5, 7] },
    allergyWeightBased: { kind: "loadTaper", drug: "Azithromycin", loadMgPerKg: 10, loadDays: 1, maintMgPerKg: 5, maintDays: 4, frequency: "OD" },
  },
  {
    id: "abrs",
    indication: "Acute Bacterial Rhinosinusitis",
    aliases: ["acute bacterial rhinosinusitis", "abrs", "rhinosinusitis", "sinusitis"],
    patientGroup: "Adult",
    firstLine: "Amoxicillin-Clavulanate 625mg PO TDS x 7 days",
    alternatives: [
      { when: "Penicillin allergy", regimen: "Doxycycline 100mg PO BD x 7 days" },
    ],
    durationDaysRange: [7, 7],
    allowedDrugs: ["Amoxicillin-Clavulanate", "Doxycycline"],
    cautions: [
      "Reserve antibiotics for likely ABRS (>=3 of: fever, discoloured mucus, double sickening, severe local pain, raised ESR/CRP) — most acute rhinosinusitis is viral.",
    ],
    source: "NAG 2024 — Acute Bacterial Rhinosinusitis",
  },
  {
    id: "ssti",
    indication: "Skin and Soft Tissue Infection",
    aliases: ["skin and soft tissue infection", "ssti", "cellulitis", "skin infection", "impetigo"],
    patientGroup: "Adult",
    firstLine: "Cloxacillin 500mg PO QID x 5-7 days (cellulitis, no abscess)",
    alternatives: [
      { when: "Penicillin allergy", regimen: "Clindamycin 300mg PO TDS x 5-7 days" },
    ],
    durationDaysRange: [5, 7],
    allowedDrugs: ["Cloxacillin", "Clindamycin"],
    cautions: [
      "Abscess: incision and drainage is first-line; add antibiotics only if extensive surrounding cellulitis, systemic signs, or comorbidity (diabetes, valvular heart disease).",
    ],
    source: "NAG 2024 — Skin and Soft Tissue Infection",
  },
  {
    id: "uti",
    indication: "Uncomplicated Urinary Tract Infection",
    aliases: ["urinary tract infection", "uti", "uncomplicated urinary tract infection", "cystitis"],
    patientGroup: "Adult",
    firstLine: "Nitrofurantoin 100mg PO BD x 5 days",
    alternatives: [
      { when: "eGFR < 45 mL/min or alternative preferred", regimen: "Fosfomycin 3g PO single dose" },
    ],
    durationDaysRange: [1, 5],
    allowedDrugs: ["Nitrofurantoin", "Fosfomycin"],
    cautions: ["Avoid nitrofurantoin if eGFR < 45 mL/min."],
    source: "NAG 2024 — Uncomplicated Urinary Tract Infection",
  },
];

const ALL_KNOWN_DRUGS: string[] = Array.from(
  new Set(NAG_PATHWAYS.flatMap((p) => p.allowedDrugs)),
).sort((a, b) => b.length - a.length);

/**
 * Identifies which known NAG drug (if any) is named in free text, preferring
 * the longest match. A plain substring check alone would misidentify a
 * compound name — "Amoxicillin-Clavulanate" contains "Amoxicillin" — as its
 * shorter, differently-indicated constituent, so callers must always
 * resolve identity through this function rather than testing one
 * `allowedDrugs` entry against the text on its own.
 */
export function identifyDrug(text: string): string | null {
  const norm = text.toLowerCase();
  return ALL_KNOWN_DRUGS.find((d) => norm.includes(d.toLowerCase())) ?? null;
}

function matchesAlias(text: string, pathway: NagPathway): boolean {
  const norm = text.trim().toLowerCase();
  if (!norm) return false;
  return pathway.aliases.some((alias) => {
    const a = alias.toLowerCase();
    return norm.includes(a) || a.includes(norm);
  });
}

/** A pathway written for one patient group must never be handed to another. */
function groupCompatible(pathway: NagPathway, patientGroup: PatientGroup): boolean {
  // "Any" on either side means the pathway carries dosing for both, or the
  // caller gave no age. Age-unknown deliberately stays permissive so an adult
  // without an IC on file still gets a suggestion.
  return pathway.patientGroup === "Any" || patientGroup === "Any" || pathway.patientGroup === patientGroup;
}

export interface PathwayMatch {
  /** Null when nothing matched, or when the only matches are for another patient group. */
  pathway: NagPathway | null;
  /** True when a pathway matched the diagnosis but is written for a different group. */
  groupMismatch: boolean;
  /** The indication that matched, even when rejected for group — for messaging. */
  mismatchedIndication: string | null;
}

/**
 * Finds the NAG pathway matching a derivePathwayIndication() result first,
 * falling back to free-text diagnosis wording.
 *
 * SAFETY: this used to end in `?? pool[0]`, which handed back a pathway even
 * when its patientGroup conflicted with the patient's. A 6-year-old with
 * pneumonia therefore received the adult CAP regimen — "Amoxicillin 500mg-1g
 * PO TDS", roughly 150 mg/kg/day for a 20kg child — labelled as a confident
 * NAG match. Only AOM carries weightBased dosing, so every other paediatric
 * case fell through to the adult first-line. A group mismatch now yields no
 * pathway, and callers refer to a specialist instead of substituting a dose.
 */
export function matchPathwayDetailed(
  indication: string | null,
  diagnosis: string | null,
  patientGroup: PatientGroup,
): PathwayMatch {
  const byIndication = indication ? NAG_PATHWAYS.filter((p) => matchesAlias(indication, p)) : [];
  const pool = byIndication.length > 0
    ? byIndication
    : diagnosis
      ? NAG_PATHWAYS.filter((p) => matchesAlias(diagnosis, p))
      : [];

  if (pool.length === 0) return { pathway: null, groupMismatch: false, mismatchedIndication: null };

  const compatible = pool.find((p) => groupCompatible(p, patientGroup));
  if (compatible) return { pathway: compatible, groupMismatch: false, mismatchedIndication: null };

  return { pathway: null, groupMismatch: true, mismatchedIndication: pool[0].indication };
}

/** Back-compat wrapper: the pathway only, or null. */
export function matchPathway(
  indication: string | null,
  diagnosis: string | null,
  patientGroup: PatientGroup,
): NagPathway | null {
  return matchPathwayDetailed(indication, diagnosis, patientGroup).pathway;
}

/** Shared by pathway-check and antibiotic-suggest. */
export function patientGroupFromAge(age: number | undefined | null): PatientGroup {
  if (age == null) return "Any";
  return age < 12 ? "Paediatric" : "Adult";
}

/** Shared by pathway-check and antibiotic-suggest. */
export function isStatedAllergy(allergyStatus: string | undefined | null): boolean {
  if (!allergyStatus) return false;
  const norm = allergyStatus.trim().toLowerCase();
  if (!norm) return false;
  return !/^(none|no|nkda|nil)\b/.test(norm);
}
// shared-nagpathways>>>
