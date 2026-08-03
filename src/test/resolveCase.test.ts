import { describe, it, expect } from "vitest";
import { resolveCase } from "../../supabase/functions/antibiotic-suggest/resolve";

describe("resolveCase patient-group safety", () => {
  it("refuses rather than handing a child the adult regimen", () => {
    // The live failure (original repro): a 6-year-old with community-acquired
    // pneumonia received the adult CAP first-line, presented as a confident
    // "NAG 2024 pathway match". CAP now carries real paediatric dosing (NAG
    // 2024 gives a children's table), so it's no longer a valid adult-only
    // repro; UTI has no paediatric table in the source and stays adult-only,
    // preserving the same guarantee — a pathway written for one patient group
    // must never be substituted for the other.
    const r = resolveCase({
      diagnosis: "urinary tract infection",
      patient_age: 6,
      patient_weight_kg: 20,
    });
    expect(r.pathway).toBeNull();
    expect(r.regimenText).toContain("Refer to specialist");
    expect(r.regimenText).not.toMatch(/Nitrofurantoin/i);
    expect(r.rationale).toContain("Section B (Paediatrics)");
    expect(r.alternative).toBeUndefined();
  });

  it("gives an adult the adult first-line unchanged, alongside the allergy alternative", () => {
    const r = resolveCase({ diagnosis: "community acquired pneumonia", patient_age: 40 });
    expect(r.pathway?.id).toBe("cap");
    expect(r.regimenText).toMatch(/Amoxicillin/i);
    expect(r.alternative).toMatchObject({ regimenText: expect.stringMatching(/Doxycycline/i) });
  });

  it("computes weight-based dosing for a paediatric pathway, alongside the allergy alternative", () => {
    const r = resolveCase({ diagnosis: "acute otitis media", patient_age: 6, patient_weight_kg: 20 });
    expect(r.pathway?.id).toBe("aom");
    // 20kg x 80-90 mg/kg/day = 1600-1800 mg/day
    expect(r.regimenText).toContain("1600");
    expect(r.regimenText).toContain("1800");
    // 20kg x 40-50 mg/kg/day = 800-1000 mg/day
    expect(r.alternative?.regimenText).toMatch(/Erythromycin Ethylsuccinate 800-1000mg\/day/);
  });

  it("still returns the allergy alternative for an adult, alongside the preferred option", () => {
    const r = resolveCase({
      diagnosis: "community acquired pneumonia",
      patient_age: 40,
      allergy_status: "Penicillin - rash",
    });
    expect(r.regimenText).toMatch(/Doxycycline/i);
    expect(r.alternative).toMatchObject({ label: "Preferred (no allergy)", regimenText: expect.stringMatching(/Amoxicillin/i) });
  });

  it("stays permissive when age is unknown, so an adult without an IC still gets a suggestion", () => {
    const r = resolveCase({ diagnosis: "community acquired pneumonia" });
    expect(r.pathway?.id).toBe("cap");
  });
});
