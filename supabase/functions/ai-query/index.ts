// supabase/functions/ai-query/index.ts
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  verifyJWT,
  getUserRole,
  checkRateLimit,
  sanitizeInput,
  corsHeaders,
  writeAuditLog,
  callerScopedClient,
} from "../_shared/security.ts";
import { generate, generateStream, llmHealth, LlmTimeoutError } from "../_shared/llm.ts";
import {
  retrieveFaq,
  classifyIntent,
  buildDataFacts,
  buildSystemPrompt,
  verifyNumericClaims,
} from "./context.ts";

const RequestSchema = z.object({
  question: z.string().min(1).max(500),
  stream: z.boolean().optional(),
});

const RATE_LIMIT = 20; // per user per hour
const FUNCTION_NAME = "ai-query";
const NUM_PREDICT = 200;

type AnswerSource = "faq" | "llm" | "facts" | "none";

function jsonResponse(body: unknown, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }

  const authHeader = req.headers.get("authorization");

  // ── 1. JWT verification ──────────────────────────────────────────────────
  const { userId, error: jwtError } = await verifyJWT(authHeader);
  if (jwtError) {
    return jsonResponse({ error: jwtError }, 401, cors);
  }

  // ── 2. Role check ─────────────────────────────────────────────────────────
  const role = await getUserRole(userId!);
  if (!role) {
    return jsonResponse({ error: "Unauthorized: no role assigned" }, 403, cors);
  }

  // GET /ai-query — Ollama health check, admin/super_admin only. Authoritative
  // proof the edge runtime can reach Ollama; a bare `curl` to Ollama can't
  // confirm the container-to-container network path actually works.
  if (req.method === "GET") {
    if (role !== "admin" && role !== "super_admin") {
      return jsonResponse({ error: "Unauthorized" }, 403, cors);
    }
    const health = await llmHealth();
    return jsonResponse(health, 200, cors);
  }

  // super_admin is included here (FAQ-only, no clinic to scope data to —
  // handled after intent routing below) alongside the four clinic roles.
  const ALLOWED_ROLES = ["admin", "fms", "mo", "pharmacist", "super_admin"] as const;
  if (!ALLOWED_ROLES.includes(role as typeof ALLOWED_ROLES[number])) {
    return jsonResponse({ error: "Unauthorized: role not permitted to use AI assistant" }, 403, cors);
  }

  // ── 3. Rate limit ─────────────────────────────────────────────────────────
  let allowed: boolean, retryAfterSeconds: number;
  try {
    ({ allowed, retryAfterSeconds } = await checkRateLimit(userId!, FUNCTION_NAME, RATE_LIMIT));
  } catch {
    // Fail closed — the limiter lives in the same Postgres this function
    // already needs, so if it's unreachable nothing else here would work.
    return jsonResponse({ error: "Service temporarily unavailable" }, 503, cors);
  }
  if (!allowed) {
    try {
      await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 429, errorMessage: "rate_limit_exceeded" });
    } catch {
      // Audit log failure must not abort the primary response
    }
    return jsonResponse({ error: "Rate limit exceeded", retry_after_seconds: retryAfterSeconds }, 429, cors);
  }

  // ── 4. Input validation ───────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, cors);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: "Invalid input", details: parsed.error.issues }, 400, cors);
  }

  // ── 5. Sanitize input ─────────────────────────────────────────────────────
  const question = sanitizeInput(parsed.data.question);
  const startedAt = Date.now();

  // Caller-scoped client — RLS and user_clinic_id() do clinic scoping for
  // every read below, so there's no manual .eq("clinic_id", ...) to get
  // wrong, and no service-role client that would make get_drug_quota_usage()
  // silently see auth.uid() as NULL.
  const supabase = callerScopedClient(authHeader!);

  const { data: profile } = await supabase
    .from("profiles")
    .select("clinic_id, clinics(name)")
    .eq("user_id", userId!)
    .maybeSingle();
  const clinicName = (profile as { clinics?: { name?: string } | null } | null)?.clinics?.name ?? "your clinic";
  const hasClinic = !!(profile as { clinic_id?: string | null } | null)?.clinic_id;

  if (!hasClinic && role !== "super_admin") {
    return jsonResponse({ error: "Unauthorized: no clinic assigned" }, 403, cors);
  }

  const respond = async (answer: string, source: AnswerSource, tokensUsed = 0) => {
    const durationMs = Date.now() - startedAt;
    try {
      await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200, tokensUsed, durationMs });
    } catch {
      // Audit log failure must not abort the primary response
    }
    return jsonResponse({ answer, source, elapsed_ms: durationMs }, 200, cors);
  };

  // ── 6. FAQ first — rules before LLM ───────────────────────────────────────
  const faq = retrieveFaq(question, role);

  if (faq.tier === "faq") {
    return respond(faq.top[0].answer, "faq");
  }

  let factsText: string;
  if (faq.tier === "llm") {
    factsText = faq.top.map((entry, i) => `FAQ_${i + 1}: ${entry.answer}`).join("\n");

    // Streaming only ever applies to this FAQ-rephrase path: the numeric
    // guard rail (step 8 below) needs the complete text before it can be
    // trusted, so it can't run against a token-by-token stream. FAQ answers
    // rarely carry figures worth guarding, unlike quota/stock/request
    // FACTS — those always go through the non-streaming path with the
    // guard rail intact, regardless of what the client requests.
    if (parsed.data.stream === true) {
      const streamSystemPrompt = buildSystemPrompt(role, factsText);
      try {
        const stream = await generateStream({
          messages: [
            { role: "system", content: streamSystemPrompt },
            { role: "user", content: question },
          ],
          numPredict: NUM_PREDICT,
        });
        try {
          await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200, durationMs: Date.now() - startedAt });
        } catch {
          // Audit log failure must not abort the primary response
        }
        return new Response(stream, {
          status: 200,
          headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
        });
      } catch (err) {
        if (err instanceof LlmTimeoutError) {
          try {
            await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 504, errorMessage: "llm_timeout" });
          } catch { /* non-fatal */ }
          return jsonResponse({ error: "AI assistant took too long to respond. Please try again." }, 504, cors);
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("LLM stream error:", errMsg);
        try {
          await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 500, errorMessage: `llm_stream_error: ${errMsg.slice(0, 200)}` });
        } catch { /* non-fatal */ }
        return jsonResponse({ error: "AI service temporarily unavailable" }, 500, cors);
      }
    }
  } else {
    // No FAQ match — route by data intent.
    const intent = classifyIntent(question);
    if (intent === "unknown") {
      return respond("I don't have that information.", "none");
    }
    if (role === "super_admin") {
      return respond(
        "super_admin isn't scoped to a single clinic, so I can't compute clinic-specific quota/stock/request figures. Open a clinic-scoped view to check that data.",
        "none",
      );
    }
    const data = await buildDataFacts(supabase, role, userId!, question, clinicName);
    if (!data.hasFacts) {
      return respond("I don't have that information.", "none");
    }
    factsText = data.factsText;
  }

  // ── 7. Ollama call ─────────────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(role, factsText);

  let text: string;
  let tokensUsed = 0;
  try {
    const result = await generate({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      numPredict: NUM_PREDICT,
    });
    text = result.text.trim();
    tokensUsed = result.usage.totalTokens;
  } catch (err) {
    if (err instanceof LlmTimeoutError) {
      try {
        await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 504, errorMessage: "llm_timeout" });
      } catch { /* non-fatal */ }
      return jsonResponse({ error: "AI assistant took too long to respond. Please try again." }, 504, cors);
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("LLM error:", errMsg);
    try {
      await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 500, errorMessage: `llm_error: ${errMsg.slice(0, 200)}` });
    } catch { /* non-fatal */ }
    return jsonResponse({ error: "AI service temporarily unavailable" }, 500, cors);
  }

  // ── 8. Numeric guard rail ──────────────────────────────────────────────────
  // Never surface a hallucinated number as a clinical/operational answer —
  // fall back to the FACTS block itself, which is always correct.
  if (!verifyNumericClaims(text, factsText)) {
    return respond(`Here are the figures from your clinic's records:\n\n${factsText}`, "facts", tokensUsed);
  }

  return respond(text, "llm", tokensUsed);
});
