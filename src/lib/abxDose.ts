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
import { matchPathwayDetailed, patientGroupFromAge, computeRegimenOptions, type ComputedRegimen } from "./nagPathways";

export type LocalDoseUnavailable = "noWeight" | "noPathway" | "noRule";

export interface LocalDoseMatch {
  /** Every regimen option the matched pathway documents, in the source's own
   *  Preferred-then-Alternative order — weight-computed where the source's
   *  children's table allows it, adult reference text otherwise. */
  options: ComputedRegimen[];
  source: string;
  /** Whether the patient has a stated drug allergy — the card uses this to
   *  flag penicillin-class options, not to hide any of them. */
  hasAllergy: boolean;
}

/** Resolves every antibiotic option NAG_PATHWAYS documents for the checklist's
 *  matched pathway, entirely client-side — the same data and computeAbxDose()
 *  math the antibiotic-suggest edge function uses server-side, so the local
 *  card and the AI suggestion never disagree. Never makes a network call. */
export function resolveLocalDose(input: {
  checklist: ChecklistState;
  age: number | null;
  weightKg: number | null;
  hasAllergy: boolean;
}): LocalDoseMatch | { unavailable: LocalDoseUnavailable } {
  if (input.weightKg == null || !Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    return { unavailable: "noWeight" };
  }

  const patientGroup = patientGroupFromAge(input.age);
  const indication = derivePathwayIndication(input.checklist);
  const { pathway } = matchPathwayDetailed(indication, patientGroup);
  if (!pathway) return { unavailable: "noPathway" };

  const options = computeRegimenOptions(pathway, patientGroup, input.weightKg);
  if (options.length === 0) return { unavailable: "noRule" };

  return { options, source: pathway.source, hasAllergy: input.hasAllergy };
}
