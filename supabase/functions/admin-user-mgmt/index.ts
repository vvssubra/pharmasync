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

const InviteUserSchema = z.object({
  action: z.literal("invite_user"),
  full_name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(ALLOWED_ROLES),
  // Same clinic rules as create_user: honoured only for super_admin.
  clinic_id: z.string().uuid().optional(),
  // Origin the invite link redirects back to. Advisory only: the server
  // accepts it solely if its origin is on the same allowlist CORS uses
  // (APP_ORIGIN + localhost dev ports), otherwise falls back to APP_ORIGIN.
  redirect_to: z.string().url().optional(),
});

const ResetPasswordSchema = z.object({
  action: z.literal("reset_password"),
  user_id: z.string().uuid(),
  password: z.string().min(6).max(72),
});

// GoTrue's wording is "A user with this email address has already been
// registered" — an exact "already registered" test misses it and turns a
// duplicate into a 500, which reads as a real outage to any caller looping
// over a roster.
function isDuplicateEmail(message: string) {
  return /already\b.*\bregistered/i.test(message);
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// A client that acts *as the caller*, not as service_role. Needed for
// approve_clinic_member(): its gate is is_admin() or is_super_admin(), both of
// which read auth.uid(), and a service-role request carries none.
function callerClient(authorization: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
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

    // Being an admin is not sufficient authorisation: user_id arrives in the
    // request body, so without this an admin of clinic A could reset the
    // password of anyone in clinic B — or of a super_admin — and then sign in
    // as them. get_all_users_with_roles() is clinic-scoped, but that only
    // limits what the UI offers, not what this endpoint accepts.
    // super_admin resets anyone by design.
    if (callerRole !== "super_admin") {
      const [{ data: caller }, { data: target }, { data: targetRole }] = await Promise.all([
        supabase.from("profiles").select("clinic_id").eq("user_id", userId!).single(),
        supabase.from("profiles").select("clinic_id").eq("user_id", user_id).single(),
        supabase.from("user_roles").select("role").eq("user_id", user_id).maybeSingle(),
      ]);

      const sameClinic =
        !!caller?.clinic_id && !!target?.clinic_id && caller.clinic_id === target.clinic_id;

      if (!sameClinic || targetRole?.role === "super_admin") {
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
    }

    // An admin-set password is a temporary one, so re-arm the first-login
    // change prompt. updateUserById replaces user_metadata wholesale — read
    // and merge, or full_name and clinic_id are lost.
    const { data: existing } = await supabase.auth.admin.getUserById(user_id);
    const { error } = await supabase.auth.admin.updateUserById(user_id, {
      password,
      user_metadata: {
        ...(existing?.user?.user_metadata ?? {}),
        must_change_password: true,
      },
    });
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

  // ── Invite user ───────────────────────────────────────────────────────────
  if (action === "invite_user") {
    const parsed = InviteUserSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Validation failed", details: parsed.error.flatten() }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    const { full_name, email, role, clinic_id, redirect_to } = parsed.data;
    const supabase = adminClient();

    // Same clinic resolution as create_user: plain admin is pinned to their
    // own clinic; super_admin must say which clinic explicitly.
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

    // The invite link's tokens are delivered to whatever origin GoTrue
    // redirects to, so a hostile origin here is account takeover of the
    // invitee. Never trust the body: only an allowlisted origin (the same
    // set CORS accepts) is honoured, anything else — including unparseable
    // or non-http schemes — falls back to APP_ORIGIN. Path is always forced
    // to /reset-password. GoTrue's own URI allowlist is the second layer.
    const appOrigin = Deno.env.get("APP_ORIGIN") ?? "";
    const allowedOrigins = [appOrigin, "http://localhost:8080", "http://localhost:5173"];
    let redirectOrigin = "";
    if (redirect_to) {
      try {
        const candidate = new URL(redirect_to).origin;
        if (allowedOrigins.includes(candidate)) redirectOrigin = candidate;
      } catch {
        // fall through to appOrigin
      }
    }
    if (!redirectOrigin) redirectOrigin = appOrigin;
    const redirectTo = redirectOrigin
      ? new URL("/reset-password", redirectOrigin).toString()
      : undefined;

    const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      email,
      {
        data: { full_name, clinic_id: targetClinicId },
        ...(redirectTo ? { redirectTo } : {}),
      },
    );

    if (inviteError) {
      const status = isDuplicateEmail(inviteError.message) ? 409 : 500;
      return new Response(
        JSON.stringify({ error: inviteError.message }),
        { status, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { error: roleError } = await supabase
      .from("user_roles")
      .upsert({ user_id: invited.user.id, role }, { onConflict: "user_id" });

    if (roleError) {
      await supabase.auth.admin.deleteUser(invited.user.id);
      return new Response(
        JSON.stringify({ error: "Failed to assign role. Invite rolled back." }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ user_id: invited.user.id, email: invited.user.email }),
      { status: 201, headers: { ...cors, "Content-Type": "application/json" } },
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
    // must_change_password: the password above was chosen by an admin and is
    // shared out of band, so ProtectedRoute forces /change-password on first
    // login until the user replaces it.
    user_metadata: { full_name, clinic_id: targetClinicId, must_change_password: true },
  });

  if (createError) {
    const status = isDuplicateEmail(createError.message) ? 409 : 500;
    return new Response(
      JSON.stringify({ error: createError.message }),
      { status, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // ── 6. Assign clinic + role ────────────────────────────────────────────────
  // handle_new_user() deliberately parks the signup's clinic in
  // pending_clinic_id and leaves clinic_id NULL, so a freshly created user
  // would land on the Pending Approval screen. An admin creating an account
  // *is* the approval, so run the same RPC the approve button uses: it sets
  // profiles.clinic_id, clears pending_clinic_id and upserts user_roles in one
  // statement. It has to run as the caller — service_role has no auth.uid()
  // and would fail the RPC's own is_admin()/is_super_admin() gate.
  const { error: assignError } = await callerClient(req.headers.get("authorization")!)
    .rpc("approve_clinic_member", {
      target_user: newUser.user.id,
      target_role: role,
      target_clinic: targetClinicId,
    });

  if (assignError) {
    await supabase.auth.admin.deleteUser(newUser.user.id);
    return new Response(
      JSON.stringify({ error: `Failed to assign clinic and role. User creation rolled back. ${assignError.message}` }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ user_id: newUser.user.id, email: newUser.user.email }),
    { status: 201, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
