// src/lib/abxDose.ts
// Weight-based antibiotic dose math for the NAG 2024 pathways in
// nagPathways.ts. Kept separate from paedsDose.ts (over-the-counter
// paediatric symptomatic drugs) — different data source, different
// rounding (whole mg, not 3dp), different regulatory weight (a controlled
// antibiotic regimen, not a cough syrup).
//
// The AbxWeightRule/AbxDoseResult/computeAbxDose section below is mirrored
// verbatim into supabase/functions/_shared/abxDose.ts (parity-tested)
// because the edge bundle cannot import outside supabase/functions/ — the
// antibiotic-suggest edge function and the antibiotic form must compute the
// identical number from the identical code.

// <<<shared-abxdose
export type AbxWeightRule =
  | {
      kind: "mgPerKgPerDay";
      drug: string;
      mgPerKgPerDayRange: [number, number];
      frequency: string;
      durationDaysRange: [number, number];
      maxMgPerDay?: number;
    }
  | {
      kind: "mgPerKgPerDose";
      drug: string;
      mgPerKgPerDose: number;
      frequency: string;
      durationDaysRange: [number, number];
      maxMgPerDose?: number;
    }
  | {
      kind: "loadTaper";
      drug: string;
      loadMgPerKg: number;
      loadDays: number;
      maintMgPerKg: number;
      maintDays: number;
      frequency: string;
      maxMgPerDose?: number;
    };

export interface AbxDoseResult {
  drug: string;
  /** ready-to-paste regimen line, e.g. "Amoxicillin 1120-1260 mg/day PO divided BD x 5-7 days" */
  text: string;
  /** shown working, e.g. "80-90 mg/kg/day x 14 kg" */
  basis: string;
  /** set when a max-dose cap was applied */
  capped: boolean;
}

function roundMg(value: number): number {
  return Math.round(value);
}

/** Computes a ready-to-prescribe regimen from a weight-based NAG rule and a
 *  patient weight. Returns null for a non-finite or non-positive weight —
 *  callers treat that the same as "no weight given yet". */
export function computeAbxDose(rule: AbxWeightRule, weightKg: number): AbxDoseResult | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

  if (rule.kind === "mgPerKgPerDay") {
    const [lo, hi] = rule.mgPerKgPerDayRange;
    let doseLow = roundMg(weightKg * lo);
    let doseHigh = roundMg(weightKg * hi);
    let capped = false;
    if (rule.maxMgPerDay != null) {
      capped = doseHigh > rule.maxMgPerDay;
      doseLow = Math.min(doseLow, rule.maxMgPerDay);
      doseHigh = Math.min(doseHigh, rule.maxMgPerDay);
    }
    const amount = doseLow === doseHigh ? `${doseLow}` : `${doseLow}-${doseHigh}`;
    const [dMin, dMax] = rule.durationDaysRange;
    const duration = dMin === dMax ? `${dMin} days` : `${dMin}-${dMax} days`;
    return {
      drug: rule.drug,
      text: `${rule.drug} ${amount}mg/day ${rule.frequency} x ${duration}`,
      basis: `${lo}-${hi} mg/kg/day x ${weightKg} kg`,
      capped,
    };
  }

  if (rule.kind === "mgPerKgPerDose") {
    let dose = roundMg(weightKg * rule.mgPerKgPerDose);
    let capped = false;
    if (rule.maxMgPerDose != null && dose > rule.maxMgPerDose) {
      dose = rule.maxMgPerDose;
      capped = true;
    }
    const [dMin, dMax] = rule.durationDaysRange;
    const duration = dMin === dMax ? `${dMin} days` : `${dMin}-${dMax} days`;
    return {
      drug: rule.drug,
      text: `${rule.drug} ${dose}mg ${rule.frequency} x ${duration}`,
      basis: `${rule.mgPerKgPerDose} mg/kg/dose x ${weightKg} kg`,
      capped,
    };
  }

  // loadTaper — e.g. paediatric azithromycin: a load dose for one day, then a
  // lower maintenance dose for the remaining days.
  let loadDose = roundMg(weightKg * rule.loadMgPerKg);
  let maintDose = roundMg(weightKg * rule.maintMgPerKg);
  let capped = false;
  if (rule.maxMgPerDose != null) {
    capped = loadDose > rule.maxMgPerDose || maintDose > rule.maxMgPerDose;
    loadDose = Math.min(loadDose, rule.maxMgPerDose);
    maintDose = Math.min(maintDose, rule.maxMgPerDose);
  }
  const totalDays = rule.loadDays + rule.maintDays;
  return {
    drug: rule.drug,
    text: `${rule.drug} ${loadDose}mg ${rule.frequency} day 1, then ${maintDose}mg ${rule.frequency} days 2-${totalDays}`,
    basis: `${rule.loadMgPerKg} mg/kg day 1, ${rule.maintMgPerKg} mg/kg days 2-${totalDays} x ${weightKg} kg`,
    capped,
  };
}
// shared-abxdose>>>

import type { ChecklistState } from "./doseQuery";
import { derivePathwayIndication } from "./doseQuery";
import { matchPathwayDetailed, patientGroupFromAge } from "./nagPathways";

export type LocalDoseUnavailable = "noWeight" | "noPathway" | "noRule";

export interface LocalDoseAlternative {
  result: AbxDoseResult;
  /** Why this is the alternative — e.g. "Penicillin allergy", or "Preferred (no allergy)" when the main result is the allergy option. */
  label: string;
}

export interface LocalDoseMatch {
  result: AbxDoseResult;
  source: string;
  warning: string | null;
  /** The other weight-based option for this pathway, when one exists — shown
   *  alongside `result` so the doctor sees both without re-ticking the
   *  allergy toggle. */
  alternative?: LocalDoseAlternative;
}

/** Resolves a paediatric antibiotic dose entirely client-side, from the same
 *  NAG_PATHWAYS data and computeAbxDose() math the antibiotic-suggest edge
 *  function uses server-side — so the on-screen card and the AI fallback
 *  never disagree. Never makes a network call. */
export function resolveLocalDose(input: {
  checklist: ChecklistState;
  diagnosis: string;
  age: number | null;
  weightKg: number | null;
  hasAllergy: boolean;
}): LocalDoseMatch | { unavailable: LocalDoseUnavailable } {
  if (input.weightKg == null || !Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    return { unavailable: "noWeight" };
  }

  const patientGroup = patientGroupFromAge(input.age);
  const indication = derivePathwayIndication(input.checklist);
  const { pathway } = matchPathwayDetailed(indication, input.diagnosis, patientGroup);
  if (!pathway) return { unavailable: "noPathway" };

  const rule = input.hasAllergy ? pathway.allergyWeightBased ?? pathway.weightBased : pathway.weightBased;
  if (!rule) return { unavailable: "noRule" };

  const result = computeAbxDose(rule, input.weightKg);
  if (!result) return { unavailable: "noWeight" };

  // The option not shown as `result` — primary when `result` is the allergy
  // regimen, or the allergy regimen when `result` is primary — computed
  // regardless of the allergy toggle so both are visible together.
  const otherRule = rule === pathway.allergyWeightBased ? pathway.weightBased : pathway.allergyWeightBased;
  const otherResult = otherRule ? computeAbxDose(otherRule, input.weightKg) : null;
  const alternative: LocalDoseAlternative | undefined = otherResult
    ? {
        result: otherResult,
        label: otherRule === pathway.allergyWeightBased
          ? (pathway.alternatives[0]?.when ?? "Alternative")
          : "Preferred (no allergy)",
      }
    : undefined;

  return {
    result,
    source: pathway.source,
    warning: input.hasAllergy ? `Allergy noted — this is the NAG alternative regimen, confirm before prescribing.` : null,
    alternative,
  };
}
