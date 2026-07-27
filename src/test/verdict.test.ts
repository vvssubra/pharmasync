import { describe, it, expect } from "vitest";
import { checkPathway } from "../../supabase/functions/pathway-check/verdict";

describe("checkPathway", () => {
  it("no matching pathway -> refer_specialist", () => {
    const r = checkPathway({ diagnosis: "totally unrelated made-up condition" });
    expect(r.verdict).toBe("refer_specialist");
  });

  it("pathway match, no antibiotic entered yet -> review", () => {
    const r = checkPathway({ diagnosis: "pharyngitis" });
    expect(r.verdict).toBe("review");
    expect(r.explanation).toContain("enter the regimen");
  });

  it("drug not in the pathway's allowedDrugs -> not_supported", () => {
    const r = checkPathway({ diagnosis: "pharyngitis", antibiotic: "Ciprofloxacin 500mg BD" });
    expect(r.verdict).toBe("not_supported");
    expect(r.explanation).toContain("Penicillin V");
  });

  it("stated allergy conflicts with the first-line drug -> review, names the alternative", () => {
    const r = checkPathway({ diagnosis: "pharyngitis", antibiotic: "Penicillin V 500mg BD", allergy_status: "Penicillin rash" });
    expect(r.verdict).toBe("review");
    expect(r.explanation).toContain("Azithromycin");
  });

  it("duration outside the NAG range -> review", () => {
    const r = checkPathway({ diagnosis: "pharyngitis", antibiotic: "Penicillin V 500mg BD", duration_days: 30 });
    expect(r.verdict).toBe("review");
    expect(r.explanation).toContain("outside the NAG");
  });

  it("match, correct drug, no allergy, duration in range -> supported", () => {
    const r = checkPathway({ diagnosis: "pharyngitis", antibiotic: "Penicillin V 500mg BD", duration_days: 10 });
    expect(r.verdict).toBe("supported");
  });

  it("derives the indication from the checklist when no diagnosis text is given", () => {
    const checklist = {
      pneumonia: { acute_cough: false, tachycardia: false, tachypnoea: false, fever: false, hypoxemia: false, consolidation: false },
      aom: { otalgia: false, urti: false, fever: false, poor_appetite: false, crying: false, vomiting: false, otoscopy_sign: "no" },
      pharyngitis: { temp: 1, no_cough: 1, adenopathy: 1, exudate: 0, age_score: 0 },
      rhinosinusitis: { nasal_obstruction: false, smell_loss: false, fever: false, discoloured_mucus: false, double_sickening: false, severe_pain: false, raised_esr: false },
      ssti: { erythema: false, abscess_incision: false, inadequate_drainage: false, extensive_cellulitis: false, valvular_heart: false, diabetes: false, impetigo_localised: false, impetigo_generalised: false, cellulitis: false },
      uti: { nit_positive: false, leu_positive: false, frequency: false, dysuria: false, hematuria: false, suprapubic: false, urgency: false, polyuria: false, pregnancy_culture: "" },
    };
    const r = checkPathway({ checklist, antibiotic: "Penicillin V" });
    expect(r.verdict).toBe("supported");
  });

  it("malformed checklist does not throw — falls through to diagnosis matching", () => {
    expect(() => checkPathway({ checklist: { not: "a real checklist" }, diagnosis: "pharyngitis" })).not.toThrow();
  });

  it("a compound drug is not mistaken for its shorter constituent -> not_supported", () => {
    // CAP's allowedDrugs is ["Amoxicillin", "Doxycycline"]; Amoxicillin-Clavulanate
    // is NAG's ABRS first-line, a different pathway entirely, and must not
    // be accepted here just because it contains the substring "Amoxicillin".
    const r = checkPathway({ diagnosis: "pneumonia", antibiotic: "Amoxicillin-Clavulanate 625mg PO TDS x 7 days" });
    expect(r.verdict).toBe("not_supported");
  });

  it("the compound drug is supported on the pathway it actually belongs to", () => {
    const r = checkPathway({ diagnosis: "rhinosinusitis", antibiotic: "Amoxicillin-Clavulanate 625mg PO TDS x 7 days", duration_days: 7 });
    expect(r.verdict).toBe("supported");
  });
});
