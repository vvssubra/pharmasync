// src/lib/nagPathways.ts
// Seed data transcribed from the official National Antimicrobial Guideline,
// 4th Edition (2024) clinical pathway documents (Clinical Pathways for
// Primary Care — one PDF per topic, each independently versioned; see the
// `source` field per pathway for its date). Replaces the 500KB
// Storage-hosted nag-2024.txt document that pathway-check and
// antibiotic-suggest previously fed whole into an LLM prompt — no CPU-only
// model can afford that context, and this data is small enough to evaluate
// with plain rules instead.
//
// Each pathway lists every drug the source documents for it (Preferred and
// Alternative tiers), not just one primary + one allergy substitute — a
// doctor working through the checklist should see the full set of options
// the guideline actually offers. `allowedDrugs` is kept as an explicit list
// matching `regimens[].drug` 1:1, so checkPathway()'s "not_supported" verdict
// stays accurate to what this file documents.
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
import { computeAbxDose, type AbxWeightRule, type AbxDoseResult } from "./abxDose";

// <<<shared-nagpathways
export interface RegimenOption {
  drug: string;
  /** The source table's own tier/label — e.g. "Preferred", "Alternative", "Antibiotic allergy". */
  tier: string;
  /** True for a penicillin-class drug (penicillins, aminopenicillins,
   *  antistaphylococcal penicillins) — flagged in the UI when the patient
   *  has a stated drug allergy. Cephalosporins are a different class and
   *  are not flagged here (their smaller cross-reactivity risk is noted in
   *  `cautions` instead). The doctor decides; this never hides an option. */
  penicillinClass?: boolean;
  /** Adult regimen text — shown whenever this option isn't weight-computed
   *  (adult patient, or no weight given yet). Undefined for a drug the
   *  source only documents in the children's table. */
  adultText?: string;
  /** The children's weight-based rule, when the source's children's table
   *  gives genuine mg/kg-of-weight math for this drug. */
  weightBased?: AbxWeightRule;
}

export interface NagPathway {
  id: string;
  indication: string;
  /** Phrasings this pathway should match against — derivePathwayIndication()
   *  output only (see matchPathwayDetailed: there is no free-text diagnosis
   *  fallback, a shorthand diagnosis must never silently redirect a match). */
  aliases: string[];
  patientGroup: PatientGroup;
  regimens: RegimenOption[];
  durationDaysRange: [number, number];
  allowedDrugs: string[];
  cautions: string[];
  source: string;
}

/** A regimen option resolved for a specific patient — either the children's
 *  weight-computed line, or the adult reference text, whichever applies. */
export interface ComputedRegimen {
  drug: string;
  tier: string;
  penicillinClass: boolean;
  text: string;
  /** Shown working, e.g. "80-90 mg/kg/day x 14 kg" — set only when computed by weight. */
  basis?: string;
  capped?: boolean;
  /** True when `text` came from real mg/kg-of-weight math; false for adult reference text. */
  computed: boolean;
}

/** Resolves every regimen option a pathway documents into patient-ready
 *  text — weight-computed wherever a weight is given and the patient isn't
 *  confirmed Adult, adult reference text otherwise. Age-unknown ("Any")
 *  stays on the weight-computed path deliberately — a doctor often fills
 *  weight before an IC is on file, and the pathway match itself already
 *  confirmed clinical applicability; only a *confirmed* adult is excluded,
 *  so paediatric mg/kg math is never applied to a known-adult weight. A
 *  drug the source only tabulates for the other patient group (no adultText
 *  and no usable weightBased) is skipped rather than shown with nothing to
 *  say. */
export function computeRegimenOptions(
  pathway: NagPathway,
  patientGroup: PatientGroup,
  weightKg: number | null,
): ComputedRegimen[] {
  const options: ComputedRegimen[] = [];
  for (const r of pathway.regimens) {
    let dose: AbxDoseResult | null = null;
    if (patientGroup !== "Adult" && r.weightBased && weightKg != null) {
      dose = computeAbxDose(r.weightBased, weightKg);
    }
    if (dose) {
      options.push({ drug: r.drug, tier: r.tier, penicillinClass: !!r.penicillinClass, text: dose.text, basis: dose.basis, capped: dose.capped, computed: true });
    } else if (r.adultText) {
      options.push({ drug: r.drug, tier: r.tier, penicillinClass: !!r.penicillinClass, text: `${r.drug} ${r.adultText}`, computed: false });
    }
  }
  return options;
}

export const NAG_PATHWAYS: NagPathway[] = [
  {
    id: "pharyngitis",
    indication: "Acute Pharyngitis",
    aliases: ["pharyngitis", "acute pharyngitis", "centor", "strep score", "sore throat", "tonsillitis"],
    patientGroup: "Any",
    durationDaysRange: [5, 10],
    regimens: [
      {
        drug: "Penicillin V", tier: "Preferred", penicillinClass: true,
        adultText: "500mg PO QID (or 1g PO BD) x 5-10 days",
        weightBased: { kind: "mgPerKgPerDay", drug: "Penicillin V", mgPerKgPerDayRange: [25, 50], frequency: "QID", durationDaysRange: [10, 10], maxMgPerDay: 2000 },
      },
      {
        drug: "Amoxicillin", tier: "Preferred", penicillinClass: true,
        adultText: "500mg PO TDS x 5-10 days",
        weightBased: { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [50, 50], frequency: "BD", durationDaysRange: [10, 10], maxMgPerDay: 1000 },
      },
      {
        drug: "Erythromycin Ethylsuccinate", tier: "Alternative",
        adultText: "800mg PO BD x 5-10 days",
        weightBased: { kind: "mgPerKgPerDay", drug: "Erythromycin Ethylsuccinate", mgPerKgPerDayRange: [40, 50], frequency: "BD", durationDaysRange: [10, 10], maxMgPerDay: 1600 },
      },
      {
        // Children's table only — no adult Cephalexin row in this source.
        drug: "Cephalexin", tier: "Alternative",
        weightBased: { kind: "mgPerKgPerDay", drug: "Cephalexin", mgPerKgPerDayRange: [25, 50], frequency: "BD", durationDaysRange: [10, 10], maxMgPerDay: 2000 },
      },
    ],
    allowedDrugs: ["Penicillin V", "Amoxicillin", "Erythromycin Ethylsuccinate", "Cephalexin"],
    cautions: [
      "Only treat if Strep/Centor score >= 3 — most sore throat is viral.",
      "Consider extending to 10 days where rheumatic fever prevalence is high, or in patients aged 3-21 with a personal history of rheumatic fever/rheumatic heart disease.",
    ],
    source: "NAG 2024 — Acute Pharyngitis (v09 Dec 2025)",
  },
  {
    id: "cap",
    indication: "Community Acquired Pneumonia",
    aliases: ["community acquired pneumonia", "community-acquired pneumonia", "cap", "pneumonia"],
    patientGroup: "Any",
    durationDaysRange: [5, 7],
    regimens: [
      {
        drug: "Amoxicillin", tier: "Preferred", penicillinClass: true,
        adultText: "500-1000mg PO TDS x 5-7 days (mild, outpatient, no comorbidities)",
        // Source gives "q8-12h" (2-3 doses/day) — BD is the more common
        // administration for high-dose amoxicillin in practice.
        weightBased: { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "BD", durationDaysRange: [5, 5], maxMgPerDay: 3000 },
      },
      {
        drug: "Doxycycline", tier: "Alternative",
        adultText: "100mg PO BD x 5-7 days",
      },
      {
        // Children's table only — the adult table has no erythromycin row for CAP.
        drug: "Erythromycin Ethylsuccinate", tier: "Alternative",
        weightBased: { kind: "mgPerKgPerDay", drug: "Erythromycin Ethylsuccinate", mgPerKgPerDayRange: [40, 50], frequency: "BD", durationDaysRange: [5, 5], maxMgPerDay: 1600 },
      },
    ],
    allowedDrugs: ["Amoxicillin", "Doxycycline", "Erythromycin Ethylsuccinate"],
    cautions: [
      "For mild, outpatient CAP only — refer if severe, hypoxic, or requiring hospitalisation (CRB-65 >= 2, or SpO2 < 95%).",
      "With comorbidities (chronic heart/lung/liver/kidney disease, diabetes, alcoholism, malignancy, asplenia): use Amoxicillin/Clavulanate 625mg TDS, adding Azithromycin 500mg OD x3 days or Doxycycline if an atypical pathogen is suspected — not modelled here, use the full guideline.",
    ],
    source: "NAG 2024 — Acute Bronchitis and Pneumonia, adult table (v30 Jan 2026)",
  },
  {
    id: "aom",
    indication: "Acute Otitis Media",
    aliases: ["acute otitis media", "aom", "otitis media", "ear infection"],
    patientGroup: "Any",
    durationDaysRange: [5, 10],
    regimens: [
      {
        drug: "Amoxicillin", tier: "Preferred", penicillinClass: true,
        adultText: "500mg PO TDS x 5-7 days",
        // Source gives "q8-12h" (2-3 doses/day) — BD is the more common
        // administration for high-dose amoxicillin in practice.
        weightBased: { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "BD", durationDaysRange: [5, 10], maxMgPerDay: 3000 },
      },
      {
        drug: "Amoxicillin-Clavulanate", tier: "Alternative", penicillinClass: true,
        adultText: "625mg PO TDS x 5-7 days",
        // Children's dosing uses a 14:1/7:1 dual-component formulation —
        // not modelled as mg/kg math here, see cautions.
      },
      {
        drug: "Erythromycin Ethylsuccinate", tier: "Alternative",
        adultText: "400mg PO QID OR 800mg PO BD x 5-7 days",
        weightBased: { kind: "mgPerKgPerDay", drug: "Erythromycin Ethylsuccinate", mgPerKgPerDayRange: [40, 50], frequency: "BD", durationDaysRange: [5, 10], maxMgPerDay: 1600 },
      },
    ],
    allowedDrugs: ["Amoxicillin", "Amoxicillin-Clavulanate", "Erythromycin Ethylsuccinate"],
    cautions: [
      "Assess severity/perforation first — mild cases with an intact tympanic membrane may be observed 48-72h with paracetamol before starting antibiotics.",
      "Amoxicillin/Clavulanate (14:1 formulation) is preferred over Amoxicillin if there was amoxicillin exposure within the last 30 days — dosing not modelled here, use the full guideline table.",
      "Duration: <2 years old 7-10 days; >=2 years old 5-7 days.",
      "Refer ENT for recurrent AOM, persistent otorrhea, suspected mastoiditis, or abnormal audiology.",
    ],
    source: "NAG 2024 — Acute Otitis Media (v16 Oct 2025)",
  },
  {
    id: "abrs",
    indication: "Acute Bacterial Rhinosinusitis",
    aliases: ["acute bacterial rhinosinusitis", "abrs", "rhinosinusitis", "sinusitis"],
    patientGroup: "Any",
    durationDaysRange: [3, 7],
    regimens: [
      {
        drug: "Amoxicillin", tier: "Preferred", penicillinClass: true,
        adultText: "500-1000mg PO TDS x 5 days",
        weightBased: { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "BD", durationDaysRange: [5, 5], maxMgPerDay: 2000 },
      },
      {
        drug: "Amoxicillin-Clavulanate", tier: "Preferred", penicillinClass: true,
        adultText: "625mg PO TDS x 5 days",
      },
      {
        drug: "Doxycycline", tier: "Alternative",
        adultText: "100mg PO BD x 5-7 days",
      },
      {
        drug: "Azithromycin", tier: "Alternative (pregnancy + penicillin allergy)",
        adultText: "500mg PO OD x 3 days",
      },
      {
        // Children's table only — no adult Cefuroxime row for ABRS.
        drug: "Cefuroxime", tier: "Alternative",
        weightBased: { kind: "mgPerKgPerDay", drug: "Cefuroxime", mgPerKgPerDayRange: [30, 30], frequency: "BD", durationDaysRange: [5, 5], maxMgPerDay: 1000 },
      },
    ],
    allowedDrugs: ["Amoxicillin", "Amoxicillin-Clavulanate", "Doxycycline", "Azithromycin", "Cefuroxime"],
    cautions: [
      "Reserve antibiotics for likely ABRS (>=3 of: fever, discoloured mucus, double sickening, severe local pain, raised ESR/CRP) — most acute rhinosinusitis is viral.",
      "Cefuroxime and other cephalosporins carry a small cross-reactivity risk with severe (anaphylactic) penicillin allergy — avoid if there is a history of anaphylaxis, urticaria, or angioedema to penicillins.",
    ],
    source: "NAG 2024 — Acute Rhinosinusitis (v10 Sept 2025)",
  },
  {
    id: "ssti",
    indication: "Skin and Soft Tissue Infection",
    aliases: ["skin and soft tissue infection", "ssti", "cellulitis", "skin infection", "impetigo"],
    patientGroup: "Any",
    durationDaysRange: [5, 10],
    regimens: [
      {
        drug: "Cephalexin", tier: "Preferred",
        adultText: "1000mg PO BD x 5-10 days (cellulitis)",
        weightBased: { kind: "mgPerKgPerDay", drug: "Cephalexin", mgPerKgPerDayRange: [25, 50], frequency: "BD", durationDaysRange: [5, 7], maxMgPerDay: 2000 },
      },
      {
        drug: "Cloxacillin", tier: "Preferred", penicillinClass: true,
        adultText: "500mg PO QID x 5-10 days (cellulitis)",
        // Doses recommended in the source are for children weighing <25kg;
        // the maxMgPerDay cap already converges toward the adult dose as
        // weight rises (2000mg/day cap = the adult 500mg QID regimen).
        weightBased: { kind: "mgPerKgPerDay", drug: "Cloxacillin", mgPerKgPerDayRange: [50, 100], frequency: "QID", durationDaysRange: [5, 7], maxMgPerDay: 2000 },
      },
      {
        drug: "Amoxicillin-Clavulanate", tier: "Alternative", penicillinClass: true,
        adultText: "625mg PO TDS x 5-10 days",
      },
      {
        drug: "Erythromycin Ethylsuccinate", tier: "Antibiotic allergy",
        adultText: "800mg PO BD x 5-7 days",
      },
    ],
    allowedDrugs: ["Cephalexin", "Cloxacillin", "Amoxicillin-Clavulanate", "Erythromycin Ethylsuccinate"],
    cautions: [
      "Amoxicillin 500mg PO TDS x 5-10 days may also be used for cellulitis.",
      "Abscess: incision & drainage is first-line; take pus for C&S before starting antibiotics; add antibiotics only if extensive surrounding cellulitis, inadequate drainage, diabetes mellitus, or valvular heart disease.",
      "Localised impetigo: use topical 2% fusidic acid or 2% mupirocin, not oral antibiotics — reserve oral therapy for generalised impetigo or cellulitis.",
    ],
    source: "NAG 2024 — Skin and Soft Tissue Infection (v30 Jan 2026)",
  },
  {
    id: "uti",
    indication: "Uncomplicated Urinary Tract Infection",
    aliases: ["urinary tract infection", "uti", "uncomplicated urinary tract infection", "cystitis"],
    patientGroup: "Adult",
    durationDaysRange: [3, 5],
    // No paediatric UTI table in this source — every option is adult-only.
    regimens: [
      { drug: "Nitrofurantoin", tier: "Preferred", adultText: "50-100mg PO QID (immediate release) OR 100mg PO BD (modified release) x 5 days" },
      { drug: "Cephalexin", tier: "Preferred", adultText: "500mg PO BD-QID x 5 days" },
      { drug: "Amoxicillin-Clavulanate", tier: "Alternative", penicillinClass: true, adultText: "625mg PO TDS x 3-5 days" },
      { drug: "Ampicillin-Sulbactam", tier: "Alternative", penicillinClass: true, adultText: "375-750mg PO BD x 3-5 days" },
      { drug: "Cefuroxime", tier: "Alternative", adultText: "250-500mg PO BD x 3-5 days" },
    ],
    allowedDrugs: ["Nitrofurantoin", "Cephalexin", "Amoxicillin-Clavulanate", "Ampicillin-Sulbactam", "Cefuroxime"],
    cautions: [
      "Nitrofurantoin is contraindicated if eGFR < 30 mL/min.",
      "Consider QID dosing frequency, and consider urine culture rather than empirical treatment alone, in patients at risk of complicated UTI (immunosuppressed, poorly controlled diabetes, post-menopausal, urinary tract obstruction/urolithiasis, UTI in men, CKD, catheter in situ, neurogenic bladder, recurrent UTI).",
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
  /** True when a pathway matched the indication but is written for a different group. */
  groupMismatch: boolean;
  /** The indication that matched, even when rejected for group — for messaging. */
  mismatchedIndication: string | null;
}

/**
 * Finds the NAG pathway matching a derivePathwayIndication() result.
 * Indication only — there is deliberately no free-text diagnosis fallback.
 * A doctor's shorthand diagnosis (typed to satisfy a required field, not
 * meant as a precise clinical term) used to be tried when the checklist
 * didn't cross any pathway's threshold, which could silently match — or
 * silently fail to match — on wording never meant to drive the suggestion.
 * The checklist tick is the only signal now; no tick, no match.
 *
 * SAFETY: this used to end in `?? pool[0]`, which handed back a pathway even
 * when its patientGroup conflicted with the patient's. A 6-year-old with
 * pneumonia therefore received the adult CAP regimen — "Amoxicillin 500mg-1g
 * PO TDS", roughly 150 mg/kg/day for a 20kg child — labelled as a confident
 * NAG match. A group mismatch now yields no pathway, and callers refer to a
 * specialist instead of substituting a dose.
 */
export function matchPathwayDetailed(
  indication: string | null,
  patientGroup: PatientGroup,
): PathwayMatch {
  const pool = indication ? NAG_PATHWAYS.filter((p) => matchesAlias(indication, p)) : [];

  if (pool.length === 0) return { pathway: null, groupMismatch: false, mismatchedIndication: null };

  const compatible = pool.find((p) => groupCompatible(p, patientGroup));
  if (compatible) return { pathway: compatible, groupMismatch: false, mismatchedIndication: null };

  return { pathway: null, groupMismatch: true, mismatchedIndication: pool[0].indication };
}

/** Back-compat wrapper: the pathway only, or null. */
export function matchPathway(
  indication: string | null,
  patientGroup: PatientGroup,
): NagPathway | null {
  return matchPathwayDetailed(indication, patientGroup).pathway;
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
