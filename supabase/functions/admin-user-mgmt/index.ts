// supabase/functions/admin-user-mgmt/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  verifyJWT,
  getUserRole,
  corsHeaders,
} from "../_shared/security.ts";

const ALLOWED_ROLES = ["admin", "fms", "mo", "pharmacist"] as const;

const CreateUserSchema = z.object({
  action: z.literal("create_user"),
  full_name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(6).max(72),
  role: z.enum(ALLOWED_ROLES),
  // Only required (and honoured) when the caller is super_admin — a plain
  // clinic-scoped admin can only create users for their own clinic, which
  // the server resolves itself (see step 4 below).
  clinic_id: z.string().uuid().optional(),
});

const ResetPasswordSchema = z.object({
  action: z.literal("reset_password"),
  user_id: z.string().uuid(),
  password: z.string().min(6).max(72),
});

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 1. JWT verification ────────────────────────────────────────────────────
  const { userId, error: jwtError } = await verifyJWT(req.headers.get("authorization"));
  if (jwtError) {
    return new Response(
      JSON.stringify({ error: jwtError }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 2. Role check: admin or super_admin only ──────────────────────────────
  const callerRole = await getUserRole(userId!);
  if (callerRole !== "admin" && callerRole !== "super_admin") {
    return new Response(
      JSON.stringify({ error: "Unauthorized: admin role required" }),
      { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 3. Parse + validate body ───────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 3a. Route by action ───────────────────────────────────────────────────
  const action = (body as Record<string, unknown>)?.action;

  // ── Reset password ────────────────────────────────────────────────────────
  if (action === "reset_password") {
    const parsed = ResetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Validation failed", details: parsed.error.flatten() }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    const { user_id, password } = parsed.data;
    const supabase = adminClient();
    const { error } = await supabase.auth.admin.updateUserById(user_id, { password });
    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── Create user ───────────────────────────────────────────────────────────
  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Validation failed", details: parsed.error.flatten() }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const { full_name, email, password, role, clinic_id } = parsed.data;
  const supabase = adminClient();

  // ── 4. Resolve target clinic ────────────────────────────────────────────────
  // A plain admin is clinic-scoped and can only create users for their own
  // clinic — resolved server-side, any clinic_id they pass is ignored.
  // super_admin manages all clinics, so they must specify one explicitly.
  let targetClinicId: string;
  if (callerRole === "super_admin") {
    if (!clinic_id) {
      return new Response(
        JSON.stringify({ error: "clinic_id is required for super_admin" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    targetClinicId = clinic_id;
  } else {
    const { data: callerProfile, error: profileError } = await supabase
      .from("profiles")
      .select("clinic_id")
      .eq("user_id", userId!)
      .single();
    if (profileError || !callerProfile?.clinic_id) {
      return new Response(
        JSON.stringify({ error: "Could not resolve caller's clinic" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    targetClinicId = callerProfile.clinic_id as string;
  }

  // ── 5. Create auth user ────────────────────────────────────────────────────
  const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, clinic_id: targetClinicId },
  });

  if (createError) {
    const status = createError.message.includes("already registered") ? 409 : 500;
    return new Response(
      JSON.stringify({ error: createError.message }),
      { status, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 6. Assign role ─────────────────────────────────────────────────────────
  const { error: roleError } = await supabase
    .from("user_roles")
    .upsert({ user_id: newUser.user.id, role }, { onConflict: "user_id" });

  if (roleError) {
    await supabase.auth.admin.deleteUser(newUser.user.id);
    return new Response(
      JSON.stringify({ error: "Failed to assign role. User creation rolled back." }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ user_id: newUser.user.id, email: newUser.user.email }),
    { status: 201, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
