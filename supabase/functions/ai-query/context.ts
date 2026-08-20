// supabase/functions/ai-query/context.ts
// Replaces fetchDataContext/buildSystemPrompt from the old Anthropic-based
// ai-query. Rules-first: FAQ retrieval and intent routing are plain
// TypeScript, the model only ever phrases a pre-computed FACTS block — it
// never sees raw table rows, never sees patient names, and every number it
// states is checked against FACTS afterward (verifyNumericClaims).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import { computeStockByDrug, stockStatus, avgDailyOut } from "../_shared/stock.ts";
import { daysRemaining, projectedExhaustion, quotaBadgeState, quotaDerivedStatus } from "../_shared/quotaHelpers.ts";
import { retrieveFaq, type FaqEntry } from "../_shared/faq.ts";

export type Intent = "quota" | "stock" | "requests" | "unknown";

const QUOTA_KEYWORDS = ["quota", "kuota", "limit", "remaining", "run out", "runs out", "exhaust", "habis"];
const STOCK_KEYWORDS = ["stock", "baki", "balance", "low", "critical", "reorder", "days of cover", "days cover", "out of stock", "shortage"];
const REQUEST_KEYWORDS = ["pending", "approve", "approved", "reject", "rejected", "fulfil", "fulfill", "fulfilled", "request status", "my request", "deferred"];

/**
 * Keyword routing for the non-FAQ remainder of a question. FAQ retrieval
 * (retrieveFaq) already runs first with its own IDF scoring — this only
 * decides which data section(s) to fetch once FAQ has scored below its
 * floor, so it doesn't need its own "faq" branch.
 */
export function classifyIntent(question: string): Intent {
  const norm = question.toLowerCase();
  if (QUOTA_KEYWORDS.some((k) => norm.includes(k))) return "quota";
  if (STOCK_KEYWORDS.some((k) => norm.includes(k))) return "stock";
  if (REQUEST_KEYWORDS.some((k) => norm.includes(k))) return "requests";
  return "unknown";
}

export { retrieveFaq };
export type { FaqEntry };

// ── FACTS block ──────────────────────────────────────────────────────────

const MAX_ROWS_PER_SECTION = 15;
const MAX_FACTS_CHARS = 1400;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fuzzyNamedInQuestion(name: string, questionNorm: string): boolean {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .some((t) => questionNorm.includes(t));
}

/** Every non-normal row, plus any row fuzzily named in the question, capped. */
function selectRows<T>(
  rows: T[],
  question: string,
  getName: (r: T) => string,
  isNonNormal: (r: T) => boolean,
  cap: number,
): { shown: T[]; omitted: number } {
  const qNorm = question.toLowerCase();
  const priority = rows.filter((r) => isNonNormal(r) || fuzzyNamedInQuestion(getName(r), qNorm));
  const shown = priority.slice(0, cap);
  return { shown, omitted: rows.length - shown.length };
}

interface QuotaRow {
  drug_id: string;
  quota_limit: number;
  alert_threshold_pct: number;
  used: number;
  remaining: number;
}

async function buildQuotaSection(supabase: SupabaseClient, question: string, clinicName: string): Promise<string | null> {
  const now = new Date();
  const year = now.getFullYear();
  const { data: usage, error } = await supabase.rpc("get_drug_quota_usage", { p_year: year });
  if (error) {
    console.error("get_drug_quota_usage error:", error.message);
    return null;
  }
  const rows = (usage ?? []) as QuotaRow[];
  if (rows.length === 0) return null;

  const drugIds = rows.map((r) => r.drug_id);
  const { data: drugs } = await supabase.from("drugs").select("id, drug_name").in("id", drugIds);
  const nameById = new Map<string, string>(
    (drugs ?? []).map((d: { id: string; drug_name: string }): [string, string] => [d.id, d.drug_name]),
  );

  const startOfYear = new Date(year, 0, 1).getTime();
  const dayOfYear = Math.max(1, Math.ceil((now.getTime() - startOfYear) / 86_400_000) + 1);
  const daysInYear = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;

  const computed = rows.map((r) => {
    const usedPerDay = r.used / dayOfYear;
    const usedPerMonth = usedPerDay * 30.4;
    return {
      drug: nameById.get(r.drug_id) ?? "Unknown drug",
      limit: r.quota_limit,
      used: r.used,
      remaining: r.remaining,
      pctUsed: r.quota_limit > 0 ? Math.round((r.used / r.quota_limit) * 100) : 0,
      perMonth: usedPerMonth,
      projected: projectedExhaustion(r.remaining, usedPerMonth),
      status: quotaBadgeState(r.used, r.quota_limit, r.alert_threshold_pct),
    };
  });

  const { shown, omitted } = selectRows(
    computed,
    question,
    (r) => r.drug,
    (r) => r.status !== "healthy",
    MAX_ROWS_PER_SECTION,
  );

  // The header used to read "QUOTA <year> · <clinic>", which invited the model
  // to answer "your clinic has 29 left". Since
  // supabase/migrations/20260819000300_national_quota_pool.sql
  // get_drug_quota_usage() returns the NATIONAL pool — one row per drug, usage
  // summed across every clinic — so the clinic name is only the asker's
  // location, never the scope of these numbers. Said explicitly because the
  // model cannot infer it from the figures.
  const lines = [
    `QUOTA ${year} · NATIONAL POOL, shared by all clinics (asked from ${clinicName}) · as of ${todayISO()} (day ${dayOfYear} of ${daysInYear})`,
    "These limits and counts are NATIONAL: one annual allocation per controlled drug set by PKD Logistik, drawn down by every clinic together. Never describe them as this clinic's own quota, and never imply another clinic has a separate allowance.",
    "drug|limit|used|remaining|pct_used|per_month|projected_exhaustion|status",
    ...shown.map((r) => `${r.drug}|${r.limit}|${r.used}|${r.remaining}|${r.pctUsed}|${r.perMonth.toFixed(1)}|${r.projected}|${r.status}`),
  ];
  if (omitted > 0) lines.push(`... ${omitted} other drugs are within their national quota.`);
  return lines.join("\n");
}

interface DrugRow {
  id: string;
  drug_name: string;
  unit_pengukuran: string;
  stok_min: number | null;
  stok_reorder: number | null;
  perlu_kelulusan_pakar: boolean | null;
}

async function buildStockSection(supabase: SupabaseClient, question: string): Promise<string | null> {
  // Fetch full transaction history (not just a 90-day slice) so the balance
  // can't miss an older baki_awal — avgDailyOut internally windows itself
  // to the trailing 90 days off the same array, so one query covers both
  // "balance needs full history" and "rate needs a recent window".
  //
  // Quota usage is fetched alongside because controlled drugs are reported on
  // quota, not shelf stock — see the basis note below.
  const year = new Date().getFullYear();
  const [{ data: drugs }, { data: txns }, { data: quotaRows }] = await Promise.all([
    supabase.from("drugs").select("id, drug_name, unit_pengukuran, stok_min, stok_reorder, perlu_kelulusan_pakar").eq("is_active", true),
    supabase.from("transactions").select("drug_id, jenis, kuantiti, tarikh, created_at"),
    supabase.rpc("get_drug_quota_usage", { p_year: year }),
  ]);
  const drugRows = (drugs ?? []) as DrugRow[];
  if (drugRows.length === 0) return null;

  const quotaByDrug = new Map<string, QuotaRow>();
  for (const q of (quotaRows ?? []) as QuotaRow[]) quotaByDrug.set(q.drug_id, q);

  const balances = computeStockByDrug(txns ?? []);
  const computed = drugRows.map((d) => {
    const quota = quotaByDrug.get(d.id);
    // Mirrors Index.tsx / FmsDashboard.tsx: for a controlled drug with a quota
    // configured, the operative constraint is remaining annual patient quota,
    // not vials on the shelf. Reporting shelf stock for these drugs made the
    // assistant contradict the dashboard the user was looking at — with an
    // empty ledger it called every controlled drug 0/critical while the
    // dashboard showed quota remaining.
    const quotaStatus = quotaDerivedStatus(d.perlu_kelulusan_pakar ?? false, quota);
    if (quotaStatus && quota) {
      return {
        drug: d.drug_name,
        // NOT d.unit_pengukuran: the figure is remaining annual patient quota,
        // so the unit is patients, not Pen/vial/Tablet. Carrying the dispensing
        // unit here made the model answer "29 vials" for what is 29 patients'
        // worth of remaining quota.
        unit: "patients",
        basis: "quota" as const,
        balance: quota.remaining,
        min: 0,
        reorder: 0,
        status: quotaStatus,
        rate: 0,
        days: null as number | null,
      };
    }
    const balance = balances.get(d.id) ?? 0;
    const min = d.stok_min ?? 0;
    const reorder = d.stok_reorder ?? 0;
    const rate = avgDailyOut(txns ?? [], d.id, 90);
    return {
      drug: d.drug_name,
      unit: d.unit_pengukuran,
      basis: "stock" as const,
      balance,
      min,
      reorder,
      status: stockStatus(balance, min, reorder),
      rate,
      days: daysRemaining(balance, rate),
    };
  });

  const { shown, omitted } = selectRows(
    computed,
    question,
    (r) => r.drug,
    (r) => r.status !== "normal",
    MAX_ROWS_PER_SECTION,
  );

  // An empty ledger is not the same as "everything is at zero". Say so rather
  // than letting the model assert a balance nobody recorded.
  const ledgerEmpty = (txns ?? []).length === 0;
  const stockBasedShown = shown.filter((r) => r.basis === "stock");

  const lines = [
    `STOCK · as of ${todayISO()} (showing ${shown.length} of ${computed.length} drugs: all non-normal + drugs named in the question)`,
    "basis=quota means balance is REMAINING ANNUAL PATIENT QUOTA from the NATIONAL pool shared by every clinic (how many more patients may be enrolled this year across the whole country, not at this clinic alone) and its unit is patients — never call it vials, pens or tablets, and never call it this clinic's own. basis=stock means physical units in this clinic's store.",
    "drug|unit|basis|balance|min|reorder|status|out_per_day_90d|days_cover",
    ...shown.map((r) => `${r.drug}|${r.unit}|${r.basis}|${r.balance}|${r.min}|${r.reorder}|${r.status}|${r.rate.toFixed(1)}|${r.days ?? "—"}`),
  ];
  if (ledgerEmpty && stockBasedShown.length > 0) {
    lines.push("NOTE: no Terimaan/Keluaran transactions have been recorded yet, so every basis=stock balance above is 0 because nothing has been entered — not because the drug ran out.");
  }
  if (omitted > 0) lines.push(`... ${omitted} other drugs are at normal stock.`);
  return lines.join("\n");
}

function countByStatus(rows: { status: string }[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  if (counts.size === 0) return "none in the last 30 days";
  return [...counts.entries()].map(([status, n]) => `${status}=${n}`).join(" ");
}

async function buildRequestsSection(supabase: SupabaseClient, role: string, userId: string): Promise<string | null> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  let dispensingQuery = supabase.from("dispensing_requests").select("status").gte("created_at", since);
  // RLS already clinic-scopes every role; mo additionally only sees their
  // own submissions in the app's other views, so mirror that here too.
  if (role === "mo") dispensingQuery = dispensingQuery.eq("submitted_by", userId);

  const [{ data: dispensing }, { data: antibiotic }] = await Promise.all([
    dispensingQuery,
    supabase.from("antibiotic_forms").select("status").gte("created_at", since),
  ]);

  if ((dispensing ?? []).length === 0 && (antibiotic ?? []).length === 0) return null;

  return [
    "REQUESTS last 30d",
    `dispensing: ${countByStatus(dispensing ?? [])}`,
    `antibiotic: ${countByStatus(antibiotic ?? [])}`,
  ].join("\n");
}

export interface FactsResult {
  factsText: string;
  hasFacts: boolean;
}

/**
 * Builds the combined QUOTA + STOCK + REQUESTS FACTS block for any data
 * intent. classifyIntent distinguishes "some data question" from "unknown"
 * (which short-circuits before this is ever called) — it doesn't gate which
 * sections are included, since a single question ("what's low and near
 * quota?") can span more than one section and the numeric guard rail needs
 * the union of everything stated to validate the model's answer against.
 */
export async function buildDataFacts(
  supabase: SupabaseClient,
  role: string,
  userId: string,
  question: string,
  clinicName: string,
): Promise<FactsResult> {
  const sections = await Promise.all([
    buildQuotaSection(supabase, question, clinicName).catch((err) => {
      console.error("buildQuotaSection error:", err instanceof Error ? err.message : err);
      return null;
    }),
    buildStockSection(supabase, question).catch((err) => {
      console.error("buildStockSection error:", err instanceof Error ? err.message : err);
      return null;
    }),
    buildRequestsSection(supabase, role, userId).catch((err) => {
      console.error("buildRequestsSection error:", err instanceof Error ? err.message : err);
      return null;
    }),
  ]);

  let factsText = sections.filter((s): s is string => !!s).join("\n\n");
  if (factsText.length > MAX_FACTS_CHARS) {
    factsText = `${factsText.slice(0, MAX_FACTS_CHARS)}\n... (truncated)`;
  }
  return { factsText, hasFacts: factsText.length > 0 };
}

// ── System prompt ────────────────────────────────────────────────────────

// "quota" in every line below means the national controlled-drug pool — see
// the QUOTA section header in buildQuotaSection().
const ROLE_CAPABILITY: Record<string, string> = {
  mo: "You can help with the status of this MO's own dispensing requests and national controlled-drug quota questions.",
  pharmacist: "You can help with the fulfilment queue, drug stock levels, and request status.",
  admin: "You can help with drug stock, national controlled-drug quotas, and request status across the clinic.",
  fms: "You can help with national controlled-drug quota status, drug stock, and pending approvals.",
  super_admin: "You can help with drug stock, national controlled-drug quotas, and request status across the clinic.",
};

export function buildSystemPrompt(role: string, factsText: string): string {
  const capability = ROLE_CAPABILITY[role] ?? "You can help with pharmacy stock and request questions.";
  return `You are PharmaSync's pharmacy assistant for a Malaysian government clinic.
Answer in English, in at most 3 sentences, plain text — no markdown, no lists.
Every number in your answer must be copied character-for-character from FACTS below — never calculate, round, or infer a number not already there, and never name a drug not listed in FACTS.
If FACTS does not answer the question, reply with exactly: I don't have that information.
Keep these terms exactly as written: Terimaan, Keluaran, Baki Awal, Pesara, Kuota, FMS, MO.
${capability}

FACTS:
${factsText}`;
}

// ── Numeric guard rail ───────────────────────────────────────────────────

const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;

/**
 * Every number the model states must appear verbatim in FACTS — the model
 * may phrase, it may never calculate. Whitelists the current year and small
 * integers (1-12) used as ordinals/month references rather than data.
 */
export function verifyNumericClaims(answer: string, factsText: string): boolean {
  const currentYear = String(new Date().getFullYear());
  const numbers = answer.match(NUMBER_PATTERN) ?? [];
  for (const raw of numbers) {
    if (raw === currentYear) continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 1 && value <= 12) continue;
    if (!factsText.includes(raw)) return false;
  }
  return true;
}
