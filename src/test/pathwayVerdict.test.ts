import { describe, it, expect } from "vitest";
import { checkPathway } from "../../supabase/functions/pathway-check/verdict";
import { identifyDrug } from "@/lib/nagPathways";

const base = {
  pneumonia: { acute_cough: false, tachycardia: false, tachypnoea: false, fever: false, hypoxemia: false, consolidation: false },
  aom: { otalgia: false, urti: false, fever: false, poor_appetite: false, crying: false, vomiting: false, otoscopy_sign: "" },
  pharyngitis: { temp: 0, no_cough: 0, adenopathy: 0, exudate: 0, age_score: 0 },
  rhinosinusitis: { nasal_obstruction: false, smell_loss: false, fever: false, discoloured_mucus: false, double_sickening: false, severe_pain: false, raised_esr: false },
  ssti: { erythema: false, abscess_incision: false, inadequate_drainage: false, extensive_cellulitis: false, valvular_heart: false, diabetes: false, impetigo_localised: false, impetigo_generalised: false, cellulitis: false },
  uti: { nit_positive: false, leu_positive: false, frequency: false, dysuria: false, hematuria: false, suprapubic: false, urgency: false, polyuria: false, pregnancy_culture: "" },
};
const uti = { ...base, uti: { ...base.uti, nit_positive: true, leu_positive: true, frequency: true, dysuria: true, urgency: true } };

describe("identifyDrug spellings", () => {
  it("reads compound and BAN spellings as the right drug", () => {
    expect(identifyDrug("Amoxicillin/Clavulanate 625mg TDS")).toBe("Amoxicillin-Clavulanate");
    expect(identifyDrug("amoxicillin + clavulanate")).toBe("Amoxicillin-Clavulanate");
    expect(identifyDrug("Augmentin 625mg")).toBe("Amoxicillin-Clavulanate");
    expect(identifyDrug("Cefalexin 500mg BD")).toBe("Cephalexin");
    expect(identifyDrug("Erythromycin 400mg QID")).toBe("Erythromycin Ethylsuccinate");
    expect(identifyDrug("Amoxicillin 500mg TDS")).toBe("Amoxicillin");
  });
});

describe("checkPathway duration", () => {
  it("checks the drug's own duration, not the pathway's widest range", () => {
    const r = checkPathway({ checklist: uti, patient_age: 40, antibiotic: "Nitrofurantoin 100mg BD", duration_days: 3 });
    expect(r.verdict).toBe("review");
    expect(checkPathway({ checklist: uti, patient_age: 40, antibiotic: "Nitrofurantoin 100mg BD", duration_days: 5 }).verdict).toBe("supported");
  });

  it("accepts Amoxicillin/Clavulanate as a UTI option", () => {
    expect(checkPathway({ checklist: uti, patient_age: 40, antibiotic: "Amoxicillin/Clavulanate 625mg TDS", duration_days: 3 }).verdict).not.toBe("not_supported");
  });
});
