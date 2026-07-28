import { describe, it, expect } from "vitest";
import { resolveCase } from "../../supabase/functions/antibiotic-suggest/resolve";

describe("resolveCase patient-group safety", () => {
  it("refuses rather than handing a child the adult regimen", () => {
    // The live failure: a 6-year-old, 20kg, with community-acquired pneumonia
    // received "Amoxicillin 500mg-1g PO TDS x 5-7 days (mild, outpatient)" —
    // the adult CAP first-line, roughly 150 mg/kg/day at 1g TDS — presented as
    // "NAG 2024 pathway match". Only AOM carries weightBased dosing, so every
    // other paediatric case fell through to the adult first-line.
    const r = resolveCase({
      diagnosis: "community acquired pneumonia",
      patient_age: 6,
      patient_weight_kg: 20,
    });
    expect(r.pathway).toBeNull();
    expect(r.regimenText).toContain("Refer to specialist");
    expect(r.regimenText).not.toMatch(/Amoxicillin/i);
    expect(r.rationale).toContain("Section B (Paediatrics)");
    expect(r.needsLlmPhrasing).toBe(false);
  });

  it("gives an adult the adult first-line unchanged", () => {
    const r = resolveCase({ diagnosis: "community acquired pneumonia", patient_age: 40 });
    expect(r.pathway?.id).toBe("cap");
    expect(r.regimenText).toMatch(/Amoxicillin/i);
    expect(r.needsLlmPhrasing).toBe(false);
  });

  it("computes weight-based dosing for the one paediatric pathway that has it", () => {
    const r = resolveCase({ diagnosis: "acute otitis media", patient_age: 6, patient_weight_kg: 20 });
    expect(r.pathway?.id).toBe("aom");
    // 20kg x 80-90 mg/kg/day = 1600-1800 mg/day
    expect(r.regimenText).toContain("1600");
    expect(r.regimenText).toContain("1800");
  });

  it("still returns the allergy alternative for an adult", () => {
    const r = resolveCase({
      diagnosis: "community acquired pneumonia",
      patient_age: 40,
      allergy_status: "Penicillin - rash",
    });
    expect(r.regimenText).toMatch(/Doxycycline/i);
    expect(r.needsLlmPhrasing).toBe(true);
  });

  it("stays permissive when age is unknown, so an adult without an IC still gets a suggestion", () => {
    const r = resolveCase({ diagnosis: "community acquired pneumonia" });
    expect(r.pathway?.id).toBe("cap");
  });
});
