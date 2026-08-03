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
import { resolveCase } from "./resolve.ts";

const RequestSchema = z.object({
  diagnosis:         z.string().min(1).max(500),
  checklist:         z.record(z.unknown()).optional(),
  patient_age:       z.number().int().min(0).max(150).optional(),
  allergy_status:    z.string().max(200).optional(),
  patient_weight_kg: z.number().positive().max(300).optional(),
});

const RATE_LIMIT    = 10; // per user per hour
const FUNCTION_NAME = "antibiotic-suggest";
// Must stay in step with the /request route in src/components/ProtectedRoute.tsx
// and with AI_SUGGEST_ROLES in src/pages/AntibioticForm.tsx. Previously "mo"
// only, while the route and the Suggest button were open to admin/pharmacist/
// super_admin — so those roles saw the button and got a silent 403 on click.
const ALLOWED_ROLES = ["mo", "admin", "pharmacist", "super_admin"];

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
  // computeAbxDose() already renders the regimen in the clinic's own
  // prescribing shorthand — there is no LLM call in this function.
  const resolved = resolveCase({
    diagnosis: sanitizeInput(diagnosis),
    checklist,
    patient_age,
    allergy_status: allergy_status ? sanitizeInput(allergy_status) : undefined,
    patient_weight_kg,
  });

  // A null pathway means we are declining (no match, or a patient-group
  // mismatch), not matching. Labelling that "NAG 2024 pathway match" in the
  // UI contradicts the very text being shown, so it gets its own source.
  const source = resolved.pathway ? ("rules" as const) : ("refer" as const);
  const result = {
    suggestion: resolved.regimenText,
    rationale: resolved.rationale,
    warning: resolved.warning,
    alternative: resolved.alternative ?? null,
    source,
  };

  // ── 6. Audit log ──────────────────────────────────────────────────────────
  try {
    await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200, durationMs: Date.now() - startedAt });
  } catch { /* non-fatal */ }

  return new Response(JSON.stringify(result), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
});
