import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./featureFlags", () => ({
  KNOWLEDGE_URL: "http://localhost:8787",
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { suggestDose, exampleDoseFor, type DoseMatch } from "./knowledgeClient";

describe("suggestDose", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts query and patient_group to the knowledge-service suggest-dose endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ matches: [] }),
    });

    await suggestDose({ query: "Pharyngitis", patient_group: "Adult" });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8787/suggest-dose",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ query: "Pharyngitis", patient_group: "Adult" }),
      })
    );
  });

  it("returns the parsed matches on success", async () => {
    const matches = [{ drug: "Amoxicillin", indication: "AOM", patient_group: "Paediatric", source: "NAG 2024", body: "dose text", score: 0.9 }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ matches }),
    });

    const result = await suggestDose({ query: "ear infection", patient_group: "Paediatric" });

    expect(result).toEqual({ matches, message: undefined });
  });

  it("throws on a non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) });

    await expect(suggestDose({ query: "x", patient_group: "Any" })).rejects.toThrow();
  });

  it("throws on a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    await expect(suggestDose({ query: "x", patient_group: "Any" })).rejects.toThrow("network down");
  });
});

describe("exampleDoseFor", () => {
  function makeMatch(overrides: Partial<DoseMatch> = {}): DoseMatch {
    return {
      drug: "Phenoxymethylpenicillin",
      indication: "Acute Pharyngitis",
      patient_group: "Any",
      source: "NAG 2024",
      body: "Phenoxymethylpenicillin (Pen V) 500mg PO q6h OR 1g PO q12h x 5-10 days. (Preferred)\nPreferred alternative: Amoxicillin 500mg PO q8h x 5-10 days.",
      score: 0.9,
      ...overrides,
    };
  }

  it("returns the explicit example_dose when present", () => {
    const match = makeMatch({ example_dose: "Phenoxymethylpenicillin 500mg PO q6h x 5 days" });
    expect(exampleDoseFor(match)).toBe("Phenoxymethylpenicillin 500mg PO q6h x 5 days");
  });

  it("trims whitespace on the explicit example_dose", () => {
    const match = makeMatch({ example_dose: "  Amoxicillin 500mg TDS x 5 days  " });
    expect(exampleDoseFor(match)).toBe("Amoxicillin 500mg TDS x 5 days");
  });

  it("falls back to the first line of body when example_dose is absent", () => {
    const match = makeMatch({ example_dose: undefined });
    expect(exampleDoseFor(match)).toBe(
      "Phenoxymethylpenicillin (Pen V) 500mg PO q6h OR 1g PO q12h x 5-10 days. (Preferred)"
    );
  });

  it("falls back to the first line of body when example_dose is blank", () => {
    const match = makeMatch({ example_dose: "   " });
    expect(exampleDoseFor(match)).toBe(
      "Phenoxymethylpenicillin (Pen V) 500mg PO q6h OR 1g PO q12h x 5-10 days. (Preferred)"
    );
  });
});
