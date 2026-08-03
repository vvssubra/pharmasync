// supabase/functions/antibiotic-suggest/resolve.ts
// Deterministic regimen resolution against NAG_PATHWAYS. computeRegimenOptions()
// already renders every documented drug in the clinic's own prescribing
// shorthand (TDS/BD/OD/QID, no filler) — there is nothing left for a model
// to usefully add, and an earlier "phrase this naturally" LLM pass made the
// suggestion worse (verbose prose instead of the terse lines a doctor
// writes). This module never calls a model; it only computes.
//
// Matching is checklist-only — derivePathwayIndication(checklist) is the
// sole signal into matchPathwayDetailed(). There is deliberately no
// free-text diagnosis fallback: a doctor's shorthand diagnosis (typed to
// satisfy a required field, not meant as a precise clinical term) must
// never silently redirect which pathway is suggested.

import { derivePathwayIndication, type ChecklistState } from "../_shared/doseQuery.ts";
import { matchPathwayDetailed, patientGroupFromAge, isStatedAllergy, identifyDrug, computeRegimenOptions, type NagPathway, type ComputedRegimen, type PathwayMatch } from "../_shared/nagPathways.ts";

/**
 * Every regimen this function can return names an allowed drug (regimens are
 * built straight from `pathway.regimens`), so this only needs to catch a
 * caller straying off it — not run a full drug-name NER pass. Identity is
 * resolved through identifyDrug() against the full known-drug vocabulary
 * (not a plain substring test against allowedDrugs) so a compound name like
 * "Amoxicillin-Clavulanate" is never counted as the shorter, differently
 * -indicated "Amoxicillin" just because it contains it.
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
  /** Every regimen option the matched pathway documents — empty when no
   *  pathway matched (see `rationale` for the refer-to-specialist message). */
  regimens: ComputedRegimen[];
  rationale: string;
  warning: string | null;
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
  return matchPathwayDetailed(checklistIndication, patientGroup);
}

export function resolveCase(input: ResolveInput): ResolvedCase {
  const { pathway, groupMismatch, mismatchedIndication } = resolvePathway(input);

  // A pathway written for another patient group must never be substituted.
  // A child with pneumonia was once handed the adult CAP regimen as a
  // confident "NAG pathway match". Refusing is the safe answer; a wrong
  // dose is not.
  if (groupMismatch) {
    const group = patientGroupFromAge(input.patient_age).toLowerCase();
    return {
      pathway: null,
      regimens: [],
      rationale: `The NAG ${mismatchedIndication ?? "pathway"} in this system is written for a different patient group, so it cannot be applied to a ${group} patient. Consult the NAG ${group === "paediatric" ? "Section B (Paediatrics)" : "Section A (Adult)"} dosing tables directly.`,
      warning: "Do not use an adult regimen for a paediatric patient — dosing is weight-based.",
    };
  }

  if (!pathway) {
    return {
      pathway: null,
      regimens: [],
      rationale: "The checklist findings do not match any NAG 2024 pathway in this system.",
      warning: null,
    };
  }

  const hasAllergy = isStatedAllergy(input.allergy_status);
  const patientGroup = patientGroupFromAge(input.patient_age);
  const regimens = computeRegimenOptions(pathway, patientGroup, input.patient_weight_kg ?? null);

  return {
    pathway,
    regimens,
    rationale: `NAG ${pathway.indication} (${pathway.source}).`,
    warning: hasAllergy
      ? `Allergy noted (${input.allergy_status}) — options marked "contains penicillin" may not be safe, review before prescribing.`
      : pathway.cautions[0] ?? null,
  };
}
