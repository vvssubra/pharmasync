// supabase/functions/ai-query/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.52.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
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

  const { data: callerProfile, error: profileError } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("user_id", userId!)
    .maybeSingle();
  if (profileError || !callerProfile?.clinic_id) {
    return new Response(JSON.stringify({ error: "Unauthorized: no clinic assigned" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const clinicId = callerProfile.clinic_id as string;

  const dataContext = await fetchDataContext(supabase, userId!, role, clinicId);

  // ── 7. Build system prompt ────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(role, dataContext);

  // ── 8. Claude API call ────────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

  let tokensUsed = 0;
  let answer = "";

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: question }],
    });
    tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
    answer = response.content[0].type === "text" ? response.content[0].text : "";
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("Claude API error:", errMsg);
    try {
      await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 500, errorMessage: `claude_api_error: ${errMsg.slice(0, 200)}` });
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
async function fetchDataContext(supabase: ReturnType<typeof createClient>, userId: string, role: string, clinicId: string): Promise<object> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since = thirtyDaysAgo.toISOString();
  const currentYear = new Date().getFullYear();

  // drugs is a shared formulary (no clinic_id) — reads stay unscoped by design.
  // Every other table here is clinic-scoped data; this function uses the
  // service-role client (RLS bypassed), so clinicId must be applied explicitly
  // on each query or one clinic's staff can read another clinic's patients.

  if (role === "admin" || role === "fms") {
    const [drugsResult, requestsResult, antibioticResult, quotasResult] = await Promise.all([
      supabase.from("drugs").select("drug_name, unit_pengukuran, perlu_kelulusan_pakar, is_active").eq("is_active", true).order("drug_name"),
      supabase.from("dispensing_requests").select("patient_name, status, created_at, drugs(drug_name)").eq("clinic_id", clinicId).gte("created_at", since).order("created_at", { ascending: false }),
      supabase.from("antibiotic_forms").select("patient_name, status, diagnosis, created_at").eq("clinic_id", clinicId).gte("created_at", since).order("created_at", { ascending: false }),
      supabase.from("drug_quotas").select("quota_limit, year, drugs(drug_name)").eq("clinic_id", clinicId).eq("year", currentYear),
    ]);
    if (drugsResult.error) console.error("Supabase drugs query error:", drugsResult.error.message);
    if (requestsResult.error) console.error("Supabase dispensing_requests query error:", requestsResult.error.message);
    if (antibioticResult.error) console.error("Supabase antibiotic_forms query error:", antibioticResult.error.message);
    if (quotasResult.error) console.error("Supabase drug_quotas query error:", quotasResult.error.message);
    return {
      drugs: drugsResult.data ?? [],
      dispensing_requests_last_30d: requestsResult.data ?? [],
      antibiotic_forms_last_30d: antibioticResult.data ?? [],
      drug_quotas_current_year: quotasResult.data ?? [],
    };
  }

  if (role === "pharmacist") {
    const [drugsResult, requestsResult] = await Promise.all([
      supabase.from("drugs").select("drug_name, unit_pengukuran, is_active").eq("is_active", true).order("drug_name"),
      supabase.from("dispensing_requests").select("patient_name, status, created_at, drugs(drug_name)").eq("clinic_id", clinicId).gte("created_at", since),
    ]);
    if (drugsResult.error) console.error("Supabase drugs query error:", drugsResult.error.message);
    if (requestsResult.error) console.error("Supabase dispensing_requests query error:", requestsResult.error.message);
    return {
      drugs: drugsResult.data ?? [],
      dispensing_requests_last_30d: requestsResult.data ?? [],
    };
  }

  if (role === "mo") {
    const [myRequestsResult, quotasResult] = await Promise.all([
      supabase.from("dispensing_requests").select("patient_name, status, created_at, drugs(drug_name)").eq("submitted_by", userId).gte("created_at", since),
      supabase.from("drug_quotas").select("quota_limit, year, drugs(drug_name)").eq("clinic_id", clinicId).eq("year", currentYear),
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
- Drug inventory — which specific drugs are available and their units
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
- Drug inventory overview: which drugs are active, units, specialist-approval flags
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
