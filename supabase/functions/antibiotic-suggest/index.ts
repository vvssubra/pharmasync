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
import { lookupNagRegimen, nagAiEnabled } from "./nagAiClient.ts";
import { derivePathwayIndication, type ChecklistState } from "../_shared/doseQuery.ts";
import { patientGroupFromAge } from "../_shared/nagPathways.ts";

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
const ALLOWED_ROLES = ["mo", "fms", "admin", "pharmacist", "super_admin"];

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
    return new Response(JSON.stringify({ error: "Unauthorized: your role is not permitted to use antibiotic suggestions" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
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
  // prescribing shorthand — no LLM is involved when a pathway matches.
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
  let result: Record<string, unknown> = {
    regimens: resolved.regimens,
    rationale: resolved.rationale,
    warning: resolved.warning,
    source,
  };
  let tokensUsed: number | undefined;
  let aiError: string | undefined;

  // ── 6. AI guideline lookup (only when the rules have no pathway) ─────────
  // The deterministic pathways stay authoritative where they exist (they do
  // real weight-based math). For everything else, Claude locates the NAG
  // section and copies its dose lines; verifyAiAnswer() drops any line that
  // is not verbatim in the cited section, so the doctor only ever sees
  // guideline text.
  if (source === "refer" && nagAiEnabled()) {
    const group = patientGroupFromAge(patient_age);
    if (group === "Any") {
      result = { ...result, rationale: "Enter the patient's age to look this case up in the full NAG 2024 guideline — adult and paediatric dosing differ." };
    } else {
      let checklistIndication: string | null = null;
      try {
        checklistIndication = checklist ? derivePathwayIndication(checklist as unknown as ChecklistState) : null;
      } catch { checklistIndication = null; }
      try {
        const outcome = await lookupNagRegimen({
          diagnosis: sanitizeInput(diagnosis),
          checklistIndication,
          checklist,
          patientAge: patient_age!,
          patientGroup: group,
          weightKg: patient_weight_kg,
          allergyStatus: allergy_status ? sanitizeInput(allergy_status) : undefined,
        });
        tokensUsed = outcome.tokensUsed;
        const a = outcome.answer;
        result = a.regimens.length > 0
          ? { regimens: a.regimens, rationale: a.rationale, warning: a.warning, source: "nag_ai" }
          : { ...result, rationale: a.rationale };
      } catch (err) {
        // Never fail the click: fall back to the deterministic refer answer.
        aiError = err instanceof Error ? err.message : String(err);
        result = { ...result, warning: "The AI guideline lookup is unavailable right now — prescribe from the NAG guideline directly." };
      }
    }
  }

  // ── 7. Audit log ──────────────────────────────────────────────────────────
  try {
    await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200, tokensUsed, durationMs: Date.now() - startedAt, errorMessage: aiError });
  } catch { /* non-fatal */ }

  return new Response(JSON.stringify(result), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
});
