// supabase/functions/_shared/security.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";

// Lazy-initialized singleton client — constructed once per Deno isolate on first use
let _adminClient: ReturnType<typeof createClient> | null = null;

/**
 * A client scoped to the caller's own JWT (anon key + their Authorization
 * header), so RLS and user_clinic_id() apply exactly as they would for that
 * user's own requests through PostgREST. Use this for any data read —
 * reserve _supabaseAdmin() for writes that must bypass RLS (audit logs,
 * rate limiting). A plain anon-key client with no per-request Authorization
 * header is NOT a substitute: it runs as the `anon` role, not the caller,
 * and RLS-scoped reads return nothing.
 */
export function callerScopedClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

function _supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return _adminClient;
}

// ── JWT verification ────────────────────────────────────────────────────────
export async function verifyJWT(authHeader: string | null): Promise<{
  userId: string;
  error?: never;
} | {
  userId?: never;
  error: string;
}> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header" };
  }

  try {
    // Use Supabase's own getUser() — reliable JWT validation without manual base64 decoding
    const client = callerScopedClient(authHeader);
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return { error: "Invalid or expired token" };
    return { userId: user.id };
  } catch {
    return { error: "Invalid token" };
  }
}

// ── Role check ──────────────────────────────────────────────────────────────
export async function getUserRole(userId: string): Promise<string | null> {
  const supabase = _supabaseAdmin();
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role ?? null;
}

// ── Rate limiting (Postgres fixed window, via ai_rate_limit_hit RPC) ───────
// Lives in the same database the function already needs for getUserRole and
// writeAuditLog, so unlike the old Upstash-backed limiter this FAILS CLOSED:
// if Postgres is unreachable the request can't succeed anyway.
export async function checkRateLimit(
  userId: string,
  functionName: string,
  limitPerHour: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const supabase = _supabaseAdmin();
  const { data, error } = await supabase
    .rpc("ai_rate_limit_hit", {
      p_user_id: userId,
      p_function: functionName,
      p_limit: limitPerHour,
      p_window_seconds: 3600,
    })
    .single();

  if (error || !data) {
    throw new Error(`Rate limit check failed: ${error?.message ?? "no data returned"}`);
  }

  const row = data as { allowed: boolean; retry_after_seconds: number };
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}

// ── Prompt injection sanitization ──────────────────────────────────────────
const INJECTION_PATTERNS = [
  /ignore (all |the )?(previous|prior|above) instructions?/gi,
  /you are now/gi,
  /pretend (you are|to be)/gi,
  /^system:/gim,
  /^assistant:/gim,
  /\n{5,}/g, // excess newline padding
];

export function sanitizeInput(text: string): string {
  let sanitized = text;
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[removed]");
  }
  return sanitized.trim().slice(0, 500); // enforce max length server-side
}

// ── CORS headers ────────────────────────────────────────────────────────────
export function corsHeaders(origin: string | null): HeadersInit {
  const appOrigin = Deno.env.get("APP_ORIGIN") ?? "";
  const allowedOrigins = [appOrigin, "http://localhost:8080", "http://localhost:5173"];
  const allowed =
    origin && allowedOrigins.includes(origin) ? origin : (appOrigin || "null");
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ── Audit log writer ────────────────────────────────────────────────────────
export async function writeAuditLog(entry: {
  userId: string;
  role: string;
  functionName: string;
  statusCode: number;
  tokensUsed?: number;
  durationMs?: number;
  errorMessage?: string;
}): Promise<void> {
  const supabase = _supabaseAdmin();
  const { error } = await supabase.from("ai_audit_logs").insert({
    user_id:       entry.userId,
    role:          entry.role,
    function_name: entry.functionName,
    status_code:   entry.statusCode,
    tokens_used:   entry.tokensUsed ?? null,
    duration_ms:   entry.durationMs ?? null,
    error_message: entry.errorMessage ?? null,
  });
  if (error) throw new Error(`Audit log write failed: ${error.message}`);
}
