import { describe, it, expect } from "vitest";
import { retrieveFaq, FAQ_ENTRIES } from "../../supabase/functions/_shared/faq";

describe("retrieveFaq", () => {
  it("returns the direct tier verbatim for a strong alias match", () => {
    const entry = FAQ_ENTRIES.find((e) => e.id === "mo-quota-badge")!;
    const result = retrieveFaq(entry.aliases[0], "mo");
    expect(result.tier).toBe("faq");
    expect(result.top).toEqual([entry]);
  });

  it("every alias, queried verbatim for an allowed role, hits the direct tier", () => {
    for (const entry of FAQ_ENTRIES) {
      const role = entry.roles[0];
      for (const alias of entry.aliases) {
        const result = retrieveFaq(alias, role);
        expect(result.tier, `${entry.id} / "${alias}" / role ${role} -> ${result.tier} (score ${result.bestScore})`).toBe("faq");
        expect(result.top[0]?.id).toBe(entry.id);
      }
    }
  });

  it("falls to the llm-rephrase tier for a loose partial match", () => {
    // Fewer matching terms than the verbatim alias, but still on-topic.
    const result = retrieveFaq("Terimaan record", "pharmacist");
    expect(["llm", "faq"]).toContain(result.tier);
    expect(result.top.length).toBeGreaterThan(0);
  });

  it("falls to the none tier for an unrelated question", () => {
    const result = retrieveFaq("what is the weather like in outer space today", "mo");
    expect(result.tier).toBe("none");
    expect(result.top).toEqual([]);
  });

  it("returns none for an empty question", () => {
    expect(retrieveFaq("", "mo").tier).toBe("none");
  });

  it("filters by role before scoring — an mo query never returns an admin-only entry", () => {
    const adminOnly = FAQ_ENTRIES.find((e) => e.id === "admin-quota-alert-threshold")!;
    expect(adminOnly.roles).not.toContain("mo");

    const result = retrieveFaq(adminOnly.aliases[0], "mo");
    expect(result.top.map((e) => e.id)).not.toContain("admin-quota-alert-threshold");
  });

  it("returns k top candidates for the llm tier, all scoped to the caller's role", () => {
    const result = retrieveFaq("drug ledger", "pharmacist", 2);
    for (const entry of result.top) {
      expect(entry.roles).toContain("pharmacist");
    }
  });
});
