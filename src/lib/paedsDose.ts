// src/lib/paedsDose.ts
//
// Evaluation for the paediatric dose calculator. Pure functions only — the
// drug table lives in paedsDoses.ts and is the artifact clinicians review.
//
// Age is carried in whole months throughout. "2-5 years" in the source tables
// means children aged 2 up to their 6th birthday, so it becomes [24, 72) —
// minMonths inclusive, maxMonths exclusive.

export type DoseSource = "mims" | "shann";

export interface Preparation {
  /** As printed on the bottle, e.g. "120mg/5ml". */
  label: string;
  /** Null for preparations dosed by volume alone (lactulose) or where the
   *  strength has not been confirmed — both suppress the mL calculation. */
  mgPerMl: number | null;
}

interface AgeBand {
  /** Inclusive. Omitted means "from birth". */
  minMonths?: number;
  /** Exclusive. Omitted means "no upper limit". */
  maxMonths?: number;
}

interface WeightBand {
  /** Inclusive. */
  minKg?: number;
  /** Exclusive. */
  maxKg?: number;
}

export type Rule =
  | (AgeBand & WeightBand & { kind: "fixed"; mgMin: number; mgMax?: number; freq: string; note?: string })
  | (AgeBand & { kind: "perKg"; mgPerKgMin: number; mgPerKgMax?: number; maxMg?: number; freq: string; note?: string })
  | (AgeBand & { kind: "volume"; mlMin: number; mlMax?: number; freq: string; note?: string })
  | (AgeBand & { kind: "mlPerKg"; mlPerKg: number; freq: string; note?: string })
  | { kind: "notRecommended"; belowMonths: number; note: string }
  | { kind: "noData"; note: string };

export interface Drug {
  id: string;
  name: string;
  category: CategoryId;
  preparations: Preparation[];
  mims: Rule[];
  shann: Rule[];
  /** Shown under the drug name when something about the entry needs saying —
   *  an unconfirmed strength, a gap or overlap in the source bands. */
  caution?: string;
}

export type CategoryId =
  | "fever"
  | "antihistamine"
  | "decongestant"
  | "wetCough"
  | "dryCough"
  | "misc";

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  fever: "Fever",
  antihistamine: "Antihistamine",
  decongestant: "Decongestant",
  wetCough: "Wet Cough",
  dryCough: "Dry Cough",
  misc: "Miscellaneous",
};

/** Order the categories are rendered in — Fever first, as in the source. */
export const CATEGORY_ORDER: CategoryId[] = [
  "fever", "antihistamine", "decongestant", "wetCough", "dryCough", "misc",
];

export type DoseOutcome =
  /** A dose was resolved. amount is mg unless unit is "ml". */
  | { kind: "dose"; min: number; max?: number; unit: "mg" | "ml"; freq: string; note?: string }
  /** The drug is contraindicated at this age; no number is offered. */
  | { kind: "notRecommended"; note: string }
  /** The source publishes no dose for this drug/indication at all. */
  | { kind: "noData"; note: string }
  /** The patient falls outside every band this source publishes. */
  | { kind: "outOfBand" };

export interface Patient {
  ageMonths: number;
  weightKg: number;
}

function inAgeBand(rule: AgeBand, ageMonths: number): boolean {
  if (rule.minMonths !== undefined && ageMonths < rule.minMonths) return false;
  if (rule.maxMonths !== undefined && ageMonths >= rule.maxMonths) return false;
  return true;
}

function inWeightBand(rule: WeightBand, weightKg: number): boolean {
  if (rule.minKg !== undefined && weightKg < rule.minKg) return false;
  if (rule.maxKg !== undefined && weightKg >= rule.maxKg) return false;
  return true;
}

/**
 * Resolves one source's rules against a patient. Rules are tried in the order
 * the source lists them, so where the published bands overlap (cetirizine's
 * "2-6 years" and "6-12 years" both cover a 6-year-old) the younger band wins
 * — the same way a reader working down the table would resolve it.
 */
export function evaluate(rules: Rule[], patient: Patient): DoseOutcome {
  for (const rule of rules) {
    switch (rule.kind) {
      case "notRecommended":
        if (patient.ageMonths < rule.belowMonths) {
          return { kind: "notRecommended", note: rule.note };
        }
        break;

      case "noData":
        return { kind: "noData", note: rule.note };

      case "fixed":
        if (inAgeBand(rule, patient.ageMonths) && inWeightBand(rule, patient.weightKg)) {
          return { kind: "dose", min: rule.mgMin, max: rule.mgMax, unit: "mg", freq: rule.freq, note: rule.note };
        }
        break;

      case "perKg":
        if (inAgeBand(rule, patient.ageMonths)) {
          const min = cap(rule.mgPerKgMin * patient.weightKg, rule.maxMg);
          const max = rule.mgPerKgMax === undefined
            ? undefined
            : cap(rule.mgPerKgMax * patient.weightKg, rule.maxMg);
          return { kind: "dose", min, max, unit: "mg", freq: rule.freq, note: rule.note };
        }
        break;

      case "volume":
        if (inAgeBand(rule, patient.ageMonths)) {
          return { kind: "dose", min: rule.mlMin, max: rule.mlMax, unit: "ml", freq: rule.freq, note: rule.note };
        }
        break;

      case "mlPerKg":
        if (inAgeBand(rule, patient.ageMonths)) {
          return { kind: "dose", min: rule.mlPerKg * patient.weightKg, unit: "ml", freq: rule.freq, note: rule.note };
        }
        break;
    }
  }
  return { kind: "outOfBand" };
}

function cap(value: number, maxMg?: number) {
  return maxMg === undefined ? value : Math.min(value, maxMg);
}

/** Doses are read off a syringe, so one decimal is the useful precision. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Volume to draw up for a resolved dose, or null when it cannot be computed —
 * an unconfirmed strength, a non-liquid preparation, or a dose that is already
 * expressed in mL.
 */
export function toMl(outcome: DoseOutcome, prep: Preparation): { min: number; max?: number } | null {
  if (outcome.kind !== "dose") return null;
  if (outcome.unit === "ml") return { min: round1(outcome.min), max: outcome.max === undefined ? undefined : round1(outcome.max) };
  if (prep.mgPerMl === null) return null;
  return {
    min: round1(outcome.min / prep.mgPerMl),
    max: outcome.max === undefined ? undefined : round1(outcome.max / prep.mgPerMl),
  };
}

/** "180 mg" or "60–120 mg", already rounded. */
export function formatAmount(min: number, max: number | undefined, unit: string): string {
  const lo = round1(min);
  if (max === undefined) return `${lo} ${unit}`;
  const hi = round1(max);
  if (hi === lo) return `${lo} ${unit}`;
  return `${lo}–${hi} ${unit}`;
}

export function ageToMonths(years: number, months: number): number {
  return years * 12 + months;
}
