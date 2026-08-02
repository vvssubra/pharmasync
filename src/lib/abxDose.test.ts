import { describe, it, expect } from "vitest";
import { computeAbxDose, resolveLocalDose, type AbxWeightRule } from "./abxDose";
import type { ChecklistState } from "./doseQuery";

const emptyChecklist: ChecklistState = {
  pneumonia: { acute_cough: false, tachycardia: false, tachypnoea: false, fever: false, hypoxemia: false, consolidation: false },
  aom: { otalgia: false, urti: false, fever: false, poor_appetite: false, crying: false, vomiting: false, otoscopy_sign: "" },
  pharyngitis: { temp: 0, no_cough: 0, adenopathy: 0, exudate: 0, age_score: 0 },
  rhinosinusitis: { nasal_obstruction: false, smell_loss: false, fever: false, discoloured_mucus: false, double_sickening: false, severe_pain: false, raised_esr: false },
  ssti: { erythema: false, abscess_incision: false, inadequate_drainage: false, extensive_cellulitis: false, valvular_heart: false, diabetes: false, impetigo_localised: false, impetigo_generalised: false, cellulitis: false },
  uti: { nit_positive: false, leu_positive: false, frequency: false, dysuria: false, hematuria: false, suprapubic: false, urgency: false, polyuria: false, pregnancy_culture: "" },
};

const aomChecklist: ChecklistState = {
  ...emptyChecklist,
  aom: { ...emptyChecklist.aom, otoscopy_sign: "yes", otalgia: true },
};

// Matches nit_positive in the UTI section — the one pathway with no
// paediatric weightBased/allergyWeightBased rule in the source (NAG 2024
// gives no children's UTI table), so it's the reliable "noRule" repro.
const utiChecklist: ChecklistState = {
  ...emptyChecklist,
  uti: { ...emptyChecklist.uti, nit_positive: true },
};

describe("computeAbxDose", () => {
  it("computes AOM amoxicillin at 14kg", () => {
    const rule: AbxWeightRule = { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "BD", durationDaysRange: [5, 10], maxMgPerDay: 3000 };
    const result = computeAbxDose(rule, 14);
    expect(result).toEqual({
      drug: "Amoxicillin",
      text: "Amoxicillin 1120-1260mg/day BD x 5-10 days",
      basis: "80-90 mg/kg/day x 14 kg",
      capped: false,
    });
  });

  it("caps a mgPerKgPerDay rule at its maxMgPerDay", () => {
    const rule: AbxWeightRule = { kind: "mgPerKgPerDay", drug: "Cephalexin", mgPerKgPerDayRange: [25, 50], frequency: "BD", durationDaysRange: [5, 7], maxMgPerDay: 2000 };
    const result = computeAbxDose(rule, 60);
    // 25-50mg/kg/day x 60kg = 1500-3000mg/day, capped to 2000mg/day
    expect(result).toEqual({
      drug: "Cephalexin",
      text: "Cephalexin 1500-2000mg/day BD x 5-7 days",
      basis: "25-50 mg/kg/day x 60 kg",
      capped: true,
    });
  });

  it("caps a mgPerKgPerDose rule at its maxMgPerDose", () => {
    const rule: AbxWeightRule = { kind: "mgPerKgPerDose", drug: "Azithromycin", mgPerKgPerDose: 12, maxMgPerDose: 500, frequency: "OD", durationDaysRange: [5, 5] };
    const result = computeAbxDose(rule, 60);
    expect(result).toEqual({
      drug: "Azithromycin",
      text: "Azithromycin 500mg OD x 5 days",
      basis: "12 mg/kg/dose x 60 kg",
      capped: true,
    });
  });

  it("computes a load/taper regimen", () => {
    const rule: AbxWeightRule = { kind: "loadTaper", drug: "Azithromycin", loadMgPerKg: 10, loadDays: 1, maintMgPerKg: 5, maintDays: 4, frequency: "OD" };
    const result = computeAbxDose(rule, 20);
    expect(result?.text).toBe("Azithromycin 200mg OD day 1, then 100mg OD days 2-5");
    expect(result?.capped).toBe(false);
  });

  it.each([0, -5, NaN, Infinity])("returns null for an invalid weight (%s)", (weight) => {
    const rule: AbxWeightRule = { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "BD", durationDaysRange: [5, 10] };
    expect(computeAbxDose(rule, weight)).toBeNull();
  });
});

describe("resolveLocalDose", () => {
  it("reports noWeight when no weight is given", () => {
    const result = resolveLocalDose({ checklist: aomChecklist, diagnosis: "", age: 6, weightKg: null, hasAllergy: false });
    expect(result).toEqual({ unavailable: "noWeight" });
  });

  it("resolves the AOM dose card once weight and checklist agree, alongside the allergy alternative", () => {
    const result = resolveLocalDose({ checklist: aomChecklist, diagnosis: "", age: 6, weightKg: 14, hasAllergy: false });
    expect(result).toMatchObject({
      source: "NAG 2024 — Acute Otitis Media (v16 Oct 2025)",
      warning: null,
      result: { text: "Amoxicillin 1120-1260mg/day BD x 5-10 days" },
      // 40-50mg/kg/day x 14kg = 560-700mg/day
      alternative: { label: "Penicillin allergy", result: { text: "Erythromycin Ethylsuccinate 560-700mg/day BD x 5-10 days" } },
    });
  });

  it("switches to the allergy weight-based regimen when an allergy is stated, keeping the preferred option as the alternative", () => {
    const result = resolveLocalDose({ checklist: aomChecklist, diagnosis: "", age: 6, weightKg: 20, hasAllergy: true });
    expect(result).toMatchObject({
      // 40-50mg/kg/day x 20kg = 800-1000mg/day, well under the 1600mg/day cap
      result: { drug: "Erythromycin Ethylsuccinate", text: "Erythromycin Ethylsuccinate 800-1000mg/day BD x 5-10 days" },
      alternative: { label: "Preferred (no allergy)", result: { drug: "Amoxicillin" } },
    });
    expect((result as { warning: string }).warning).toMatch(/Allergy noted/);
  });

  it("reports noPathway when nothing matches the checklist or diagnosis", () => {
    const result = resolveLocalDose({ checklist: emptyChecklist, diagnosis: "", age: 6, weightKg: 14, hasAllergy: false });
    expect(result).toEqual({ unavailable: "noPathway" });
  });

  it("omits the alternative when the pathway has no allergyWeightBased rule (SSTI)", () => {
    const ssti: ChecklistState = { ...emptyChecklist, ssti: { ...emptyChecklist.ssti, cellulitis: true } };
    const result = resolveLocalDose({ checklist: ssti, diagnosis: "", age: 6, weightKg: 20, hasAllergy: false });
    expect(result).toMatchObject({ result: { drug: "Cephalexin" } });
    expect((result as { alternative?: unknown }).alternative).toBeUndefined();
  });

  it("reports noRule for a matched pathway with no local weight-based dosing (UTI has no paediatric table)", () => {
    // age omitted (patientGroup "Any") so the Adult-only UTI pathway still
    // matches — matchPathwayDetailed only refuses on a real group conflict.
    const result = resolveLocalDose({ checklist: utiChecklist, diagnosis: "", age: null, weightKg: 20, hasAllergy: false });
    expect(result).toEqual({ unavailable: "noRule" });
  });
});
