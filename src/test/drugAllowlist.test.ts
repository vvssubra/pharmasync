import { describe, it, expect } from "vitest";
import { violatesDrugAllowlist } from "../../supabase/functions/antibiotic-suggest/resolve";

const ALLOWED = ["Penicillin V", "Azithromycin"];

describe("violatesDrugAllowlist", () => {
  it("does not violate when the suggestion names an allowed drug", () => {
    expect(violatesDrugAllowlist("Penicillin V 500mg PO BD x 10 days", ALLOWED)).toBe(false);
  });

  it("does not violate for the alternative drug, case-insensitively", () => {
    expect(violatesDrugAllowlist("azithromycin 500mg od x 5 days", ALLOWED)).toBe(false);
  });

  it("violates when the suggestion names an off-list drug", () => {
    expect(violatesDrugAllowlist("Ciprofloxacin 500mg BD x 7 days", ALLOWED)).toBe(true);
  });

  it("violates on an empty or drug-free suggestion", () => {
    expect(violatesDrugAllowlist("Refer to specialist", ALLOWED)).toBe(true);
    expect(violatesDrugAllowlist("", ALLOWED)).toBe(true);
  });
});
