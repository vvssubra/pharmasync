import { describe, it, expect } from "vitest";
import { deriveDoseQuery, patientGroupFromAge, type ChecklistState } from "./doseQuery";

function makeChecklist(overrides: Partial<ChecklistState> = {}): ChecklistState {
  return {
    pneumonia: { acute_cough: false, tachycardia: false, tachypnoea: false, fever: false, hypoxemia: false, consolidation: false },
    aom: { otalgia: false, urti: false, fever: false, poor_appetite: false, crying: false, vomiting: false, otoscopy_sign: "" },
    pharyngitis: { temp: 0, no_cough: 0, adenopathy: 0, exudate: 0, age_score: 0 },
    rhinosinusitis: { nasal_obstruction: false, smell_loss: false, fever: false, discoloured_mucus: false, double_sickening: false, severe_pain: false, raised_esr: false },
    ssti: { erythema: false, abscess_incision: false, inadequate_drainage: false, extensive_cellulitis: false, valvular_heart: false, diabetes: false, impetigo_localised: false, impetigo_generalised: false, cellulitis: false },
    uti: { nit_positive: false, leu_positive: false, frequency: false, dysuria: false, hematuria: false, suprapubic: false, urgency: false, polyuria: false, pregnancy_culture: "" },
    ...overrides,
  };
}

describe("deriveDoseQuery", () => {
  it("returns null when diagnosis is blank and no section is active", () => {
    expect(deriveDoseQuery(makeChecklist(), "", null)).toBeNull();
    expect(deriveDoseQuery(makeChecklist(), "   ", null)).toBeNull();
  });

  it("uses the trimmed diagnosis alone when no section is active", () => {
    const result = deriveDoseQuery(makeChecklist(), "  community acquired pneumonia  ", 30);
    expect(result).toEqual({ query: "community acquired pneumonia", patient_group: "Adult" });
  });

  it("adds a section term when any boolean field in it is ticked", () => {
    const checklist = makeChecklist({
      pneumonia: { acute_cough: true, tachycardia: false, tachypnoea: false, fever: false, hypoxemia: false, consolidation: false },
    });
    const result = deriveDoseQuery(checklist, "", 40);
    expect(result?.query).toBe("pneumonia");
  });

  it("treats non-empty string fields as active", () => {
    const checklist = makeChecklist({
      aom: { otalgia: false, urti: false, fever: false, poor_appetite: false, crying: false, vomiting: false, otoscopy_sign: "bulging" },
    });
    expect(deriveDoseQuery(checklist, "", 5)?.query).toBe("acute otitis media");
  });

  it("ignores whitespace-only string fields", () => {
    const checklist = makeChecklist({
      uti: { nit_positive: false, leu_positive: false, frequency: false, dysuria: false, hematuria: false, suprapubic: false, urgency: false, polyuria: false, pregnancy_culture: "   " },
    });
    expect(deriveDoseQuery(checklist, "", null)).toBeNull();
  });

  it("keeps pharyngitis inactive below a Centor total of 3", () => {
    const checklist = makeChecklist({
      pharyngitis: { temp: 1, no_cough: 1, adenopathy: 0, exudate: 0, age_score: 0 },
    });
    expect(deriveDoseQuery(checklist, "", null)).toBeNull();
  });

  it("activates pharyngitis at a Centor total of 3 or more", () => {
    const checklist = makeChecklist({
      pharyngitis: { temp: 1, no_cough: 1, adenopathy: 1, exudate: 0, age_score: 0 },
    });
    expect(deriveDoseQuery(checklist, "", 25)?.query).toBe("pharyngitis");
  });

  it("combines diagnosis and multiple active sections", () => {
    const checklist = makeChecklist({
      ssti: { erythema: true, abscess_incision: false, inadequate_drainage: false, extensive_cellulitis: false, valvular_heart: false, diabetes: false, impetigo_localised: false, impetigo_generalised: false, cellulitis: true },
      uti: { nit_positive: true, leu_positive: false, frequency: false, dysuria: false, hematuria: false, suprapubic: false, urgency: false, polyuria: false, pregnancy_culture: "" },
    });
    const result = deriveDoseQuery(checklist, "cellulitis left leg", 60);
    expect(result?.query).toBe("cellulitis left leg, skin and soft tissue infection, urinary tract infection");
    expect(result?.patient_group).toBe("Adult");
  });
});

describe("patientGroupFromAge", () => {
  it("maps null to Any", () => {
    expect(patientGroupFromAge(null)).toBe("Any");
  });

  it("maps under-12 to Paediatric", () => {
    expect(patientGroupFromAge(0)).toBe("Paediatric");
    expect(patientGroupFromAge(11)).toBe("Paediatric");
  });

  it("maps 12 and over to Adult", () => {
    expect(patientGroupFromAge(12)).toBe("Adult");
    expect(patientGroupFromAge(80)).toBe("Adult");
  });
});
