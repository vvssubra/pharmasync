// supabase/functions/ai-query/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { hermesChat } from "../_shared/hermes.ts";
import {
  verifyJWT,
  getUserRole,
  checkRateLimit,
  sanitizeInput,
  corsHeaders,
  writeAuditLog,
} from "../_shared/security.ts";

const RequestSchema = z.object({
  question: z.string().min(1).max(500),
});

const RATE_LIMIT = 20; // per user per hour
const FUNCTION_NAME = "ai-query";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }

  // ── 1. JWT verification ──────────────────────────────────────────────────
  const { userId, error: jwtError } = await verifyJWT(req.headers.get("authorization"));
  if (jwtError) {
    return new Response(JSON.stringify({ error: jwtError }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── 2. Role check ─────────────────────────────────────────────────────────
  const role = await getUserRole(userId!);
  if (!role) {
    return new Response(JSON.stringify({ error: "Unauthorized: no role assigned" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // Explicit allowlist — reject any unrecognized roles before rate limit
  const ALLOWED_ROLES = ["admin", "fms", "mo", "pharmacist"] as const;
  if (!ALLOWED_ROLES.includes(role as typeof ALLOWED_ROLES[number])) {
    return new Response(
      JSON.stringify({ error: "Unauthorized: role not permitted to use AI assistant" }),
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 3. Rate limit ─────────────────────────────────────────────────────────
  const { allowed, retryAfterSeconds } = await checkRateLimit(userId!, FUNCTION_NAME, RATE_LIMIT);
  if (!allowed) {
    try {
      await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 429, errorMessage: "rate_limit_exceeded" });
    } catch {
      // Audit log failure must not abort the primary response
    }
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded", retry_after_seconds: retryAfterSeconds }),
      { status: 429, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 4. Input validation ───────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid input", details: parsed.error.issues }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── 5. Sanitize input ─────────────────────────────────────────────────────
  const question = sanitizeInput(parsed.data.question);

  // ── 6. Fetch role-scoped data ─────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const dataContext = await fetchDataContext(supabase, userId!, role);

  // ── 7. Build system prompt ────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(role, dataContext);

  // ── 8. Local LLM call (Hermes via Ollama) ─────────────────────────────────
  let tokensUsed = 0;
  let answer = "";

  try {
    const response = await hermesChat({
      system: systemPrompt,
      user: question,
      maxTokens: 400,
    });
    tokensUsed = response.tokensUsed;
    answer = response.text;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("LLM error:", errMsg);
    try {
      await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 500, errorMessage: `llm_error: ${errMsg.slice(0, 200)}` });
    } catch {
      // Audit log failure must not abort the primary response
    }
    return new Response(JSON.stringify({ error: "AI service temporarily unavailable" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── 9. Audit log ──────────────────────────────────────────────────────────
  try {
    await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200, tokensUsed });
  } catch {
    // Audit log failure must not abort the primary response
  }

  return new Response(JSON.stringify({ answer }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});

// ── Data fetchers ─────────────────────────────────────────────────────────────
async function fetchDataContext(supabase: ReturnType<typeof createClient>, userId: string, role: string): Promise<object> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since = thirtyDaysAgo.toISOString();
  const currentYear = new Date().getFullYear();

  // Row caps keep the serialized context small enough for the local model's
  // context window (CPU prefill cost grows with every token).
  const MAX_ROWS = 100;

  if (role === "admin" || role === "fms") {
    const [stockResult, forecastResult, requestsResult, antibioticResult, quotasResult] = await Promise.all([
      supabase.from("drug_stock_status").select("drug_name, unit_pengukuran, current_stock, stok_min, stok_reorder, stok_max, status").eq("is_active", true).order("drug_name").limit(MAX_ROWS),
      supabase.from("drug_stock_forecast").select("drug_name, current_stock, avg_daily_keluaran, days_remaining, projected_exhaustion_date, forecast_status").eq("is_active", true).not("days_remaining", "is", null).order("days_remaining").limit(40),
      supabase.from("dispensing_requests").select("patient_name, status, created_at, drugs(drug_name)").gte("created_at", since).order("created_at", { ascending: false }).limit(MAX_ROWS),
      supabase.from("antibiotic_forms").select("patient_name, status, diagnosis, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(MAX_ROWS),
      supabase.from("drug_quotas").select("quota_limit, year, drugs(drug_name)").eq("year", currentYear),
    ]);
    if (stockResult.error) console.error("Supabase drug_stock_status query error:", stockResult.error.message);
    if (forecastResult.error) console.error("Supabase drug_stock_forecast query error:", forecastResult.error.message);
    if (requestsResult.error) console.error("Supabase dispensing_requests query error:", requestsResult.error.message);
    if (antibioticResult.error) console.error("Supabase antibiotic_forms query error:", antibioticResult.error.message);
    if (quotasResult.error) console.error("Supabase drug_quotas query error:", quotasResult.error.message);
    return {
      drug_stock_status: stockResult.data ?? [],
      stock_forecast_soonest_exhausted_first: forecastResult.data ?? [],
      dispensing_requests_last_30d: requestsResult.data ?? [],
      antibiotic_forms_last_30d: antibioticResult.data ?? [],
      drug_quotas_current_year: quotasResult.data ?? [],
    };
  }

  if (role === "pharmacist") {
    const [stockResult, forecastResult, requestsResult] = await Promise.all([
      supabase.from("drug_stock_status").select("drug_name, unit_pengukuran, current_stock, stok_min, stok_reorder, stok_max, status").eq("is_active", true).order("drug_name").limit(MAX_ROWS),
      supabase.from("drug_stock_forecast").select("drug_name, current_stock, avg_daily_keluaran, days_remaining, projected_exhaustion_date, forecast_status").eq("is_active", true).not("days_remaining", "is", null).order("days_remaining").limit(40),
      supabase.from("dispensing_requests").select("patient_name, status, created_at, drugs(drug_name)").gte("created_at", since).limit(MAX_ROWS),
    ]);
    if (stockResult.error) console.error("Supabase drug_stock_status query error:", stockResult.error.message);
    if (forecastResult.error) console.error("Supabase drug_stock_forecast query error:", forecastResult.error.message);
    if (requestsResult.error) console.error("Supabase dispensing_requests query error:", requestsResult.error.message);
    return {
      drug_stock_status: stockResult.data ?? [],
      stock_forecast_soonest_exhausted_first: forecastResult.data ?? [],
      dispensing_requests_last_30d: requestsResult.data ?? [],
    };
  }

  if (role === "mo") {
    const [myRequestsResult, quotasResult] = await Promise.all([
      supabase.from("dispensing_requests").select("patient_name, status, created_at, drugs(drug_name)").eq("submitted_by", userId).gte("created_at", since),
      supabase.from("drug_quotas").select("quota_limit, year, drugs(drug_name)").eq("year", currentYear),
    ]);
    if (myRequestsResult.error) console.error("Supabase dispensing_requests query error:", myRequestsResult.error.message);
    if (quotasResult.error) console.error("Supabase drug_quotas query error:", quotasResult.error.message);
    return {
      my_requests_last_30d: myRequestsResult.data ?? [],
      controlled_drug_quotas_current_year: quotasResult.data ?? [],
    };
  }

  return {};
}

function buildSystemPrompt(role: string, dataContext: object): string {
  const dataStr = JSON.stringify(dataContext);

  if (role === "mo") {
    return `You are a pharmacy query assistant for a Medical Officer (MO) at a Malaysian government clinic.
Answer ONLY from the pharmacy data provided below.

You can help with:
- Status of your dispensing requests (how many pending, approved, fulfilled, rejected)
- Which specific requests are still pending or have been rejected
- Controlled drug quotas: what the annual limit is and how many requests you have submitted
- Whether a specific drug has a quota limit

Do NOT give clinical advice or suggest antibiotics — use the Antibiotic Form's "Suggest Antibiotic (AI)" button for that.
If the answer is not in the data, say "I don't have that information."
Be concise and specific. Reference exact drug names, dates, and request counts from the data.

## Your Pharmacy Data:
${dataStr}`;
  }

  if (role === "pharmacist") {
    return `You are a pharmacy assistant for a Pharmacist at a Malaysian government clinic.
Answer ONLY from the pharmacy data provided below.

You can help with:
- Which dispensing requests are pending and need your action (list them specifically)
- How many requests are in each status (pending/approved/fulfilled/rejected)
- Drug inventory — current stock levels, units, and status (critical/low/normal/excess)
- Stock projections — average daily usage, days remaining, and projected exhaustion dates from the forecast data
- Recent request history for a specific patient or drug

If the answer is not in the data, say "I don't have that information."
Be specific — cite exact drug names, patient names, request counts, and dates from the data.

## Pharmacy Data:
${dataStr}`;
  }

  if (role === "admin" || role === "fms") {
    return `You are a pharmacy management assistant for an Admin/FMS user at a Malaysian government clinic.
Answer ONLY from the pharmacy data provided below.

You can help with:
- Drug inventory overview: current stock levels, units, and status (critical/low/normal/excess)
- Stock projections — average daily usage, days remaining, and projected exhaustion dates from the forecast data (e.g. which drugs run out soonest)
- Dispensing request counts and status breakdown for the last 30 days
- Antibiotic form submissions: how many are pending specialist approval, approved, or rejected
- Controlled drug quotas: limits vs request volume for the current year
- Identifying specific drugs or patients with multiple pending requests

If the answer is not in the data, say "I don't have that information."
Be specific — cite exact drug names, counts, dates, and patient names from the data.

## Pharmacy Data:
${dataStr}`;
  }

  return `You are a pharmacy management assistant. Answer ONLY from the data provided below.
Do not make up numbers or infer data not present. If the answer is not in the data, say "I don't have that information."
Be concise and specific. Use exact numbers and names from the data.

## Pharmacy Data:
${dataStr}`;
}
