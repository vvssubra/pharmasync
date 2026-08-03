import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { matchPathway, patientGroupFromAge, isStatedAllergy, NAG_PATHWAYS } from "../../supabase/functions/_shared/nagPathways";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = resolve(__dirname, "../../knowledge-service/vault-sample");

describe("matchPathway", () => {
  it("matches by derivePathwayIndication-style indication text", () => {
    const p = matchPathway("Pharyngitis", "Any");
    expect(p?.id).toBe("pharyngitis");
  });

  it("never matches on indication text alone — a null indication is always null", () => {
    // No free-text diagnosis fallback: matching is checklist-derived
    // indication only, so a doctor's shorthand diagnosis can never silently
    // redirect which pathway is suggested.
    expect(matchPathway(null, "Paediatric")).toBeNull();
  });

  it("prefers a pathway whose patientGroup matches the caller's", () => {
    // "pharyngitis" is patientGroup "Any" so it should still match regardless.
    const p = matchPathway("pharyngitis", "Paediatric");
    expect(p?.id).toBe("pharyngitis");
  });

  it("returns null when nothing matches", () => {
    expect(matchPathway("unrelated made-up condition", "Any")).toBeNull();
  });
});

describe("patientGroupFromAge", () => {
  it("classifies under 12 as Paediatric", () => {
    expect(patientGroupFromAge(4)).toBe("Paediatric");
    expect(patientGroupFromAge(11)).toBe("Paediatric");
  });
  it("classifies 12+ as Adult", () => {
    expect(patientGroupFromAge(12)).toBe("Adult");
    expect(patientGroupFromAge(45)).toBe("Adult");
  });
  it("classifies unknown age as Any", () => {
    expect(patientGroupFromAge(undefined)).toBe("Any");
    expect(patientGroupFromAge(null)).toBe("Any");
  });
});

describe("isStatedAllergy", () => {
  it("treats none/no/nkda/nil as no allergy", () => {
    for (const v of ["None", "no", "NKDA", "Nil", "none / nkda"]) {
      expect(isStatedAllergy(v)).toBe(false);
    }
  });
  it("treats a described allergy as an allergy", () => {
    expect(isStatedAllergy("Penicillin rash")).toBe(true);
  });
  it("treats empty/undefined as no allergy", () => {
    expect(isStatedAllergy(undefined)).toBe(false);
    expect(isStatedAllergy("")).toBe(false);
  });
});

describe("NAG_PATHWAYS <-> knowledge-service/vault-sample parity", () => {
  it("every vault-sample note's indication resolves to a NAG_PATHWAYS entry", () => {
    const files = readdirSync(VAULT_DIR).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = readFileSync(resolve(VAULT_DIR, file), "utf-8");
      const match = text.match(/^indication:\s*(.+)$/m);
      expect(match, `${file} has no frontmatter indication`).not.toBeNull();
      const indication = match![1].trim();
      const pathway = matchPathway(indication, "Any");
      expect(pathway, `no NAG_PATHWAYS entry matches vault note "${file}" (indication: "${indication}")`).not.toBeNull();
    }
  });

  it("every pathway names at least one allowed drug and a source citation", () => {
    for (const p of NAG_PATHWAYS) {
      expect(p.allowedDrugs.length).toBeGreaterThan(0);
      expect(p.source).toContain("NAG 2024");
    }
  });
});
