// src/lib/paedsDose.ts
//
// Evaluation for the paediatric dose calculator. Pure functions only — the
// drug table lives in paedsDoses.ts and is the artifact clinicians review.
//
// Age is carried in whole months throughout. "2-5 years" in the source tables
// means children aged 2 up to their 6th birthday, so it becomes [24, 72) —
// minMonths inclusive, maxMonths exclusive.

export interface Preparation {
  /** As printed on the bottle, e.g. "120mg/5ml". Shown for reference only —
   *  the calculator does not convert a dose into a volume. */
  label: string;
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
  /** Shown under the drug name when something about the entry needs saying —
   *  an unconfirmed strength, a gap or overlap in the source bands. */
  caution?: string;
  /** Reached for often enough at this clinic to be worth finding without
   *  reading the list. Marked on the card and offered as a filter. */
  frequentlyUsed?: boolean;
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
  /** A dose was resolved. amount is mg unless unit is "ml" — which happens
   *  only where the source itself publishes a volume (lactulose). Nothing is
   *  converted between the two. */
  | { kind: "dose"; min: number; max?: number; unit: "mg" | "ml"; freq: string; note?: string; basis?: string }
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
          const perKg = rule.mgPerKgMax === undefined
            ? `${rule.mgPerKgMin}`
            : `${rule.mgPerKgMin}–${rule.mgPerKgMax}`;
          return {
            kind: "dose", min, max, unit: "mg", freq: rule.freq, note: rule.note,
            basis: `${perKg} mg/kg × ${patient.weightKg} kg`,
          };
        }
        break;

      case "volume":
        if (inAgeBand(rule, patient.ageMonths)) {
          return { kind: "dose", min: rule.mlMin, max: rule.mlMax, unit: "ml", freq: rule.freq, note: rule.note };
        }
        break;

      case "mlPerKg":
        if (inAgeBand(rule, patient.ageMonths)) {
          return {
            kind: "dose", min: rule.mlPerKg * patient.weightKg, unit: "ml", freq: rule.freq, note: rule.note,
            basis: `${rule.mlPerKg} mL/kg × ${patient.weightKg} kg`,
          };
        }
        break;
    }
  }
  return { kind: "outOfBand" };
}

function cap(value: number, maxMg?: number) {
  return maxMg === undefined ? value : Math.min(value, maxMg);
}

/**
 * Volumes are read off a syringe, so one decimal is the useful precision.
 */
export function roundMl(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Milligrams keep three decimals. Rounding these to one decimal would print
 * desloratadine's published 1.25 mg as "1.3 mg" and triprolidine's 0.313 mg as
 * "0.3 mg" — a clinician checking the screen against the printed table would
 * find figures that do not match, which is the fastest way to lose trust in
 * the whole tool.
 */
export function roundMg(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** "180 mg" or "60–120 mg". Precision follows the unit — see roundMg. */
export function formatAmount(min: number, max: number | undefined, unit: string): string {
  const round = unit === "mg" ? roundMg : roundMl;
  const lo = round(min);
  if (max === undefined) return `${lo} ${unit}`;
  const hi = round(max);
  if (hi === lo) return `${lo} ${unit}`;
  return `${lo}–${hi} ${unit}`;
}

export function ageToMonths(years: number, months: number): number {
  return years * 12 + months;
}
