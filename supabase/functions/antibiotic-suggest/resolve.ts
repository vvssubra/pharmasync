// supabase/functions/antibiotic-suggest/resolve.ts
// Deterministic regimen resolution against NAG_PATHWAYS. The model is only
// ever asked to phrase a decision that has already been made in
// TypeScript — it can rephrase or lightly reformat, but it never chooses
// the drug, dose, or duration itself.

import { derivePathwayIndication, type ChecklistState } from "../_shared/doseQuery.ts";
import { matchPathway, patientGroupFromAge, isStatedAllergy, type NagPathway } from "../_shared/nagPathways.ts";

export interface ResolveInput {
  diagnosis: string;
  checklist?: unknown;
  patient_age?: number;
  allergy_status?: string;
  patient_weight_kg?: number;
}

export interface ResolvedCase {
  pathway: NagPathway | null;
  regimenText: string;
  rationale: string;
  warning: string | null;
  /** true only for the two genuinely variable cases (allergy branch,
   *  paediatric weight-based dosing with a weight given) — everything else
   *  is returned verbatim with no LLM call at all. */
  needsLlmPhrasing: boolean;
}

function resolvePathway(input: ResolveInput): NagPathway | null {
  let checklistIndication: string | null = null;
  if (input.checklist && typeof input.checklist === "object") {
    try {
      checklistIndication = derivePathwayIndication(input.checklist as ChecklistState);
    } catch {
      checklistIndication = null;
    }
  }
  const patientGroup = patientGroupFromAge(input.patient_age);
  const indicationText = checklistIndication ?? input.diagnosis;
  return matchPathway(indicationText, input.diagnosis, patientGroup);
}

export function resolveCase(input: ResolveInput): ResolvedCase {
  const pathway = resolvePathway(input);
  if (!pathway) {
    return {
      pathway: null,
      regimenText: "Refer to specialist — no matching NAG 2024 pathway found",
      rationale: "The diagnosis / checklist findings do not match any NAG 2024 pathway in this system.",
      warning: null,
      needsLlmPhrasing: false,
    };
  }

  const hasAllergy = isStatedAllergy(input.allergy_status);
  if (hasAllergy && pathway.alternatives.length > 0) {
    const alt = pathway.alternatives[0];
    return {
      pathway,
      regimenText: alt.regimen,
      rationale: `NAG ${pathway.indication} alternative for ${alt.when.toLowerCase()}.`,
      warning: `Allergy noted (${input.allergy_status}) — this is the NAG alternative regimen, confirm before prescribing.`,
      needsLlmPhrasing: true,
    };
  }

  const patientGroup = patientGroupFromAge(input.patient_age);
  if (patientGroup === "Paediatric" && pathway.weightBased && input.patient_weight_kg != null) {
    const { drug, mgPerKgPerDayRange: [lo, hi], frequency, durationDaysRange: [dMin, dMax] } = pathway.weightBased;
    const doseLow = Math.round(input.patient_weight_kg * lo);
    const doseHigh = Math.round(input.patient_weight_kg * hi);
    const regimenText = `${drug} ${doseLow}-${doseHigh} mg/day PO ${frequency} x ${dMin}-${dMax} days`;
    return {
      pathway,
      regimenText,
      rationale: `Weight-based dosing per NAG ${pathway.indication}: ${lo}-${hi} mg/kg/day for a ${input.patient_weight_kg}kg patient.`,
      warning: null,
      needsLlmPhrasing: true,
    };
  }

  // No allergy, and either not weight-based or no weight given to compute
  // with (the generic mg/kg formula in firstLine is still verbatim-correct
  // NAG text even without a specific weight) — nothing left to decide.
  return {
    pathway,
    regimenText: pathway.firstLine,
    rationale: `NAG ${pathway.indication} first-line regimen (${pathway.source}).`,
    warning: pathway.cautions[0] ?? null,
    needsLlmPhrasing: false,
  };
}
