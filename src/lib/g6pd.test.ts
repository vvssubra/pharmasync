import { describe, it, expect } from "vitest";
import { searchDrugs, allDrugs, classesByRisk, drugsInBothTiers } from "./g6pd";
import { G6PD_CLASSES } from "./g6pdDrugs";

describe("searching the G6PD table", () => {
  it("finds a drug by name", () => {
    const [hit] = searchDrugs("primaquine");
    expect(hit.name).toBe("Primaquine");
    expect(hit.risk).toBe("definite");
    expect(hit.className).toBe("Antimalarials");
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(searchDrugs("  PARACETAMOL ")[0].name).toBe("Paracetamol");
  });

  // Staff know the brand or the older name as often as the INN.
  it("finds a drug by its alternative name", () => {
    expect(searchDrugs("aspirin")[0].name).toBe("Acetylsalicylic acid");
    expect(searchDrugs("acetaminophen")[0].name).toBe("Paracetamol");
    expect(searchDrugs("pyridium")[0].name).toBe("Phenazopyridine");
  });

  it("finds a whole family by its heading", () => {
    const quinolones = searchDrugs("quinolones");
    expect(quinolones.map(d => d.name).sort()).toEqual([
      "Ciprofloxacin", "Moxifloxacin", "Nalidixic acid", "Norfloxacin", "Ofloxacin",
    ]);
  });

  // Substring, not prefix: nobody types a sulfonamide from the front.
  it("matches on a substring", () => {
    expect(searchDrugs("oxazole").map(d => d.name)).toContain("Co-trimoxazole");
  });

  it("returns nothing for an empty query", () => {
    expect(searchDrugs("")).toEqual([]);
    expect(searchDrugs("   ")).toEqual([]);
  });

  it("returns nothing for a drug that is not on the table", () => {
    expect(searchDrugs("amoxicillin")).toEqual([]);
  });

  // Quinidine is published under both Antimalarials and Cardiovascular Drugs.
  it("returns every listing of a drug that appears more than once", () => {
    const quinidine = searchDrugs("quinidine");
    expect(quinidine).toHaveLength(2);
    expect(quinidine.map(d => d.className).sort()).toEqual([
      "Antimalarials", "Cardiovascular Drugs",
    ]);
  });

  // If a drug ever appears in both tiers, the more serious answer must be the
  // one the reader meets first.
  it("sorts definite risk ahead of possible risk", () => {
    const sulfa = searchDrugs("sulfa");
    const firstPossible = sulfa.findIndex(d => d.risk === "possible");
    const lastDefinite = sulfa.map(d => d.risk).lastIndexOf("definite");
    expect(lastDefinite).toBeLessThan(firstPossible);
  });
});

describe("the table itself", () => {
  it("splits into the source's two tiers and nothing else", () => {
    const risks = new Set(G6PD_CLASSES.map(c => c.risk));
    expect([...risks].sort()).toEqual(["definite", "possible"]);
  });

  it("carries both risk tiers with classes in each", () => {
    expect(classesByRisk("definite").length).toBeGreaterThan(0);
    expect(classesByRisk("possible").length).toBeGreaterThan(0);
  });

  it("has no empty class — an empty heading reads as 'nothing to avoid here'", () => {
    expect(G6PD_CLASSES.filter(c => c.drugs.length === 0).map(c => c.name)).toEqual([]);
  });

  it("names every drug", () => {
    expect(allDrugs().filter(d => !d.name.trim())).toEqual([]);
  });

  it("keeps the definite-risk antibiotics complete", () => {
    const antibiotics = G6PD_CLASSES.find(c => c.name === "Antibiotics" && c.risk === "definite");
    expect(antibiotics?.drugs).toHaveLength(17);
    expect(antibiotics?.drugs.map(d => d.name)).toContain("Chloramphenicol");
  });

  it("reports Quinidine as the only drug listed under two classes", () => {
    expect(drugsInBothTiers()).toEqual([]);
  });

  // The one entry the source paste did not resolve is kept and flagged, not
  // filed under a guessed class and not silently dropped.
  it("marks the unresolved entry rather than hiding it", () => {
    const unverified = allDrugs().filter(d => d.unverified);
    expect(unverified.map(d => d.name)).toEqual(["Proadione"]);
  });
});
