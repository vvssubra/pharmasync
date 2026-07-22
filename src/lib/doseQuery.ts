// Derives a semantic query + patient group for the local knowledge-service
// dose lookup from the antibiotic form's clinical-pathway checklist.
// Thresholds mirror the clinical rules already encoded in the form itself
// (see src/pages/AntibioticForm.tsx) so the dose suggestion only fires once
// the pathway is actually indicated, not on every keystroke.

export interface ChecklistState {
  pneumonia: { acute_cough: boolean; tachycardia: boolean; tachypnoea: boolean; fever: boolean; hypoxemia: boolean; consolidation: boolean };
  aom: { otalgia: boolean; urti: boolean; fever: boolean; poor_appetite: boolean; crying: boolean; vomiting: boolean; otoscopy_sign: string };
  pharyngitis: { temp: number; no_cough: number; adenopathy: number; exudate: number; age_score: number };
  rhinosinusitis: { nasal_obstruction: boolean; smell_loss: boolean; fever: boolean; discoloured_mucus: boolean; double_sickening: boolean; severe_pain: boolean; raised_esr: boolean };
  ssti: { erythema: boolean; abscess_incision: boolean; inadequate_drainage: boolean; extensive_cellulitis: boolean; valvular_heart: boolean; diabetes: boolean; impetigo_localised: boolean; impetigo_generalised: boolean; cellulitis: boolean };
  uti: { nit_positive: boolean; leu_positive: boolean; frequency: boolean; dysuria: boolean; hematuria: boolean; suprapubic: boolean; urgency: boolean; polyuria: boolean; pregnancy_culture: string };
}

export type PatientGroup = "Adult" | "Paediatric" | "Any";

export interface DoseQuery {
  query: string;
  patient_group: PatientGroup;
}

function derivePatientGroup(age: number | null): PatientGroup {
  if (age === null) return "Any";
  return age < 12 ? "Paediatric" : "Adult";
}

function countTrue(...values: boolean[]): number {
  return values.filter(Boolean).length;
}

function derivePathwayIndication(checklist: ChecklistState): string | null {
  const centorTotal =
    checklist.pharyngitis.temp +
    checklist.pharyngitis.no_cough +
    checklist.pharyngitis.adenopathy +
    checklist.pharyngitis.exudate +
    checklist.pharyngitis.age_score;
  if (centorTotal >= 3) return "Pharyngitis";

  const { pneumonia } = checklist;
  if (
    pneumonia.acute_cough &&
    (pneumonia.tachycardia || pneumonia.tachypnoea || pneumonia.fever || pneumonia.hypoxemia || pneumonia.consolidation)
  ) {
    return "Community Acquired Pneumonia";
  }

  const { aom } = checklist;
  if (
    aom.otoscopy_sign === "yes" &&
    (aom.otalgia || aom.urti || aom.fever || aom.poor_appetite || aom.crying || aom.vomiting)
  ) {
    return "Acute Otitis Media";
  }

  const { rhinosinusitis } = checklist;
  const abrsSymptomCount = countTrue(
    rhinosinusitis.fever,
    rhinosinusitis.discoloured_mucus,
    rhinosinusitis.double_sickening,
    rhinosinusitis.severe_pain,
    rhinosinusitis.raised_esr
  );
  if (rhinosinusitis.nasal_obstruction && abrsSymptomCount >= 3) {
    return "Acute Bacterial Rhinosinusitis";
  }

  const { ssti } = checklist;
  if (
    ssti.erythema ||
    ssti.cellulitis ||
    ssti.impetigo_localised ||
    ssti.impetigo_generalised ||
    ssti.abscess_incision
  ) {
    return "Skin and Soft Tissue Infection";
  }

  const { uti } = checklist;
  const utiSymptomCount = countTrue(
    uti.frequency,
    uti.dysuria,
    uti.hematuria,
    uti.suprapubic,
    uti.urgency,
    uti.polyuria
  );
  if (uti.nit_positive || (uti.leu_positive && utiSymptomCount >= 3)) {
    return "Urinary Tract Infection";
  }

  return null;
}

export function deriveDoseQuery(
  checklist: ChecklistState,
  diagnosis: string,
  age: number | null
): DoseQuery | null {
  const patient_group = derivePatientGroup(age);

  const pathwayIndication = derivePathwayIndication(checklist);
  if (pathwayIndication) {
    return { query: pathwayIndication, patient_group };
  }

  const trimmedDiagnosis = diagnosis.trim();
  if (trimmedDiagnosis) {
    return { query: trimmedDiagnosis, patient_group };
  }

  return null;
}
