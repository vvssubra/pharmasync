// supabase/functions/pathway-check/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  verifyJWT,
  getUserRole,
  checkRateLimit,
  sanitizeInput,
  corsHeaders,
  writeAuditLog,
} from "../_shared/security.ts";

const RATE_LIMIT = 10; // per user per hour
const FUNCTION_NAME = "pathway-check";

// In-memory cache for NAG document (survives across requests in same Deno isolate)
let nagDocumentCache: string | null = null;

const RequestSchema = z.object({
  diagnosis:      z.string().max(500).optional(),
  antibiotic:     z.string().max(200).optional(),
  indication:     z.string().max(1000).optional(),
  duration_days:  z.number().int().min(0).max(365).optional(),
  allergy_status: z.string().max(200).optional(),
  checklist:      z.record(z.unknown()).optional(),
  patient_age:    z.number().int().min(0).max(150).optional(),
});

const ALLOWED_ROLES = ["mo"];

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

  // ── 5. Load NAG document ──────────────────────────────────────────────────
  if (!nagDocumentCache) {
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data, error } = await supabase.storage
        .from("nag-documents")
        .download("nag-2024.txt");
      if (error || !data) throw new Error("Storage fetch failed");
      const text = await data.text();
      // Guard against oversized documents (> 500 KB)
      nagDocumentCache = text.slice(0, 500_000);
    } catch {
      await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 503, errorMessage: "nag_document_unavailable" });
      return new Response(
        JSON.stringify({ error: "NAG document unavailable. Please try again later." }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
  }

  // ── 6. Build form summary ─────────────────────────────────────────────────
  const formData = parsed.data;
  const formSummary = sanitizeInput(
    `Diagnosis: ${formData.diagnosis ?? "not specified"}
Antibiotic requested: ${formData.antibiotic ?? "not specified"}
Indication/symptoms: ${formData.indication ?? "not specified"}
Checklist findings: ${JSON.stringify(formData.checklist ?? {})}
Duration: ${formData.duration_days ?? "not specified"} days
Allergy status: ${formData.allergy_status ?? "not specified"}
Patient age: ${formData.patient_age ?? "not specified"} years`,
  );

  // ── 7. Claude API call with prompt caching ────────────────────────────────
  const anthropic = new Anthropic({
    apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
    defaultHeaders: {
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
  });

  let verdict: "supported" | "review" | "not_supported" | "refer_specialist" = "refer_specialist";
  let explanation = "";
  let tokensUsed = 0;

  const systemPrompt = `You are a strict clinical pathway checker for a Malaysian government clinic.
Your ONLY job is to assess whether an antibiotic prescription matches the NAG (National Antibiotic Guidelines) pathway.

RULES:
1. Answer ONLY based on the NAG document provided.
2. Never suggest antibiotics outside the guidelines.
3. If the case is complex or outside all pathways, return verdict: "refer_specialist".
4. Do NOT make up or infer information not present.

Respond with ONLY valid JSON in this exact format:
{
  "verdict": "supported" | "review" | "not_supported" | "refer_specialist",
  "explanation": "one sentence citing the specific NAG pathway section"
}

Verdict meanings:
- supported: checklist fully matches a NAG pathway
- review: partial match — cite the specific weak criterion
- not_supported: does not meet any NAG pathway for antibiotic use
- refer_specialist: case complexity exceeds pathway scope`;

  try {
    const response = await (anthropic.messages.create as (params: unknown) => Promise<{
      usage: { input_tokens: number; output_tokens: number };
      content: Array<{ type: string; text?: string }>;
    }>)({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: [
        {
          type: "text",
          text: `## NAG Guidelines Document:\n${nagDocumentCache}`,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: systemPrompt,
        },
      ],
      messages: [
        {
          role: "user",
          content: `Please assess this antibiotic request:\n\n${formSummary}`,
        },
      ],
    });

    tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
    const rawText = response.content[0].type === "text" ? (response.content[0].text ?? "") : "{}";

    // Parse Claude's JSON response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const claudeResult = JSON.parse(jsonMatch[0]) as { verdict?: string; explanation?: string };
      if (["supported", "review", "not_supported", "refer_specialist"].includes(claudeResult.verdict ?? "")) {
        verdict = claudeResult.verdict as typeof verdict;
        explanation = String(claudeResult.explanation ?? "").slice(0, 500);
      }
    }
  } catch {
    await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 500, errorMessage: "claude_api_error" });
    return new Response(
      JSON.stringify({ error: "AI service temporarily unavailable" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 8. Audit log ──────────────────────────────────────────────────────────
  await writeAuditLog({ userId: userId!, role, functionName: FUNCTION_NAME, statusCode: 200, tokensUsed });

  return new Response(
    JSON.stringify({ verdict, explanation }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
