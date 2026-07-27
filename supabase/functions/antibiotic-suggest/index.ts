// supabase/functions/antibiotic-suggest/index.ts
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  verifyJWT,
  getUserRole,
  checkRateLimit,
  sanitizeInput,
  corsHeaders,
  writeAuditLog,
} from "../_shared/security.ts";
import { generateJson, LlmTimeoutError } from "../_shared/llm.ts";
import { resolveCase, violatesDrugAllowlist } from "./resolve.ts";

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

const SuggestionSchema = z.object({
  suggestion: z.string().min(1).max(300),
  rationale:  z.string().max(500),
  warning:    z.string().max(300).nullable(),
});

const SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    suggestion: { type: "string" },
    rationale: { type: "string" },
    warning: { type: ["string", "null"] },
  },
  required: ["suggestion", "rationale", "warning"],
};

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
  let allowed: boolean, retryAfterSeconds: number;
  try {
    ({ allowed, retryAfterSeconds } = await checkRateLimit(userId!, FUNCTION_NAME, RATE_LIMIT));
  } catch {
    // Fail closed — the limiter lives in the same Postgres this function
    // already needs, so if it's unreachable nothing else here would work.
    return new Response(JSON.stringify({ error: "Service temporarily unavailable" }), { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
  }
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
  const startedAt = Date.now();

  // ── 5. Resolve the regimen deterministically ────────────────────────────
  const resolved = resolveCase({
    diagnosis: sanitizeInput(diagnosis),
    checklist,
    patient_age,
    allergy_status: allergy_status ? sanitizeInput(allergy_status) : undefined,
    patient_weight_kg,
  });

  // No pathway match, or a fully-determined case (no allergy, no weight
  // math needed) — return the verbatim NAG text, no LLM call at all.
  if (!resolved.needsLlmPhrasing || !resolved.pathway) {
    const result = { suggestion: resolved.regimenText, rationale: resolved.rationale, warning: resolved.warning, source: "rules" as const };
    try {
      await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200, durationMs: Date.now() - startedAt });
    } catch { /* non-fatal */ }
    return new Response(JSON.stringify(result), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── 6. LLM phrasing for the two genuinely variable cases ───────────────
  // (allergy branch selection, paediatric weight-based dosing) — the drug,
  // dose, and duration are already decided; the model only phrases them.
  const pathway = resolved.pathway;
  const systemPrompt = `You are a clinical pharmacist assistant phrasing an already-decided NAG 2024 antibiotic regimen for a Malaysian government clinic. The regimen, rationale, and warning below are FINAL — do not change the drug, dose, or duration, and never suggest a drug other than: ${pathway.allowedDrugs.join(", ")}.

Respond ONLY with JSON in this exact shape:
{"suggestion": "<the regimen, phrased naturally>", "rationale": "<1-2 sentences>", "warning": "<caution note, or null>"}

Decided regimen: ${resolved.regimenText}
Decided rationale: ${resolved.rationale}
Decided warning: ${resolved.warning ?? "none"}`;

  let source: "rules" | "llm" = "rules";
  let result = { suggestion: resolved.regimenText, rationale: resolved.rationale, warning: resolved.warning };
  let tokensUsed = 0;

  try {
    const generated = await generateJson(SuggestionSchema, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Phrase this NAG 2024 suggestion for: ${diagnosis}` },
      ],
      jsonSchema: SUGGESTION_JSON_SCHEMA,
      numPredict: 300,
      temperature: 0,
      fallback: result,
    });
    tokensUsed = generated.usage.totalTokens;

    if (generated.source === "llm" && !violatesDrugAllowlist(generated.data.suggestion, pathway.allowedDrugs)) {
      result = generated.data;
      source = "llm";
    } else if (generated.source === "llm") {
      // Model strayed off the allowed drug list — discard and keep the
      // verbatim decided regimen.
      try {
        await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200, errorMessage: "drug_allowlist_violation" });
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    if (err instanceof LlmTimeoutError) {
      // Fall back to the verbatim decided regimen rather than surfacing a
      // timeout — the answer is already known to be correct.
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("LLM error:", errMsg);
    }
  }

  // ── 7. Audit log ──────────────────────────────────────────────────────────
  try {
    await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200, tokensUsed, durationMs: Date.now() - startedAt });
  } catch { /* non-fatal */ }

  return new Response(JSON.stringify({ ...result, source }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
});
