import { describe, it, expect } from "vitest";
import { verifyNumericClaims } from "../../supabase/functions/ai-query/context";

const facts = "drug|limit|used|remaining\nAmoxicillin 500mg|100|84|16\nParacetamol|200|150|50";

describe("verifyNumericClaims", () => {
  it("passes when every number is copied verbatim from FACTS", () => {
    expect(verifyNumericClaims("Amoxicillin 500mg has 84 used out of a limit of 100, 16 remaining.", facts)).toBe(true);
  });

  it("fails when the answer states a number not present in FACTS", () => {
    expect(verifyNumericClaims("Amoxicillin 500mg has 999 used.", facts)).toBe(false);
  });

  it("fails on a plausible-looking but fabricated derived number", () => {
    expect(verifyNumericClaims("On average that's about 42 units used per week.", facts)).toBe(false);
  });

  it("whitelists the current year", () => {
    const year = new Date().getFullYear();
    expect(verifyNumericClaims(`As of ${year}, Amoxicillin 500mg has 84 used.`, facts)).toBe(true);
  });

  it("whitelists small integers 1-12 (ordinals / month references)", () => {
    expect(verifyNumericClaims("This is the 3rd request this month; Amoxicillin 500mg has 84 used.", facts)).toBe(true);
    expect(verifyNumericClaims("Amoxicillin 500mg has 84 used, checked on day 12.", facts)).toBe(true);
  });

  it("does not whitelist integers outside 1-12", () => {
    expect(verifyNumericClaims("Amoxicillin 500mg has 84 used, checked on day 13.", facts)).toBe(false);
  });

  it("passes trivially when the answer has no numbers", () => {
    expect(verifyNumericClaims("I don't have that information.", facts)).toBe(true);
  });

  it("matches decimal numbers verbatim", () => {
    const decimalFacts = "out_per_day_90d: 14.2";
    expect(verifyNumericClaims("You're using about 14.2 units per day.", decimalFacts)).toBe(true);
    expect(verifyNumericClaims("You're using about 14.5 units per day.", decimalFacts)).toBe(false);
  });
});
