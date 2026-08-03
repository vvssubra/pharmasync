// supabase/functions/antibiotic-suggest/resolve.ts
// Deterministic regimen resolution against NAG_PATHWAYS. computeAbxDose()
// already renders the regimen in the clinic's own prescribing shorthand
// (TDS/BD/OD/QID, no filler) — there is nothing left for a model to usefully
// add, and an earlier "phrase this naturally" LLM pass made the suggestion
// worse (verbose prose instead of the terse line a doctor writes). This
// module never calls a model; it only computes.

import { derivePathwayIndication, type ChecklistState, type PatientGroup } from "../_shared/doseQuery.ts";
import { matchPathwayDetailed, patientGroupFromAge, isStatedAllergy, identifyDrug, type NagPathway, type PathwayMatch } from "../_shared/nagPathways.ts";
import { computeAbxDose } from "../_shared/abxDose.ts";

/** The primary (non-allergy) regimen text, computed by weight when possible
 *  — used as the "alternative" shown alongside an allergy regimen. */
function primaryRegimenText(pathway: NagPathway, patientGroup: PatientGroup, weightKg: number | undefined): string {
  if (patientGroup === "Paediatric" && pathway.weightBased && weightKg != null) {
    const dose = computeAbxDose(pathway.weightBased, weightKg);
    if (dose) return dose.text;
  }
  return pathway.firstLine;
}

/** The allergy-alternative regimen text, computed by weight when possible,
 *  falling back to the pathway's plain alternatives[0] text. Null when the
 *  pathway has no alternative at all. */
function allergyRegimenText(pathway: NagPathway, patientGroup: PatientGroup, weightKg: number | undefined): string | null {
  if (patientGroup === "Paediatric" && pathway.allergyWeightBased && weightKg != null) {
    const dose = computeAbxDose(pathway.allergyWeightBased, weightKg);
    if (dose) return dose.text;
  }
  return pathway.alternatives[0]?.regimen ?? null;
}

/**
 * The resolved regimen already names an allowed drug (it's built from
 * pathway.firstLine / pathway.alternatives), so this only needs to catch
 * the model straying off of it — not run a full drug-name NER pass. Identity
 * is resolved through identifyDrug() against the full known-drug vocabulary
 * (not a plain substring test against allowedDrugs) so a compound name like
 * "Amoxicillin-Clavulanate" is never counted as the shorter, differently
 * -indicated "Amoxicillin" just because it contains it. No recognized drug
 * at all, or a recognized drug outside this pathway's allowedDrugs, is a
 * violation — fall back to the verbatim regimen either way.
 */
export function violatesDrugAllowlist(suggestion: string, allowedDrugs: string[]): boolean {
  const identified = identifyDrug(suggestion);
  if (!identified) return true;
  return !allowedDrugs.some((d) => d.toLowerCase() === identified.toLowerCase());
}

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
  /** The other option for this pathway — the allergy alternative when
   *  `regimenText` is the primary regimen, or the primary regimen when
   *  `regimenText` is itself the allergy alternative. Undefined only when
   *  no pathway matched, or the pathway has no alternative at all. */
  alternative?: { regimenText: string; label: string };
}

function resolvePathway(input: ResolveInput): PathwayMatch {
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
  return matchPathwayDetailed(indicationText, input.diagnosis, patientGroup);
}

export function resolveCase(input: ResolveInput): ResolvedCase {
  const { pathway, groupMismatch, mismatchedIndication } = resolvePathway(input);

  // A pathway written for another patient group must never be substituted.
  // Only AOM carries paediatric weight-based dosing, so before this guard a
  // child with pneumonia was handed the adult CAP regimen as a confident
  // "NAG pathway match". Refusing is the safe answer; a wrong dose is not.
  if (groupMismatch) {
    const group = patientGroupFromAge(input.patient_age).toLowerCase();
    return {
      pathway: null,
      regimenText: "Refer to specialist — no NAG 2024 regimen for this patient group",
      rationale: `The NAG ${mismatchedIndication ?? "pathway"} in this system is written for a different patient group, so it cannot be applied to a ${group} patient. Consult the NAG ${group === "paediatric" ? "Section B (Paediatrics)" : "Section A (Adult)"} dosing tables directly.`,
      warning: "Do not use an adult regimen for a paediatric patient — dosing is weight-based.",
    };
  }

  if (!pathway) {
    return {
      pathway: null,
      regimenText: "Refer to specialist — no matching NAG 2024 pathway found",
      rationale: "The diagnosis / checklist findings do not match any NAG 2024 pathway in this system.",
      warning: null,
    };
  }

  const hasAllergy = isStatedAllergy(input.allergy_status);
  const patientGroup = patientGroupFromAge(input.patient_age);

  if (hasAllergy && pathway.alternatives.length > 0) {
    const alt = pathway.alternatives[0];
    const alternative = { regimenText: primaryRegimenText(pathway, patientGroup, input.patient_weight_kg), label: "Preferred (no allergy)" };
    // The allergy alternative itself is weight-based (e.g. paediatric
    // erythromycin) — compute it through the same math the antibiotic
    // form's local dose card uses, rather than handing back the fixed
    // adult-shaped alternative text to a child.
    if (patientGroup === "Paediatric" && pathway.allergyWeightBased && input.patient_weight_kg != null) {
      const dose = computeAbxDose(pathway.allergyWeightBased, input.patient_weight_kg);
      if (dose) {
        return {
          pathway,
          regimenText: dose.text,
          rationale: `NAG ${pathway.indication} allergy alternative, weight-based dosing: ${dose.basis}.`,
          warning: `Allergy noted (${input.allergy_status}) — this is the NAG alternative regimen, confirm before prescribing.${dose.capped ? " Dose capped at label maximum." : ""}`,
          alternative,
        };
      }
    }
    return {
      pathway,
      regimenText: alt.regimen,
      rationale: `NAG ${pathway.indication} alternative for ${alt.when.toLowerCase()}.`,
      warning: `Allergy noted (${input.allergy_status}) — this is the NAG alternative regimen, confirm before prescribing.`,
      alternative,
    };
  }

  if (patientGroup === "Paediatric" && pathway.weightBased && input.patient_weight_kg != null) {
    const dose = computeAbxDose(pathway.weightBased, input.patient_weight_kg);
    if (dose) {
      const altText = allergyRegimenText(pathway, patientGroup, input.patient_weight_kg);
      return {
        pathway,
        regimenText: dose.text,
        rationale: `Weight-based dosing per NAG ${pathway.indication}: ${dose.basis}.`,
        warning: dose.capped ? "Dose capped at label maximum." : null,
        alternative: altText ? { regimenText: altText, label: pathway.alternatives[0]?.when ?? "Alternative" } : undefined,
      };
    }
  }

  // No allergy, and either not weight-based or no weight given to compute
  // with (the generic mg/kg formula in firstLine is still verbatim-correct
  // NAG text even without a specific weight) — nothing left to decide.
  const altText = pathway.alternatives[0]?.regimen ?? null;
  return {
    pathway,
    regimenText: pathway.firstLine,
    rationale: `NAG ${pathway.indication} first-line regimen (${pathway.source}).`,
    warning: pathway.cautions[0] ?? null,
    alternative: altText ? { regimenText: altText, label: pathway.alternatives[0].when } : undefined,
  };
}
