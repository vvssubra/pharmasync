import { describe, it, expect } from "vitest";
import { resolveCase } from "../../supabase/functions/antibiotic-suggest/resolve";

const emptyChecklist = {
  pneumonia: { acute_cough: false, tachycardia: false, tachypnoea: false, fever: false, hypoxemia: false, consolidation: false },
  aom: { otalgia: false, urti: false, fever: false, poor_appetite: false, crying: false, vomiting: false, otoscopy_sign: "" },
  pharyngitis: { temp: 0, no_cough: 0, adenopathy: 0, exudate: 0, age_score: 0 },
  rhinosinusitis: { nasal_obstruction: false, smell_loss: false, fever: false, discoloured_mucus: false, double_sickening: false, severe_pain: false, raised_esr: false },
  ssti: { erythema: false, abscess_incision: false, inadequate_drainage: false, extensive_cellulitis: false, valvular_heart: false, diabetes: false, impetigo_localised: false, impetigo_generalised: false, cellulitis: false },
  uti: { nit_positive: false, leu_positive: false, frequency: false, dysuria: false, hematuria: false, suprapubic: false, urgency: false, polyuria: false, pregnancy_culture: "" },
};

const capChecklist = { ...emptyChecklist, pneumonia: { ...emptyChecklist.pneumonia, acute_cough: true, fever: true } };
const aomChecklist = { ...emptyChecklist, aom: { ...emptyChecklist.aom, otoscopy_sign: "yes", otalgia: true } };
const utiChecklist = { ...emptyChecklist, uti: { ...emptyChecklist.uti, nit_positive: true } };

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
      diagnosis: "irrelevant shorthand",
      checklist: utiChecklist,
      patient_age: 6,
      patient_weight_kg: 20,
    });
    expect(r.pathway).toBeNull();
    expect(r.regimens).toEqual([]);
    expect(r.rationale).toContain("Section B (Paediatrics)");
  });

  it("lists every documented adult CAP option unchanged", () => {
    const r = resolveCase({ diagnosis: "irrelevant shorthand", checklist: capChecklist, patient_age: 40 });
    expect(r.pathway?.id).toBe("cap");
    // Erythromycin is children's-table-only in this pathway, so an adult sees
    // just the two documented adult options.
    expect(r.regimens).toEqual([
      expect.objectContaining({ drug: "Amoxicillin", tier: "Preferred", computed: false }),
      expect.objectContaining({ drug: "Doxycycline", tier: "Alternative", computed: false }),
    ]);
  });

  it("computes weight-based dosing for a paediatric pathway, alongside every other documented option", () => {
    const r = resolveCase({ diagnosis: "irrelevant shorthand", checklist: aomChecklist, patient_age: 6, patient_weight_kg: 20 });
    expect(r.pathway?.id).toBe("aom");
    // 20kg x 80-90 mg/kg/day = 1600-1800 mg/day
    const amox = r.regimens.find((o) => o.drug === "Amoxicillin");
    expect(amox?.text).toContain("1600-1800mg/day");
    // 20kg x 40-50 mg/kg/day = 800-1000 mg/day
    const erythro = r.regimens.find((o) => o.drug === "Erythromycin Ethylsuccinate");
    expect(erythro?.text).toContain("800-1000mg/day");
    // No children's table for Amoxicillin-Clavulanate in this pathway — adult reference text only
    const augmentin = r.regimens.find((o) => o.drug === "Amoxicillin-Clavulanate");
    expect(augmentin?.computed).toBe(false);
  });

  it("flags penicillin-class options when an allergy is stated, without hiding any of them", () => {
    const r = resolveCase({
      diagnosis: "irrelevant shorthand",
      checklist: capChecklist,
      patient_age: 40,
      allergy_status: "Penicillin - rash",
    });
    // Same two options as the no-allergy case — allergy only flags, never filters.
    expect(r.regimens.map((o) => o.drug)).toEqual(["Amoxicillin", "Doxycycline"]);
    expect(r.regimens.find((o) => o.drug === "Amoxicillin")?.penicillinClass).toBe(true);
    expect(r.warning).toMatch(/Allergy noted.*penicillin/i);
  });

  it("stays permissive when age is unknown, so an adult without an IC still gets a suggestion", () => {
    const r = resolveCase({ diagnosis: "irrelevant shorthand", checklist: capChecklist });
    expect(r.pathway?.id).toBe("cap");
  });

  it("never matches on diagnosis text alone — checklist is the only signal", () => {
    // A shorthand diagnosis that happens to contain a pathway alias (e.g.
    // "uti", "aom") must not drive the match on its own.
    const r = resolveCase({ diagnosis: "urinary tract infection" });
    expect(r.pathway).toBeNull();
    expect(r.regimens).toEqual([]);
  });
});
