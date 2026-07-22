import { describe, it, expect } from "vitest";
import { deriveDoseQuery, type ChecklistState } from "./doseQuery";

const emptyChecklist: ChecklistState = {
  pneumonia: { acute_cough: false, tachycardia: false, tachypnoea: false, fever: false, hypoxemia: false, consolidation: false },
  aom: { otalgia: false, urti: false, fever: false, poor_appetite: false, crying: false, vomiting: false, otoscopy_sign: "" },
  pharyngitis: { temp: 0, no_cough: 0, adenopathy: 0, exudate: 0, age_score: 0 },
  rhinosinusitis: { nasal_obstruction: false, smell_loss: false, fever: false, discoloured_mucus: false, double_sickening: false, severe_pain: false, raised_esr: false },
  ssti: { erythema: false, abscess_incision: false, inadequate_drainage: false, extensive_cellulitis: false, valvular_heart: false, diabetes: false, impetigo_localised: false, impetigo_generalised: false, cellulitis: false },
  uti: { nit_positive: false, leu_positive: false, frequency: false, dysuria: false, hematuria: false, suprapubic: false, urgency: false, polyuria: false, pregnancy_culture: "" },
};

describe("deriveDoseQuery", () => {
  it("returns null when no checklist section has crossed threshold and diagnosis is empty", () => {
    expect(deriveDoseQuery(emptyChecklist, "", null)).toBeNull();
  });

  it("falls back to trimmed diagnosis text when no checklist section fires", () => {
    const result = deriveDoseQuery(emptyChecklist, "  suspected sinusitis  ", null);
    expect(result).toEqual({ query: "suspected sinusitis", patient_group: "Any" });
  });

  it("fires Pharyngitis once Centor/Strep total reaches 3", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      pharyngitis: { temp: 1, no_cough: 1, adenopathy: 1, exudate: 0, age_score: 0 },
    };
    expect(deriveDoseQuery(checklist, "sore throat", null)).toEqual({
      query: "Pharyngitis",
      patient_group: "Any",
    });
  });

  it("does not fire Pharyngitis below Centor total of 3", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      pharyngitis: { temp: 1, no_cough: 1, adenopathy: 0, exudate: 0, age_score: 0 },
    };
    expect(deriveDoseQuery(checklist, "", null)).toBeNull();
  });

  it("fires Acute Otitis Media when otoscopy sign is yes and a symptom is present", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      aom: { ...emptyChecklist.aom, otoscopy_sign: "yes", otalgia: true },
    };
    expect(deriveDoseQuery(checklist, "", 4)).toEqual({
      query: "Acute Otitis Media",
      patient_group: "Paediatric",
    });
  });

  it("does not fire AOM when otoscopy sign is yes but no symptoms present", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      aom: { ...emptyChecklist.aom, otoscopy_sign: "yes" },
    };
    expect(deriveDoseQuery(checklist, "", 4)).toBeNull();
  });

  it("fires Community Acquired Pneumonia when acute cough plus a vital-sign abnormality present", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      pneumonia: { ...emptyChecklist.pneumonia, acute_cough: true, tachypnoea: true },
    };
    expect(deriveDoseQuery(checklist, "", 40)).toEqual({
      query: "Community Acquired Pneumonia",
      patient_group: "Adult",
    });
  });

  it("fires Acute Bacterial Rhinosinusitis when nasal obstruction plus 3+ ABRS symptoms", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      rhinosinusitis: {
        ...emptyChecklist.rhinosinusitis,
        nasal_obstruction: true,
        fever: true,
        discoloured_mucus: true,
        severe_pain: true,
      },
    };
    expect(deriveDoseQuery(checklist, "", 30)).toEqual({
      query: "Acute Bacterial Rhinosinusitis",
      patient_group: "Adult",
    });
  });

  it("does not fire rhinosinusitis with fewer than 3 ABRS symptoms", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      rhinosinusitis: { ...emptyChecklist.rhinosinusitis, nasal_obstruction: true, fever: true },
    };
    expect(deriveDoseQuery(checklist, "", 30)).toBeNull();
  });

  it("fires Skin and Soft Tissue Infection when cellulitis is ticked", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      ssti: { ...emptyChecklist.ssti, cellulitis: true },
    };
    expect(deriveDoseQuery(checklist, "", 30)).toEqual({
      query: "Skin and Soft Tissue Infection",
      patient_group: "Adult",
    });
  });

  it("fires Urinary Tract Infection when nitrite is positive", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      uti: { ...emptyChecklist.uti, nit_positive: true },
    };
    expect(deriveDoseQuery(checklist, "", 30)).toEqual({
      query: "Urinary Tract Infection",
      patient_group: "Adult",
    });
  });

  it("fires UTI when leucocytes positive and 3+ symptoms present", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      uti: { ...emptyChecklist.uti, leu_positive: true, frequency: true, dysuria: true, urgency: true },
    };
    expect(deriveDoseQuery(checklist, "", 30)).toEqual({
      query: "Urinary Tract Infection",
      patient_group: "Adult",
    });
  });

  it("does not fire UTI when leucocytes positive but fewer than 3 symptoms", () => {
    const checklist: ChecklistState = {
      ...emptyChecklist,
      uti: { ...emptyChecklist.uti, leu_positive: true, frequency: true },
    };
    expect(deriveDoseQuery(checklist, "", 30)).toBeNull();
  });
});
