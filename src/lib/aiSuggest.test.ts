import { describe, it, expect } from "vitest";
import { parseAiSuggestion, describeAiSuggestFailure, stripPatientIdentifiers } from "./aiSuggest";

describe("stripPatientIdentifiers", () => {
  it("removes the patient's full name, name parts and IC however typed", () => {
    const out = stripPatientIdentifiers(
      "Ahmad Faizal bin Ismail 900101-14-5678 PID, ahmad c/o fever; IC 900101145678",
      "Ahmad Faizal bin Ismail",
      "900101-14-5678",
    );
    expect(out).not.toMatch(/ahmad|faizal|ismail/i);
    expect(out).not.toMatch(/900101/);
    expect(out).toContain("PID");
    expect(out).toContain("fever");
  });

  it("keeps name connectors and unrelated clinical text intact", () => {
    expect(stripPatientIdentifiers("cellulitis left leg, bin collection", "Siti binti Ali", "")).toBe("cellulitis left leg, bin collection");
  });

  it("is a no-op when name and IC are blank", () => {
    expect(stripPatientIdentifiers("CAP", "", "")).toBe("CAP");
  });
});

const regimen = { drug: "Amoxicillin", tier: "Preferred", penicillinClass: true, text: "Amoxicillin 500mg PO TDS x 5 days", computed: false };

describe("parseAiSuggestion", () => {
  it("accepts the current regimens-array shape", () => {
    const parsed = parseAiSuggestion({ regimens: [regimen], rationale: "NAG CAP.", warning: null, source: "rules" });
    expect(parsed?.regimens).toHaveLength(1);
    expect(parsed?.source).toBe("rules");
  });

  it("accepts an AI-located NAG result carrying the verified section breadcrumb", () => {
    const aiRegimen = { ...regimen, sourcePath: "NAG Section A (Adult) — Respiratory › 1.3 Inpatient" };
    const parsed = parseAiSuggestion({ regimens: [aiRegimen], rationale: "Quoted from NAG 2024.", warning: null, source: "nag_ai" });
    expect(parsed?.source).toBe("nag_ai");
    expect(parsed?.regimens[0].sourcePath).toBe(aiRegimen.sourcePath);
    expect(parseAiSuggestion({ regimens: [{ ...regimen, sourcePath: 42 }], rationale: "r", warning: null, source: "nag_ai" })).toBeNull();
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
