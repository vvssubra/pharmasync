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
    expect(r.explanation).toContain("Erythromycin");
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

describe("paediatric patient-group safety", () => {
  it("does not apply an adult-only pathway to a child", () => {
    // Live bug (original repro): a 6-year-old with pneumonia was told
    // "Amoxicillin 500mg-1g PO TDS" — the ADULT CAP regimen, ~150 mg/kg/day
    // for a 20kg child — labelled as a confident NAG match, because
    // matchPathway ended in `?? pool[0]`. CAP now carries real paediatric
    // dosing (NAG 2024 gives a children's table), so it's no longer a valid
    // adult-only repro; UTI has no paediatric table in the source and stays
    // adult-only, preserving the same guarantee.
    const r = checkPathway({ diagnosis: "urinary tract infection", antibiotic: "Nitrofurantoin 100mg BD", patient_age: 6 });
    expect(r.verdict).toBe("refer_specialist");
    expect(r.explanation).toContain("different patient group");
  });

  it("still applies an adult pathway to an adult", () => {
    const r = checkPathway({ diagnosis: "community acquired pneumonia", antibiotic: "Amoxicillin 500mg TDS", patient_age: 40, duration_days: 5 });
    expect(r.verdict).toBe("supported");
  });

  it("still applies a paediatric pathway to a child", () => {
    const r = checkPathway({ diagnosis: "acute otitis media", antibiotic: "Amoxicillin 80mg/kg/day", patient_age: 6, duration_days: 5 });
    expect(r.verdict).toBe("supported");
  });

  it("stays permissive when no age is given, so adults without an IC still get a check", () => {
    const r = checkPathway({ diagnosis: "community acquired pneumonia", antibiotic: "Amoxicillin 500mg TDS", duration_days: 5 });
    expect(r.verdict).toBe("supported");
  });
});
