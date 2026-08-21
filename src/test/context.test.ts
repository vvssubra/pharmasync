import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDataFacts, classifyIntent, buildSystemPrompt } from "../../supabase/functions/ai-query/context";
import { projectedExhaustion } from "../../supabase/functions/_shared/quotaHelpers";

interface MockBuilder {
  select: () => MockBuilder;
  eq: () => MockBuilder;
  in: () => MockBuilder;
  gte: () => MockBuilder;
  order: () => MockBuilder;
  then: (resolve: (v: { data: unknown[]; error: null }) => void) => void;
}

// A minimal fluent Supabase-like mock: routes by table name, ignores filter
// chaining (RLS/filtering behaviour belongs to Supabase itself — this only
// exercises buildDataFacts's own aggregation/formatting logic).
// The return is widened to the real SupabaseClient because buildDataFacts is
// typed against it. Before src/types/deno-remote-modules.d.ts existed, the
// https:// import in context.ts failed to resolve and SupabaseClient silently
// degraded to `any`, so this mismatch went unreported. The mock is
// intentionally partial — see the note above — hence the cast rather than a
// fuller stub.
function mockSupabase(
  tables: Record<string, unknown[]>,
  rpcResults: Record<string, unknown[]>
): SupabaseClient {
  return {
    from(table: string): MockBuilder {
      const data = tables[table] ?? [];
      const builder: MockBuilder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        gte: () => builder,
        order: () => builder,
        then: (resolve) => resolve({ data, error: null }),
      };
      return builder;
    },
    rpc(name: string) {
      return Promise.resolve({ data: rpcResults[name] ?? [], error: null });
    },
  } as unknown as SupabaseClient;
}

describe("classifyIntent", () => {
  it.each([
    ["how much quota is remaining for insulin", "quota"],
    ["kuota untuk ubat ini", "quota"],
    ["which drugs are critically low on stock", "stock"],
    ["any drugs near reorder level", "stock"],
    ["how many requests are pending", "requests"],
    ["what is the meaning of life", "unknown"],
  ] as const)("classifies %j as %s", (question, expected) => {
    expect(classifyIntent(question)).toBe(expected);
  });
});

describe("buildSystemPrompt", () => {
  it("embeds the FACTS block and the numeric/naming guard instructions", () => {
    const prompt = buildSystemPrompt("mo", "QUOTA...\nSTOCK...");
    expect(prompt).toContain("QUOTA...");
    expect(prompt).toContain("STOCK...");
    expect(prompt).toContain("copied character-for-character");
    expect(prompt).toContain("I don't have that information");
    expect(prompt).toContain("Terimaan");
  });
});

describe("buildDataFacts", () => {
  const currentYear = new Date().getFullYear();

  it("returns hasFacts=false and an empty string when there's nothing to report", async () => {
    const supabase = mockSupabase(
      { drugs: [], transactions: [], dispensing_requests: [], antibiotic_forms: [] },
      { get_drug_quota_usage: [] },
    );
    const result = await buildDataFacts(supabase, "admin", "u1", "anything?", "KK Kempas");
    expect(result.hasFacts).toBe(false);
    expect(result.factsText).toBe("");
  });

  it("never includes patient names or ICs, even though the underlying tables have them", async () => {
    const supabase = mockSupabase(
      {
        drugs: [{ id: "d1", drug_name: "Amoxicillin 500mg", unit_pengukuran: "Capsule" }],
        clinic_drug_settings: [{ drug_id: "d1", stok_min: 200, stok_reorder: 400 }],
        transactions: [{ drug_id: "d1", jenis: "keluaran", kuantiti: 5, tarikh: "2026-01-01" }],
        dispensing_requests: [{ status: "pending_pharmacy", patient_name: "Ahmad bin Ali", no_ic: "900101-01-1234" }],
        antibiotic_forms: [{ status: "pending_specialist", patient_name: "Siti binti Osman", diagnosis: "confidential clinical detail" }],
      },
      { get_drug_quota_usage: [] },
    );
    const result = await buildDataFacts(supabase, "admin", "u1", "status?", "KK Kempas");
    expect(result.factsText).not.toContain("Ahmad");
    expect(result.factsText).not.toContain("Siti");
    expect(result.factsText).not.toContain("900101");
    expect(result.factsText).not.toContain("confidential clinical detail");
  });

  it("caps the STOCK section at 15 rows and summarises the rest with an omitted-count line", async () => {
    const drugs = Array.from({ length: 100 }, (_, i) => ({
      id: `d${i}`,
      drug_name: `Drug ${i}`,
      unit_pengukuran: "Tablet",
    }));
    const clinicDrugSettings = drugs.map((d) => ({ drug_id: d.id, stok_min: 100, stok_reorder: 200 }));
    // First 20 drugs critical (below min), the rest have no transactions ->
    // balance 0 -> also critical by this drug's own min/reorder... so give
    // the remaining 80 a healthy balance via a baki_awal instead.
    const transactions = [
      ...drugs.slice(0, 20).map((d) => ({ drug_id: d.id, jenis: "baki_awal", kuantiti: 5, tarikh: "2026-01-01" })), // critical
      ...drugs.slice(20).map((d) => ({ drug_id: d.id, jenis: "baki_awal", kuantiti: 500, tarikh: "2026-01-01" })), // normal
    ];
    const supabase = mockSupabase(
      { drugs, clinic_drug_settings: clinicDrugSettings, transactions, dispensing_requests: [], antibiotic_forms: [] },
      { get_drug_quota_usage: [] },
    );
    const result = await buildDataFacts(supabase, "admin", "u1", "which drugs are low?", "KK Kempas");
    expect(result.hasFacts).toBe(true);

    const stockLines = result.factsText.split("\n\n").find((s) => s.startsWith("STOCK"))!;
    const rows = stockLines.split("\n").filter((l) => l.startsWith("Drug "));
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(stockLines).toMatch(/other drugs are at normal stock/);
    expect(result.factsText.length).toBeLessThanOrEqual(1400 + 200); // cap plus the truncation marker's own length
  });

  it("QUOTA section's projected_exhaustion matches calling projectedExhaustion with the same inputs", async () => {
    const used = 84;
    const quotaLimit = 100;
    const remaining = 16;
    const supabase = mockSupabase(
      {
        drugs: [{ id: "d1", drug_name: "Novomix 30 FlexPen", unit_pengukuran: "Pen" }],
        transactions: [],
        dispensing_requests: [],
        antibiotic_forms: [],
      },
      {
        get_drug_quota_usage: [
          { clinic_id: "c1", drug_id: "d1", year: currentYear, quota_limit: quotaLimit, alert_threshold_pct: 20, used, remaining },
        ],
      },
    );
    const result = await buildDataFacts(supabase, "admin", "u1", "quota status", "KK Kempas");
    const quotaLine = result.factsText.split("\n").find((l) => l.startsWith("Novomix"))!;
    expect(quotaLine).toBeDefined();

    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
    const dayOfYear = Math.max(1, Math.ceil((now.getTime() - startOfYear) / 86_400_000) + 1);
    const usedPerMonth = (used / dayOfYear) * 30.4;
    const expectedProjection = projectedExhaustion(remaining, usedPerMonth);

    expect(quotaLine).toContain(expectedProjection);
  });

  it("builds facts for super_admin — the role is not gated out of data", async () => {
    // super_admin has clinic_id NULL by design, but every clinic-scoped RLS
    // policy is `is_super_admin() or clinic_id = user_clinic_id()`, so their
    // caller-scoped client does return rows. ai-query used to refuse these
    // questions outright, which made the assistant look broken for the one
    // account most likely to be demoing it.
    const currentYear = new Date().getFullYear();
    const supabase = mockSupabase(
      {
        clinics: [{ name: "Klinik Kesihatan Kempas" }],
        drugs: [{ id: "d1", drug_name: "Novomix 30 FlexPen", unit_pengukuran: "Pen" }],
        transactions: [],
        dispensing_requests: [],
        antibiotic_forms: [],
      },
      {
        get_drug_quota_usage: [
          { clinic_id: "c1", drug_id: "d1", year: currentYear, quota_limit: 100, alert_threshold_pct: 20, used: 84, remaining: 16 },
        ],
      },
    );
    const result = await buildDataFacts(supabase, "super_admin", "u1", "quota status", "Klinik Kesihatan Kempas");
    expect(result.hasFacts).toBe(true);
    expect(result.factsText).toContain("Novomix 30 FlexPen");
    expect(result.factsText).toContain("16");
  });

  it("gives super_admin a role capability line rather than the generic fallback", () => {
    const prompt = buildSystemPrompt("super_admin", "FACTS");
    expect(prompt).toContain("across the clinic");
  });

  it("reports a controlled drug on quota remaining, not shelf stock, when the ledger is empty", async () => {
    // The live clinic had zero transactions and two controlled insulins. The
    // dashboards show remaining annual quota for controlled drugs, but the
    // FACTS builder computed shelf stock — so the assistant called both drugs
    // 0/critical while the dashboard showed 29 (NORMAL) and 5 (LOW).
    const currentYear = new Date().getFullYear();
    const supabase = mockSupabase(
      {
        clinics: [{ name: "Klinik Kesihatan Kempas" }],
        drugs: [
          { id: "d1", drug_name: "Insulin Aspart NOVOMIX", unit_pengukuran: "Pen", perlu_kelulusan_pakar: true },
        ],
        transactions: [],
        dispensing_requests: [],
        antibiotic_forms: [],
      },
      {
        get_drug_quota_usage: [
          { clinic_id: "c1", drug_id: "d1", year: currentYear, quota_limit: 100, alert_threshold_pct: 20, used: 71, remaining: 29 },
        ],
      },
    );
    // Named in the question, so it survives selectRows even though it's normal.
    const result = await buildDataFacts(supabase, "admin", "u1", "what is the status of Insulin Aspart?", "Klinik Kesihatan Kempas");
    const stockLine = result.factsText
      .split("\n")
      .find((l) => l.startsWith("Insulin Aspart NOVOMIX") && l.includes("|quota|"));

    expect(stockLine, "controlled drug should appear on a quota basis row").toBeDefined();
    // 29 remaining of 100 with a 20% threshold is healthy -> normal, NOT critical.
    expect(stockLine).toContain("|29|");
    expect(stockLine).toContain("normal");
    expect(stockLine).not.toContain("critical");
    expect(result.factsText).toContain("REMAINING ANNUAL PATIENT QUOTA");
    // The unit must be patients, not the drug's dispensing unit — quota counts
    // enrolled patients, and labelling it "Pen" led to the answer "29 vials".
    expect(stockLine).toContain("|patients|");
    expect(stockLine).not.toContain("|Pen|");
  });

  it("does not list a healthy controlled drug when asked which drugs are low", async () => {
    // The exact live regression: an empty ledger made every controlled drug
    // read as 0/critical, so "which drugs are low on stock?" returned both
    // insulins when only one was actually low on quota.
    const currentYear = new Date().getFullYear();
    const supabase = mockSupabase(
      {
        clinics: [{ name: "KK Kempas" }],
        drugs: [
          { id: "d1", drug_name: "Insulin Aspart NOVOMIX", unit_pengukuran: "Pen", perlu_kelulusan_pakar: true },
          { id: "d2", drug_name: "Insulin Detemir LEVEMIR", unit_pengukuran: "Pen", perlu_kelulusan_pakar: true },
        ],
        transactions: [],
        dispensing_requests: [],
        antibiotic_forms: [],
      },
      {
        get_drug_quota_usage: [
          { clinic_id: "c1", drug_id: "d1", year: currentYear, quota_limit: 100, alert_threshold_pct: 20, used: 71, remaining: 29 },
          { clinic_id: "c1", drug_id: "d2", year: currentYear, quota_limit: 40, alert_threshold_pct: 20, used: 35, remaining: 5 },
        ],
      },
    );
    const result = await buildDataFacts(supabase, "admin", "u1", "which drugs are low on stock?", "KK Kempas");
    const stockRows = result.factsText
      .split("\n")
      .filter((l) => l.includes("|quota|"));

    expect(stockRows.some((l) => l.startsWith("Insulin Detemir LEVEMIR"))).toBe(true);
    expect(stockRows.some((l) => l.startsWith("Insulin Aspart NOVOMIX"))).toBe(false);
  });

  it("says an empty ledger is unrecorded rather than letting 0 read as depleted", async () => {
    const supabase = mockSupabase(
      {
        clinics: [{ name: "KK" }],
        drugs: [
          { id: "d9", drug_name: "Paracetamol 500mg", unit_pengukuran: "Tablet", perlu_kelulusan_pakar: false },
        ],
        transactions: [],
        dispensing_requests: [],
        antibiotic_forms: [],
      },
      { get_drug_quota_usage: [] },
    );
    const result = await buildDataFacts(supabase, "admin", "u1", "which drugs are low on stock?", "KK");
    expect(result.factsText).toContain("no Terimaan/Keluaran transactions have been recorded yet");
  });
});
