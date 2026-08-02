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

// Centor/Strep total >= 3 — matches Pharyngitis, which carries no plain
// `weightBased` rule (only `allergyWeightBased`), and is patientGroup "Any"
// so it stays reachable for a paediatric patient.
const pharyngitisChecklist: ChecklistState = {
  ...emptyChecklist,
  pharyngitis: { ...emptyChecklist.pharyngitis, temp: 1, no_cough: 1, adenopathy: 1, exudate: 0, age_score: 0 },
};

describe("computeAbxDose", () => {
  it("computes AOM amoxicillin at 14kg", () => {
    const rule: AbxWeightRule = { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "divided BD", durationDaysRange: [5, 7] };
    const result = computeAbxDose(rule, 14);
    expect(result).toEqual({
      drug: "Amoxicillin",
      text: "Amoxicillin 1120-1260 mg/day PO divided BD x 5-7 days",
      basis: "80-90 mg/kg/day x 14 kg",
      capped: false,
    });
  });

  it("caps pharyngitis allergy azithromycin at the label maximum for a 60kg patient", () => {
    const rule: AbxWeightRule = { kind: "mgPerKgPerDose", drug: "Azithromycin", mgPerKgPerDose: 12, maxMgPerDose: 500, frequency: "OD", durationDaysRange: [5, 5] };
    const result = computeAbxDose(rule, 60);
    expect(result).toEqual({
      drug: "Azithromycin",
      text: "Azithromycin 500mg PO OD x 5 days",
      basis: "12 mg/kg/dose x 60 kg",
      capped: true,
    });
  });

  it("computes the AOM allergy load/taper azithromycin at 20kg", () => {
    const rule: AbxWeightRule = { kind: "loadTaper", drug: "Azithromycin", loadMgPerKg: 10, loadDays: 1, maintMgPerKg: 5, maintDays: 4, frequency: "OD" };
    const result = computeAbxDose(rule, 20);
    expect(result?.text).toBe("Azithromycin 200mg OD day 1, then 100mg OD days 2-5");
    expect(result?.capped).toBe(false);
  });

  it.each([0, -5, NaN, Infinity])("returns null for an invalid weight (%s)", (weight) => {
    const rule: AbxWeightRule = { kind: "mgPerKgPerDay", drug: "Amoxicillin", mgPerKgPerDayRange: [80, 90], frequency: "divided BD", durationDaysRange: [5, 7] };
    expect(computeAbxDose(rule, weight)).toBeNull();
  });
});

describe("resolveLocalDose", () => {
  it("reports noWeight when no weight is given", () => {
    const result = resolveLocalDose({ checklist: aomChecklist, diagnosis: "", age: 6, weightKg: null, hasAllergy: false });
    expect(result).toEqual({ unavailable: "noWeight" });
  });

  it("resolves the AOM dose card once weight and checklist agree", () => {
    const result = resolveLocalDose({ checklist: aomChecklist, diagnosis: "", age: 6, weightKg: 14, hasAllergy: false });
    expect(result).toMatchObject({
      source: "NAG 2024 — Acute Otitis Media",
      warning: null,
      result: { text: "Amoxicillin 1120-1260 mg/day PO divided BD x 5-7 days" },
    });
  });

  it("switches to the allergy weight-based regimen when an allergy is stated", () => {
    const result = resolveLocalDose({ checklist: aomChecklist, diagnosis: "", age: 6, weightKg: 20, hasAllergy: true });
    expect(result).toMatchObject({
      result: { drug: "Azithromycin", text: "Azithromycin 200mg OD day 1, then 100mg OD days 2-5" },
    });
    expect((result as { warning: string }).warning).toMatch(/Allergy noted/);
  });

  it("reports noPathway when nothing matches the checklist or diagnosis", () => {
    const result = resolveLocalDose({ checklist: emptyChecklist, diagnosis: "", age: 6, weightKg: 14, hasAllergy: false });
    expect(result).toEqual({ unavailable: "noPathway" });
  });

  it("reports noRule for a matched pathway with no local weight-based dosing (pharyngitis, no allergy)", () => {
    const result = resolveLocalDose({ checklist: pharyngitisChecklist, diagnosis: "", age: 6, weightKg: 20, hasAllergy: false });
    expect(result).toEqual({ unavailable: "noRule" });
  });
});
