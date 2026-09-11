import { describe, it, expect } from "vitest";
import { parseAiSuggestion, describeAiSuggestFailure } from "./aiSuggest";

const regimen = { drug: "Amoxicillin", tier: "Preferred", penicillinClass: true, text: "Amoxicillin 500mg PO TDS x 5 days", computed: false };

describe("parseAiSuggestion", () => {
  it("accepts the current regimens-array shape", () => {
    const parsed = parseAiSuggestion({ regimens: [regimen], rationale: "NAG CAP.", warning: null, source: "rules" });
    expect(parsed?.regimens).toHaveLength(1);
    expect(parsed?.source).toBe("rules");
  });

  it("accepts a refer result with no regimens", () => {
    const parsed = parseAiSuggestion({ regimens: [], rationale: "No match.", warning: null, source: "refer" });
    expect(parsed?.regimens).toEqual([]);
    expect(parsed?.source).toBe("refer");
  });

  it("rejects the pre-2026-08-03 single-suggestion shape a stale edge function returns", () => {
    // This body used to throw on `regimens.map` and blank the antibiotic form.
    expect(parseAiSuggestion({ suggestion: "Amoxicillin 500mg TDS", rationale: "…", warning: null, source: "rules" })).toBeNull();
  });

  it("rejects non-object bodies and malformed regimens", () => {
    expect(parseAiSuggestion(null)).toBeNull();
    expect(parseAiSuggestion("oops")).toBeNull();
    expect(parseAiSuggestion({ regimens: [{ drug: "X" }], rationale: "r", warning: null, source: "rules" })).toBeNull();
    expect(parseAiSuggestion({ regimens: [], rationale: "r", warning: null, source: "llm" })).toBeNull();
  });
});

describe("describeAiSuggestFailure", () => {
  it("names the cause per status instead of one generic message", () => {
    expect(describeAiSuggestFailure(401)).toMatch(/session has expired/);
    expect(describeAiSuggestFailure(403, "Unauthorized: role not permitted")).toContain("Unauthorized: role not permitted");
    expect(describeAiSuggestFailure(403)).toMatch(/role is not permitted/);
    expect(describeAiSuggestFailure(400, "Invalid input")).toContain("Invalid input");
    expect(describeAiSuggestFailure(429)).toMatch(/limit reached/);
    expect(describeAiSuggestFailure(503)).toMatch(/temporarily unavailable/);
    expect(describeAiSuggestFailure(500, "boom")).toContain("HTTP 500");
    expect(describeAiSuggestFailure(500, "boom")).toContain("boom");
  });
});
