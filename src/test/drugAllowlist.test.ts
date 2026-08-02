import { describe, it, expect } from "vitest";
import { violatesDrugAllowlist } from "../../supabase/functions/antibiotic-suggest/resolve";

const ALLOWED = ["Penicillin V", "Erythromycin Ethylsuccinate"];

describe("violatesDrugAllowlist", () => {
  it("does not violate when the suggestion names an allowed drug", () => {
    expect(violatesDrugAllowlist("Penicillin V 500mg PO BD x 10 days", ALLOWED)).toBe(false);
  });

  it("does not violate for the alternative drug, case-insensitively", () => {
    expect(violatesDrugAllowlist("erythromycin ethylsuccinate 800mg od x 5 days", ALLOWED)).toBe(false);
  });

  it("violates when the suggestion names an off-list drug", () => {
    expect(violatesDrugAllowlist("Ciprofloxacin 500mg BD x 7 days", ALLOWED)).toBe(true);
  });

  it("violates on an empty or drug-free suggestion", () => {
    expect(violatesDrugAllowlist("Refer to specialist", ALLOWED)).toBe(true);
    expect(violatesDrugAllowlist("", ALLOWED)).toBe(true);
  });

  it("violates when the suggestion names a compound drug whose shorter constituent is allowed elsewhere", () => {
    // "Amoxicillin-Clavulanate" contains "Amoxicillin" as a substring, but it
    // is NAG's ABRS first-line, not a CAP/AOM drug — a plain substring check
    // would wrongly pass this as a match against a CAP-style allowlist.
    const cap = ["Amoxicillin", "Doxycycline"];
    expect(violatesDrugAllowlist("Amoxicillin-Clavulanate 625mg PO TDS x 7 days", cap)).toBe(true);
  });

  it("does not violate when the compound drug is itself on the allowlist", () => {
    const abrs = ["Amoxicillin-Clavulanate", "Doxycycline"];
    expect(violatesDrugAllowlist("Amoxicillin-Clavulanate 625mg PO TDS x 7 days", abrs)).toBe(false);
  });
});
