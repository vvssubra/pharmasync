// supabase/functions/pathway-check/index.ts
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  verifyJWT,
  getUserRole,
  checkRateLimit,
  corsHeaders,
  writeAuditLog,
} from "../_shared/security.ts";
import { checkPathway } from "./verdict.ts";

// Rule-based, not an LLM call — no meaningful marginal cost per request, so
// the limit only needs to guard against abuse, not latency/capacity.
const RATE_LIMIT = 120; // per user per hour
const FUNCTION_NAME = "pathway-check";

const RequestSchema = z.object({
  diagnosis:      z.string().max(500).optional(),
  antibiotic:     z.string().max(200).optional(),
  indication:     z.string().max(1000).optional(),
  duration_days:  z.number().int().min(0).max(365).optional(),
  allergy_status: z.string().max(200).optional(),
  checklist:      z.record(z.unknown()).optional(),
  patient_age:    z.number().int().min(0).max(150).optional(),
});

// Kept in step with antibiotic-suggest and the /request route — the pathway
// banner renders on the same form, so a narrower list here would leave
// admin/pharmacist/super_admin looking at a permanently "unavailable" banner.
const ALLOWED_ROLES = ["mo", "admin", "pharmacist", "super_admin"];

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }

  // ── 1. JWT verification ──────────────────────────────────────────────────
  const { userId, error: jwtError } = await verifyJWT(req.headers.get("authorization"));
  if (jwtError) {
    return new Response(
      JSON.stringify({ error: jwtError }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 2. Role check — only 'mo' role can use pathway-check ─────────────────
  const role = await getUserRole(userId!);
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized: only MO role can use pathway check" }),
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
    );
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
    await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 429, errorMessage: "rate_limit_exceeded" });
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
    return new Response(
      JSON.stringify({ error: "Invalid JSON" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid input", details: parsed.error.issues }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 5. Deterministic NAG pathway check ────────────────────────────────────
  // Rule-based against NAG_PATHWAYS/derivePathwayIndication — no model call,
  // no Storage load, and the NAG table never ships in the JS bundle since
  // this runs server-side.
  const { verdict, explanation } = checkPathway(parsed.data);

  // ── 6. Audit log ───────────────────────────────────────────────────────────
  await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200 });

  return new Response(
    JSON.stringify({ verdict, explanation }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
