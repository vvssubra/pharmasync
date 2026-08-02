// supabase/functions/_shared/nagPathways.ts
// Mirrored verbatim from src/lib/nagPathways.ts (parity-tested) because the
// edge bundle cannot import outside supabase/functions/.
//
// The import lines are deliberately outside the shared-nagpathways markers:
// the two mirrored files resolve these modules differently (bundler-style
// extensionless specifiers in src/lib vs Deno's required ".ts" here), so the
// parity test only checks byte-identity from the first export onward.
import type { PatientGroup } from "./doseQuery.ts";
import type { AbxWeightRule } from "./abxDose.ts";

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
  /** The children's dosing row from the source table, when it gives
   *  genuine mg/kg-of-weight math (as opposed to a fixed dose or a
   *  weight-band lookup table). */
  weightBased?: AbxWeightRule;
  /** Weight-based version of the allergy alternative, when the source's
   *  children's "Alternative" row is itself dosed by weight. */
  allergyWeightBased?: AbxWeightRule;
}

export const NAG_PATHWAYS: NagPathway[] = [
  {
    id: "pharyngitis",
    indication: "Acute Pharyngitis",
    aliases: ["pharyngitis", "acute pharyngitis", "centor", "strep score", "sore throat", "tonsillitis"],
    patientGroup: "Any",
    firstLine: "Penicillin V 500mg PO q6h (or 1g PO q12h) x 5-10 days",
    alternatives: [
      { when: "Alternative / penicillin allergy", regimen: "Erythromycin Ethylsuccinate 800mg PO q12h x 5-10 days" },
    ],
    durationDaysRange: [5, 10],
    allowedDrugs: ["Penicillin V", "Erythromycin Ethylsuccinate"],
    cautions: [
      "Only treat if Strep/Centor score >= 3 — most sore throat is viral.",
      "Amoxicillin 500mg PO q8h x 5-10 days is an equally preferred adult alternative to Penicillin V.",
      "Consider extending to 10 days where rheumatic fever prevalence is high, or in patients aged 3-21 with a personal history of rheumatic fever/rheumatic heart disease.",
    ],
    source: "NAG 2024 — Acute Pharyngitis (v09 Dec 2025)",
    weightBased: { kind: "mgPerKgPerDay", drug: "Penicillin V", mgPerKgPerDayRange: [25, 50], frequency: "q6h", durationDaysRange: [10, 10], maxMgPerDay: 2000 },
    allergyWeightBased: { kind: "mgPerKgPerDay", drug: "Erythromycin Ethylsuccinate", mgPerKgPerDayRange: [40, 50], frequency: "q12h", durationDaysRange: [10, 10], maxMgPerDay: 1600 },
  },
  {
    id: "cap",
    indication: "Community Acquired Pneumonia",
    aliases: ["community acquired pneumonia", "community-acquired pneumonia", "cap", "pneumonia"],
    patientGroup: "Any",
    firstLine: "Amoxicillin 500-1000mg PO q8h x 5-7 days (mild, outpatient, no comorbidities)",
    alternatives: [
      { when: "Penicillin allergy", regimen: "Doxycycline 100mg PO q12h x 5-7 days" },
    ],
    durationDaysRange: [5, 7],
    allowedDrugs: ["Amoxicillin", "Doxycycline", "Erythromycin Ethylsuccinate"],
    cautions: [
      "For mild, outpatient CAP only — refer if severe, hypoxic, or requiring hospitalisation (CRB-65 >= 2, or SpO2 < 95%).",
      "With comorbidities (chronic heart/lung/liver/kidney disease, diabetes, alcoholism, malignancy, asplenia): use Amoxicillin/Clavulanate 625mg q8h, adding Azithromycin 500mg OD x3 days or Doxycycline if an atypical pathogen is suspected — not modelled here, use AI Suggest or the full guideline.",
    ],
    source: "NAG 2024 — Acute Bronchitis and Pneumonia, adult table (v30 Jan 2026)",
    weightBased: { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "q8-12h", durationDaysRange: [5, 5], maxMgPerDay: 3000 },
    allergyWeightBased: { kind: "mgPerKgPerDay", drug: "Erythromycin Ethylsuccinate", mgPerKgPerDayRange: [40, 50], frequency: "q12h", durationDaysRange: [5, 5], maxMgPerDay: 1600 },
  },
  {
    id: "aom",
    indication: "Acute Otitis Media",
    aliases: ["acute otitis media", "aom", "otitis media", "ear infection"],
    patientGroup: "Any",
    firstLine: "Amoxicillin 500mg PO q8h x 5-7 days",
    alternatives: [
      { when: "Penicillin allergy", regimen: "Erythromycin Ethylsuccinate 400mg PO q6h OR 800mg PO q12h x 5-7 days" },
    ],
    durationDaysRange: [5, 10],
    allowedDrugs: ["Amoxicillin", "Erythromycin Ethylsuccinate"],
    cautions: [
      "Assess severity/perforation first — mild cases with an intact tympanic membrane may be observed 48-72h with paracetamol before starting antibiotics.",
      "Amoxicillin/Clavulanate (14:1 formulation) is preferred over Amoxicillin if there was amoxicillin exposure within the last 30 days — not modelled here, use AI Suggest or the full guideline table.",
      "Duration: <2 years old 7-10 days; >=2 years old 5-7 days.",
      "Refer ENT for recurrent AOM, persistent otorrhea, suspected mastoiditis, or abnormal audiology.",
    ],
    source: "NAG 2024 — Acute Otitis Media (v16 Oct 2025)",
    weightBased: { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "q8-12h", durationDaysRange: [5, 10], maxMgPerDay: 3000 },
    allergyWeightBased: { kind: "mgPerKgPerDay", drug: "Erythromycin Ethylsuccinate", mgPerKgPerDayRange: [40, 50], frequency: "q12h", durationDaysRange: [5, 10], maxMgPerDay: 1600 },
  },
  {
    id: "abrs",
    indication: "Acute Bacterial Rhinosinusitis",
    aliases: ["acute bacterial rhinosinusitis", "abrs", "rhinosinusitis", "sinusitis"],
    patientGroup: "Any",
    firstLine: "Amoxicillin 500-1000mg PO q8h x 5 days",
    alternatives: [
      { when: "Penicillin allergy", regimen: "Doxycycline 100mg PO q12h x 5-7 days" },
    ],
    durationDaysRange: [3, 7],
    allowedDrugs: ["Amoxicillin", "Amoxicillin-Clavulanate", "Doxycycline", "Cefuroxime"],
    cautions: [
      "Reserve antibiotics for likely ABRS (>=3 of: fever, discoloured mucus, double sickening, severe local pain, raised ESR/CRP) — most acute rhinosinusitis is viral.",
      "Amoxicillin/Clavulanate 625mg PO q8h x 5 days is an equally preferred adult alternative to Amoxicillin.",
      "In pregnant patients with penicillin allergy, use Azithromycin 500mg PO q24h x 3 days instead of Doxycycline.",
      "Cefuroxime and other cephalosporins carry a small cross-reactivity risk with severe (anaphylactic) penicillin allergy — avoid if there is a history of anaphylaxis, urticaria, or angioedema to penicillins.",
    ],
    source: "NAG 2024 — Acute Rhinosinusitis (v10 Sept 2025)",
    weightBased: { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "q12h", durationDaysRange: [5, 5], maxMgPerDay: 2000 },
    allergyWeightBased: { kind: "mgPerKgPerDay", drug: "Cefuroxime", mgPerKgPerDayRange: [30, 30], frequency: "q12h", durationDaysRange: [5, 5], maxMgPerDay: 1000 },
  },
  {
    id: "ssti",
    indication: "Skin and Soft Tissue Infection",
    aliases: ["skin and soft tissue infection", "ssti", "cellulitis", "skin infection", "impetigo"],
    patientGroup: "Any",
    firstLine: "Cephalexin 1000mg PO q12h x 5-10 days (cellulitis)",
    alternatives: [
      { when: "Antibiotic allergy", regimen: "Erythromycin Ethylsuccinate 800mg PO q12h x 5-7 days" },
    ],
    durationDaysRange: [5, 10],
    allowedDrugs: ["Cephalexin", "Erythromycin Ethylsuccinate"],
    cautions: [
      "Cloxacillin 500mg PO q6h x 5-10 days is an equally preferred alternative; Amoxicillin 500mg PO q8h x 5-10 days may also be used for cellulitis.",
      "Abscess: incision & drainage is first-line; take pus for C&S before starting antibiotics; add antibiotics only if extensive surrounding cellulitis, inadequate drainage, diabetes mellitus, or valvular heart disease.",
      "Localised impetigo: use topical 2% fusidic acid or 2% mupirocin, not oral antibiotics — reserve oral therapy for generalised impetigo or cellulitis.",
    ],
    source: "NAG 2024 — Skin and Soft Tissue Infection (v30 Jan 2026)",
    weightBased: { kind: "mgPerKgPerDay", drug: "Cephalexin", mgPerKgPerDayRange: [25, 50], frequency: "q12h", durationDaysRange: [5, 7], maxMgPerDay: 2000 },
  },
  {
    id: "uti",
    indication: "Uncomplicated Urinary Tract Infection",
    aliases: ["urinary tract infection", "uti", "uncomplicated urinary tract infection", "cystitis"],
    patientGroup: "Adult",
    firstLine: "Nitrofurantoin 50-100mg PO q6h (immediate release) OR 100mg PO q12h (modified release) x 5 days",
    alternatives: [
      { when: "eGFR < 30 mL/min, or alternative preferred", regimen: "Cephalexin 500mg PO q6-12h x 5 days" },
    ],
    durationDaysRange: [3, 5],
    allowedDrugs: ["Nitrofurantoin", "Cephalexin"],
    cautions: [
      "Nitrofurantoin is contraindicated if eGFR < 30 mL/min.",
      "Consider q6h dosing frequency, and consider urine culture rather than empirical treatment alone, in patients at risk of complicated UTI (immunosuppressed, poorly controlled diabetes, post-menopausal, urinary tract obstruction/urolithiasis, UTI in men, CKD, catheter in situ, neurogenic bladder, recurrent UTI).",
    ],
    source: "NAG 2024 — Urinary Tract Infection in Non-Pregnancy (v30 Jan 2026)",
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
