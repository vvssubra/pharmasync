// Derives the knowledge-service dose-lookup query from the antibiotic form's
// live state (checklist sections + free-text diagnosis + patient age).
import type { PatientGroup, SuggestDoseRequest } from "./knowledgeClient";

export interface ChecklistState {
  pneumonia: {
    acute_cough: boolean;
    tachycardia: boolean;
    tachypnoea: boolean;
    fever: boolean;
    hypoxemia: boolean;
    consolidation: boolean;
  };
  aom: {
    otalgia: boolean;
    urti: boolean;
    fever: boolean;
    poor_appetite: boolean;
    crying: boolean;
    vomiting: boolean;
    otoscopy_sign: string;
  };
  pharyngitis: {
    temp: number;
    no_cough: number;
    adenopathy: number;
    exudate: number;
    age_score: number;
  };
  rhinosinusitis: {
    nasal_obstruction: boolean;
    smell_loss: boolean;
    fever: boolean;
    discoloured_mucus: boolean;
    double_sickening: boolean;
    severe_pain: boolean;
    raised_esr: boolean;
  };
  ssti: {
    erythema: boolean;
    abscess_incision: boolean;
    inadequate_drainage: boolean;
    extensive_cellulitis: boolean;
    valvular_heart: boolean;
    diabetes: boolean;
    impetigo_localised: boolean;
    impetigo_generalised: boolean;
    cellulitis: boolean;
  };
  uti: {
    nit_positive: boolean;
    leu_positive: boolean;
    frequency: boolean;
    dysuria: boolean;
    hematuria: boolean;
    suprapubic: boolean;
    urgency: boolean;
    polyuria: boolean;
    pregnancy_culture: string;
  };
}

// Human-readable condition terms per section, used as embedding-query text.
const SECTION_TERMS: Record<keyof ChecklistState, string> = {
  pneumonia: "pneumonia",
  aom: "acute otitis media",
  pharyngitis: "pharyngitis",
  rhinosinusitis: "rhinosinusitis",
  ssti: "skin and soft tissue infection",
  uti: "urinary tract infection",
};

// Centor-based section: only meaningful once the score suggests bacterial
// pharyngitis, so a couple of stray points shouldn't trigger a lookup.
const CENTOR_ACTIVE_THRESHOLD = 3;

function sectionActive(section: keyof ChecklistState, checklist: ChecklistState): boolean {
  if (section === "pharyngitis") {
    const p = checklist.pharyngitis;
    return p.temp + p.no_cough + p.adenopathy + p.exudate + p.age_score >= CENTOR_ACTIVE_THRESHOLD;
  }
  return Object.values(checklist[section]).some((v) =>
    typeof v === "string" ? v.trim() !== "" : Boolean(v),
  );
}

export function patientGroupFromAge(age: number | null): PatientGroup {
  if (age === null) return "Any";
  return age < 12 ? "Paediatric" : "Adult";
}

/**
 * Build the dose-lookup request, or null when the form has nothing to search
 * on yet (blank diagnosis and no active checklist section) — the hook stays
 * idle on null.
 */
export function deriveDoseQuery(
  checklist: ChecklistState,
  diagnosis: string,
  age: number | null,
): SuggestDoseRequest | null {
  const terms: string[] = [];

  const cleanDiagnosis = diagnosis.trim();
  if (cleanDiagnosis) terms.push(cleanDiagnosis);

  for (const section of Object.keys(SECTION_TERMS) as (keyof ChecklistState)[]) {
    if (sectionActive(section, checklist)) terms.push(SECTION_TERMS[section]);
  }

  if (terms.length === 0) return null;

  return {
    query: terms.join(", "),
    patient_group: patientGroupFromAge(age),
  };
}
