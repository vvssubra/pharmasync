// supabase/functions/pathway-check/verdict.ts
// Deterministic replacement for the Claude-based pathway verdict. The NAG
// decision logic (derivePathwayIndication) and pathway data (NAG_PATHWAYS)
// are already fully known — no model call adds anything but latency and a
// chance of hallucinating an out-of-range verdict.

import { derivePathwayIndication, type ChecklistState } from "../_shared/doseQuery.ts";
import { matchPathwayDetailed, patientGroupFromAge, isStatedAllergy, identifyDrug, type PathwayMatch } from "../_shared/nagPathways.ts";

export type Verdict = "supported" | "review" | "not_supported" | "refer_specialist";

export interface PathwayCheckInput {
  diagnosis?: string;
  antibiotic?: string;
  indication?: string;
  duration_days?: number;
  allergy_status?: string;
  checklist?: unknown;
  patient_age?: number;
}

export interface PathwayVerdict {
  verdict: Verdict;
  explanation: string;
}

function resolvePathway(input: PathwayCheckInput): PathwayMatch {
  // Checklist-only — there is deliberately no free-text diagnosis/indication
  // fallback (see matchPathwayDetailed). Both `diagnosis` and `indication`
  // on this input are doctor-typed free text (the latter is actually bound
  // to the prescriber's notes field), and a shorthand phrase in either must
  // never silently redirect which pathway this checks against.
  let checklistIndication: string | null = null;
  if (input.checklist && typeof input.checklist === "object") {
    try {
      checklistIndication = derivePathwayIndication(input.checklist as ChecklistState);
    } catch {
      // Malformed/partial checklist from the client — no match, not a 500.
      checklistIndication = null;
    }
  }
  const patientGroup = patientGroupFromAge(input.patient_age);
  return matchPathwayDetailed(checklistIndication, patientGroup);
}

export function checkPathway(input: PathwayCheckInput): PathwayVerdict {
  const { pathway, groupMismatch, mismatchedIndication } = resolvePathway(input);

  // Same guard as antibiotic-suggest: never validate a regimen against a
  // pathway written for a different patient group. Otherwise a paediatric
  // case would be marked "supported" for an adult dose.
  if (groupMismatch) {
    const group = patientGroupFromAge(input.patient_age).toLowerCase();
    return {
      verdict: "refer_specialist",
      explanation: `The NAG ${mismatchedIndication ?? "pathway"} in this system is written for a different patient group and cannot be applied to a ${group} patient — refer to specialist.`,
    };
  }

  if (!pathway) {
    return {
      verdict: "refer_specialist",
      explanation: "No matching NAG 2024 pathway found for this diagnosis — refer to specialist.",
    };
  }

  const antibiotic = (input.antibiotic ?? "").trim();
  if (!antibiotic) {
    return {
      verdict: "review",
      explanation: `Matches the NAG ${pathway.indication} pathway — enter the regimen to complete the check.`,
    };
  }

  // Identify the drug against the full known-drug vocabulary first (not just
  // this pathway's allowedDrugs) so a compound name like
  // "Amoxicillin-Clavulanate" is never misread as its shorter, differently
  // -indicated constituent "Amoxicillin" just because it contains it.
  const identifiedDrug = identifyDrug(antibiotic);
  const matchedDrug = identifiedDrug && pathway.allowedDrugs.some((d) => d.toLowerCase() === identifiedDrug.toLowerCase())
    ? identifiedDrug
    : null;
  if (!matchedDrug) {
    const preferred = pathway.regimens[0];
    return {
      verdict: "not_supported",
      explanation: `Not a NAG ${pathway.indication} regimen — first-line is ${preferred.drug}${preferred.adultText ? ` (${preferred.adultText})` : ""}.`,
    };
  }

  const hasAllergy = isStatedAllergy(input.allergy_status);
  const matchedRegimen = pathway.regimens.find((r) => r.drug.toLowerCase() === matchedDrug.toLowerCase());
  if (hasAllergy && matchedRegimen?.penicillinClass) {
    const alt = pathway.regimens.find((r) => !r.penicillinClass);
    return {
      verdict: "review",
      explanation: `Allergy noted — ${matchedDrug} contains penicillin.${alt ? ` Consider ${alt.drug}${alt.adultText ? ` (${alt.adultText})` : ""} instead.` : ""}`,
    };
  }

  if (input.duration_days != null) {
    const [min, max] = pathway.durationDaysRange;
    if (input.duration_days < min || input.duration_days > max) {
      return {
        verdict: "review",
        explanation: `Duration ${input.duration_days} day(s) is outside the NAG ${pathway.indication} range (${min}-${max} days).`,
      };
    }
  }

  return {
    verdict: "supported",
    explanation: `Matches the NAG ${pathway.indication} pathway (${pathway.source}).`,
  };
}
