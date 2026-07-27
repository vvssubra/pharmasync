// supabase/functions/pathway-check/verdict.ts
// Deterministic replacement for the Claude-based pathway verdict. The NAG
// decision logic (derivePathwayIndication) and pathway data (NAG_PATHWAYS)
// are already fully known — no model call adds anything but latency and a
// chance of hallucinating an out-of-range verdict.

import { derivePathwayIndication, type ChecklistState } from "../_shared/doseQuery.ts";
import { matchPathway, patientGroupFromAge, isStatedAllergy, identifyDrug, type NagPathway } from "../_shared/nagPathways.ts";

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

function resolvePathway(input: PathwayCheckInput): NagPathway | null {
  let checklistIndication: string | null = null;
  if (input.checklist && typeof input.checklist === "object") {
    try {
      checklistIndication = derivePathwayIndication(input.checklist as ChecklistState);
    } catch {
      // Malformed/partial checklist from the client — fall through to
      // diagnosis-text matching rather than 500ing the request.
      checklistIndication = null;
    }
  }
  const indicationText = checklistIndication ?? input.indication ?? null;
  const patientGroup = patientGroupFromAge(input.patient_age);
  return matchPathway(indicationText, input.diagnosis ?? null, patientGroup);
}

export function checkPathway(input: PathwayCheckInput): PathwayVerdict {
  const pathway = resolvePathway(input);

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
    return {
      verdict: "not_supported",
      explanation: `Not a NAG ${pathway.indication} regimen — first-line is ${pathway.firstLine}.`,
    };
  }

  const hasAllergy = isStatedAllergy(input.allergy_status);
  const isFirstLineDrug = pathway.firstLine.toLowerCase().includes(matchedDrug.toLowerCase());
  if (hasAllergy && isFirstLineDrug && pathway.alternatives.length > 0) {
    return {
      verdict: "review",
      explanation: `Allergy noted — consider the NAG alternative: ${pathway.alternatives[0].regimen}.`,
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
