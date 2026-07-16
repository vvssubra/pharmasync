// supabase/functions/antibiotic-suggest/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { hermesChat } from "../_shared/hermes.ts";
import { splitNagSections, selectNagSections } from "../_shared/nagRetrieval.ts";
import { fetchDoseMatches, doseMatchesBlock } from "../_shared/knowledge.ts";
import { loadGuidelineDocs } from "../_shared/guidelineDocs.ts";
import {
  verifyJWT,
  getUserRole,
  checkRateLimit,
  sanitizeInput,
  corsHeaders,
  writeAuditLog,
} from "../_shared/security.ts";

const RequestSchema = z.object({
  diagnosis:         z.string().min(1).max(500),
  checklist:         z.record(z.unknown()).optional(),
  patient_age:       z.number().int().min(0).max(150).optional(),
  allergy_status:    z.string().max(200).optional(),
  patient_weight_kg: z.number().positive().max(300).optional(),
});

const RATE_LIMIT    = 10; // per user per hour
const FUNCTION_NAME = "antibiotic-suggest";
const ALLOWED_ROLES = ["mo"];

// In-memory NAG cache (1-hour TTL)
let nagDocCache: { text: string; fetchedAt: number } | null = null;
const NAG_CACHE_TTL_MS = 60 * 60 * 1000;

async function loadNagDocument(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const now = Date.now();
  if (nagDocCache && (now - nagDocCache.fetchedAt) < NAG_CACHE_TTL_MS) return nagDocCache.text;
  try {
    const { data, error } = await supabase.storage.from("nag-documents").download("nag-2024.txt");
    if (error || !data) return nagDocCache?.text ?? null;
    const text = await data.text();
    nagDocCache = { text: text.slice(0, 500_000), fetchedAt: now };
    return nagDocCache.text;
  } catch {
    return nagDocCache?.text ?? null;
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors   = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors, status: 204 });

  // ── 1. JWT ────────────────────────────────────────────────────────────────
  const { userId, error: jwtError } = await verifyJWT(req.headers.get("authorization"));
  if (jwtError) {
    return new Response(JSON.stringify({ error: jwtError }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── 2. Role check ─────────────────────────────────────────────────────────
  const role = await getUserRole(userId!);
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return new Response(JSON.stringify({ error: "Unauthorized: only MO role can use antibiotic suggestions" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── 3. Rate limit ─────────────────────────────────────────────────────────
  const { allowed, retryAfterSeconds } = await checkRateLimit(userId!, FUNCTION_NAME, RATE_LIMIT);
  if (!allowed) {
    try { await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 429, errorMessage: "rate_limit_exceeded" }); } catch { /* non-fatal */ }
    return new Response(JSON.stringify({ error: "Rate limit exceeded", retry_after_seconds: retryAfterSeconds }), { status: 429, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── 4. Input validation ───────────────────────────────────────────────────
  let body: unknown;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid input", details: parsed.error.issues }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const { diagnosis, checklist, patient_age, allergy_status, patient_weight_kg } = parsed.data;

  // ── 5. Load NAG ───────────────────────────────────────────────────────────
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const nagText  = await loadNagDocument(supabase);
  if (!nagText) {
    try { await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 503, errorMessage: "nag_document_unavailable" }); } catch { /* non-fatal */ }
    return new Response(JSON.stringify({ error: "NAG document unavailable. Please try again later." }), { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── 6. Build request summary ──────────────────────────────────────────────
  const cleanDiagnosis = sanitizeInput(diagnosis);
  const cleanAllergy   = allergy_status ? sanitizeInput(allergy_status) : "None / NKDA";
  // Checklist serialised separately (may exceed 500 chars — sanitizeInput is for user-typed fields)
  const checklistStr   = JSON.stringify(checklist ?? {}).slice(0, 1000);

  const requestSummary = [
    `Diagnosis: ${cleanDiagnosis}`,
    `Patient age: ${patient_age ?? "not specified"} years`,
    patient_weight_kg != null ? `Patient weight: ${patient_weight_kg} kg` : null,
    `Drug allergy: ${cleanAllergy}`,
    `Clinical checklist findings: ${checklistStr}`,
  ].filter(Boolean).join("\n");

  // ── 7. Ground the prompt: relevant NAG sections + verbatim vault notes ────
  // The full corpus (NAG + cached web guidelines) can be far beyond the local
  // model's context, so only the sections matching this request are included.
  const guidelineDocs = await loadGuidelineDocs(supabase);
  const corpus = guidelineDocs ? `${nagText}\n\n${guidelineDocs}` : nagText;
  const nagExcerpt = selectNagSections(splitNagSections(corpus), [cleanDiagnosis]);

  const patientGroup = patient_age == null
    ? "Any" as const
    : patient_age < 12 ? "Paediatric" as const : "Adult" as const;
  const doseMatches = await fetchDoseMatches(cleanDiagnosis, patientGroup);

  // ── 8. Local LLM call (Hermes via Ollama) ─────────────────────────────────
  const systemPrompt = `You are a clinical pharmacist assistant for a Malaysian government clinic (Klinik Kesihatan).
Your job is to recommend a specific first-line antibiotic regimen strictly based on the NAG (National Antibiotic Guidelines) provided.

RULES:
1. Recommend ONLY antibiotics listed in the NAG for the matching condition.
2. Include exact drug name, dose, frequency, and duration as stated in NAG.
3. If the patient has a drug allergy, suggest the NAG-listed alternative and describe the allergy concern in the warning field.
4. For paediatric patients (age < 12), use weight-based dosing from NAG when weight is provided.
5. If the diagnosis does not clearly match any NAG pathway, set suggestion to "Refer to specialist — no matching NAG pathway found" and explain in rationale.
6. Never invent antibiotics, doses, or durations not present in the NAG.

Respond ONLY with valid JSON — no prose before or after:
{
  "suggestion": "e.g. Amoxicillin 500mg TDS x 5 days",
  "rationale": "1-2 sentences citing the specific NAG condition or pathway section",
  "warning": "allergy note or special consideration, or null if none"
}`;

  let tokensUsed = 0;
  let result = {
    suggestion: "Unable to generate suggestion. Please consult NAG guidelines directly.",
    rationale:  "",
    warning:    null as string | null,
  };

  try {
    const response = await hermesChat({
      system: [
        `## NAG (National Antibiotic Guidelines 2024) — relevant sections:\n${nagExcerpt}`,
        doseMatchesBlock(doseMatches),
        systemPrompt,
      ].filter(Boolean).join("\n\n"),
      user: `Suggest an antibiotic for this patient:\n\n${requestSummary}`,
      json: true,
      maxTokens: 512,
    });

    tokensUsed      = response.tokensUsed;
    const rawText   = response.text || "{}";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const llmResult = JSON.parse(jsonMatch[0]) as { suggestion?: string; rationale?: string; warning?: string | null };
      result = {
        suggestion: String(llmResult.suggestion ?? "").slice(0, 300),
        rationale:  String(llmResult.rationale  ?? "").slice(0, 500),
        warning:    llmResult.warning ? String(llmResult.warning).slice(0, 300) : null,
      };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    try { await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 500, errorMessage: `llm_error: ${errMsg.slice(0, 200)}` }); } catch { /* non-fatal */ }
    return new Response(JSON.stringify({ error: "AI service temporarily unavailable" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── 8. Audit log ──────────────────────────────────────────────────────────
  try { await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200, tokensUsed }); } catch { /* non-fatal */ }

  return new Response(JSON.stringify(result), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
});
