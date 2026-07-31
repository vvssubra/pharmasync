# Email Invite for Manually Created Users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can create a user for any email domain and have login details delivered as an email invite link (user sets own password via the existing `/reset-password` page).

**Architecture:** Extend the existing `admin-user-mgmt` Supabase edge function with an `invite_user` action that wraps `auth.admin.inviteUserByEmail`. Add a delivery-mode toggle to the Role Management "Add New User" dialog. Teach `ResetPassword.tsx` to accept invite tokens (not just recovery tokens). SMTP configuration on the self-hosted GoTrue is a separate manual step, blocked on user-supplied Hostinger mailbox credentials — code merges independently.

**Tech Stack:** React 18 + TypeScript + React Query + shadcn/ui (frontend), Deno + Zod + supabase-js v2 (edge function), Vitest + Testing Library (tests).

## Global Constraints

- UI language: English, domain nouns stay Malay (per CLAUDE.md).
- Edge function follows existing patterns in `supabase/functions/admin-user-mgmt/index.ts`: zod schema per action, `verifyJWT` + `getUserRole` from `../_shared/security.ts`, CORS via `corsHeaders(origin)`, JSON error bodies `{ error: string }`.
- Plain `admin` callers are clinic-scoped server-side; any `clinic_id` they send is ignored. `super_admin` must send `clinic_id`. Copy the exact resolution logic already used by `create_user` (index.ts lines 145–171).
- The Google-OAuth-only domain restriction in `src/contexts/AuthContext.tsx` must NOT be touched.
- Frontend forms that submit must keep `noValidate` off unless already present — do not add HTML5 validation attributes that conflict with manual checks (see repo history: HTML5 validation interfered with custom validation).
- Run tests with: `npx vitest run <file>` from repo root.
- Commit after each task. Commit messages: conventional commits, end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

- Modify: `supabase/functions/admin-user-mgmt/index.ts` — add `InviteUserSchema` + `invite_user` branch.
- Modify: `src/pages/RoleManagement.tsx` — mode toggle state, `inviteUser` mutation, dialog UI.
- Modify: `src/pages/RoleManagement.test.tsx` — invite-mode tests.
- Modify: `src/pages/ResetPassword.tsx` — invite-token readiness.
- No new files.

---

### Task 1: `invite_user` action in the edge function

**Files:**
- Modify: `supabase/functions/admin-user-mgmt/index.ts`

**Interfaces:**
- Consumes: `verifyJWT`, `getUserRole`, `corsHeaders` from `../_shared/security.ts` (already imported); `adminClient()` helper already in the file.
- Produces: HTTP action `{ action: "invite_user", full_name: string, email: string, role: "admin"|"fms"|"mo"|"pharmacist", clinic_id?: uuid, redirect_to?: string (url) }` → 201 `{ user_id, email }`. Task 2's frontend calls this exact shape.

There is no Deno test harness in this repo — this task is implementation + typecheck only; behavior is covered by the frontend contract tests in Task 2 and manual smoke testing after SMTP config.

- [x] **Step 1: Add the schema**

After `CreateUserSchema` (below line 22), add:

```ts
const InviteUserSchema = z.object({
  action: z.literal("invite_user"),
  full_name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(ALLOWED_ROLES),
  // Same clinic rules as create_user: honoured only for super_admin.
  clinic_id: z.string().uuid().optional(),
  // Origin the invite link redirects back to; validated as URL and only the
  // /reset-password path of it is used.
  redirect_to: z.string().url().optional(),
});
```

- [x] **Step 2: Add the action branch**

After the `reset_password` block (after line 131), before the `create_user` parse, add:

```ts
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

    // Only the origin of redirect_to is trusted; path is forced to
    // /reset-password so a crafted body can't send invitees elsewhere.
    const redirectTo = redirect_to
      ? new URL("/reset-password", redirect_to).toString()
      : undefined;

    const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      email,
      {
        data: { full_name, clinic_id: targetClinicId },
        ...(redirectTo ? { redirectTo } : {}),
      },
    );

    if (inviteError) {
      const status = inviteError.message.includes("already registered") ? 409 : 500;
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
```

- [x] **Step 3: Typecheck the function**

Run: `deno check supabase/functions/admin-user-mgmt/index.ts` (if `deno` is installed; if not, skip — the file follows the same patterns that already deploy).
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add supabase/functions/admin-user-mgmt/index.ts
git commit -m "feat: invite_user action — email invite instead of manual password

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Role Management invite mode (TDD)

**Files:**
- Modify: `src/pages/RoleManagement.tsx`
- Test: `src/pages/RoleManagement.test.tsx`

**Interfaces:**
- Consumes: Task 1's HTTP action. Payload sent to `ADMIN_MGMT_URL` (already defined at `RoleManagement.tsx:19`): `{ action: "invite_user", full_name, email, role, redirect_to: window.location.origin, ...(super_admin ? { clinic_id } : {}) }`.
- Produces: UI behavior only.

Existing state (lines 64–70): `addUserOpen, newName, newEmail, newPassword, newRole, newClinicId, addUserError`. Existing mutation `createUser` (lines 123–155). Dialog UI at lines 466–549.

- [x] **Step 1: Read the existing test file**

Read `src/pages/RoleManagement.test.tsx` fully to reuse its render helpers, auth/query mocks, and fetch-mock pattern. The tests below must follow its existing conventions (adjust selectors/mocks to match — the intent of each test is fixed, the plumbing follows the file's style).

- [x] **Step 2: Write failing tests**

Add to `src/pages/RoleManagement.test.tsx` (adapt setup to the file's existing helpers):

```tsx
describe("Add New User — invite mode", () => {
  it("defaults to invite mode with no password field", async () => {
    // open the Add New User dialog via its trigger button
    // assert: radio/toggle "Send email invite" is selected
    // assert: screen.queryByLabelText(/password/i) is null
  });

  it("sends invite_user payload without password", async () => {
    // fill Full Name, Email (non-moh domain e.g. staff@gmail.com), pick role
    // submit; inspect the fetch mock's last call body:
    // expect body.action === "invite_user"
    // expect body).not.toHaveProperty("password")
    // expect body.redirect_to === window.location.origin
  });

  it("manual mode still sends create_user with password", async () => {
    // switch toggle to "Set password manually"
    // password field appears; fill all fields; submit
    // expect body.action === "create_user" and body.password === entered value
  });
});
```

- [x] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/pages/RoleManagement.test.tsx`
Expected: the three new tests FAIL (no toggle exists yet); pre-existing tests PASS.

- [x] **Step 4: Implement**

In `src/pages/RoleManagement.tsx`:

1. Add state next to the other dialog state (after line 70):

```tsx
const [deliveryMode, setDeliveryMode] = useState<"invite" | "manual">("invite");
```

2. Add an `inviteUser` mutation modeled on `createUser` (place directly after it):

```tsx
const inviteUser = useMutation({
  mutationFn: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(ADMIN_MGMT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        action: "invite_user",
        full_name: newName.trim(),
        email: newEmail.trim(),
        role: newRole,
        redirect_to: window.location.origin,
        ...(isSuperAdmin ? { clinic_id: newClinicId } : {}),
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to send invite");
    return json;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["all-users-with-roles"] });
    toast.success("Invite sent. User will set their password by email.");
    setAddUserOpen(false);
    setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("mo"); setNewClinicId("");
    setAddUserError(null);
  },
  onError: (err: Error) => {
    setAddUserError(err.message);
  },
});
```

3. Dialog changes (lines 466–549):
   - Form `onSubmit` routes by mode: `deliveryMode === "invite" ? inviteUser.mutate() : createUser.mutate()`.
   - Add the toggle above the Full Name field, using the repo's shadcn `RadioGroup` if present in `src/components/ui/` (check; otherwise two `Button variant={active ? "default" : "outline"}` in a row — follow whichever primitive the codebase already ships):

```tsx
<div className="space-y-2">
  <Label>Login details</Label>
  <RadioGroup
    value={deliveryMode}
    onValueChange={(v) => setDeliveryMode(v as "invite" | "manual")}
    className="flex gap-4"
  >
    <div className="flex items-center gap-2">
      <RadioGroupItem value="invite" id="mode-invite" />
      <Label htmlFor="mode-invite" className="font-normal">Send email invite</Label>
    </div>
    <div className="flex items-center gap-2">
      <RadioGroupItem value="manual" id="mode-manual" />
      <Label htmlFor="mode-manual" className="font-normal">Set password manually</Label>
    </div>
  </RadioGroup>
</div>
```

   - Wrap the password field block (lines 496–507) in `{deliveryMode === "manual" && (...)}` — keep `required` on the input; it is only rendered in manual mode so it cannot block invite submits.
   - Submit button (line 543): pending state covers both mutations; label per mode:

```tsx
<Button type="submit" disabled={createUser.isPending || inviteUser.isPending || (isSuperAdmin && !newClinicId)}>
  {createUser.isPending || inviteUser.isPending
    ? (deliveryMode === "invite" ? "Sending…" : "Creating…")
    : (deliveryMode === "invite" ? "Send Invite" : "Create User")}
</Button>
```

   - Reset `deliveryMode` to `"invite"` when the dialog closes (in the existing `onOpenChange` handler).

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/pages/RoleManagement.test.tsx`
Expected: all PASS.

- [x] **Step 6: Commit**

```bash
git add src/pages/RoleManagement.tsx src/pages/RoleManagement.test.tsx
git commit -m "feat: Add User dialog sends email invites by default; manual password stays as option

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ResetPassword accepts invite tokens (TDD)

**Files:**
- Modify: `src/pages/ResetPassword.tsx`
- Test: `src/pages/ResetPassword.test.tsx` (create — no test exists for this page)

**Interfaces:**
- Consumes: supabase-js auth events. Recovery links fire `PASSWORD_RECOVERY`; invite links land with `#...type=invite...` in the URL hash and fire `SIGNED_IN`.
- Produces: page shows the set-password form for both link types.

- [x] **Step 1: Write failing tests**

Create `src/pages/ResetPassword.test.tsx`. Mock `@/integrations/supabase/client` following the mocking style used in `src/pages/RoleManagement.test.tsx` (read it first). Capture the `onAuthStateChange` callback so tests can fire events:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ResetPassword from "./ResetPassword";

let authCallback: (event: string) => void = () => {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((cb) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

function renderPage(hash = "") {
  window.location.hash = hash;
  return render(<MemoryRouter><ResetPassword /></MemoryRouter>);
}

describe("ResetPassword readiness", () => {
  beforeEach(() => { window.location.hash = ""; });

  it("shows form on PASSWORD_RECOVERY event", async () => {
    renderPage();
    authCallback("PASSWORD_RECOVERY");
    expect(await screen.findByLabelText(/new password/i)).toBeInTheDocument();
  });

  it("shows form on SIGNED_IN when URL hash is an invite", async () => {
    renderPage("#access_token=abc&type=invite");
    authCallback("SIGNED_IN");
    expect(await screen.findByLabelText(/new password/i)).toBeInTheDocument();
  });

  it("stays on verifying state on SIGNED_IN without invite hash", () => {
    renderPage();
    authCallback("SIGNED_IN");
    expect(screen.getByText(/verifying reset link/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });
});
```

Note: if `authCallback("...")` doesn't trigger a re-render, wrap the call in `act(...)` from `@testing-library/react`.

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/ResetPassword.test.tsx`
Expected: test 2 FAILS (invite hash not handled); tests 1 and 3 may already pass.

- [x] **Step 3: Implement**

In `src/pages/ResetPassword.tsx`, replace the `useEffect` (lines 19–28) with:

```tsx
  // The hash must be captured synchronously at mount: supabase-js consumes and
  // strips it while establishing the session from the link.
  const [isInviteLink] = useState(() => window.location.hash.includes("type=invite"));

  useEffect(() => {
    // Recovery links fire PASSWORD_RECOVERY. Invite links (admin-created
    // accounts) establish a session and fire SIGNED_IN instead, so those are
    // recognised by the type=invite marker captured from the URL hash.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && isInviteLink)) {
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [isInviteLink]);
```

Also update the page copy so invitees aren't confused: change the `CardTitle`/`CardDescription` only if trivial — otherwise leave as "Set New Password", which already fits both flows. (Leave it. YAGNI.)

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/ResetPassword.test.tsx`
Expected: all 3 PASS.

- [x] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: no new failures (note: `AntibioticForm.test.tsx` has a known flake under parallel load — rerun that file solo if it fails).

- [x] **Step 6: Commit**

```bash
git add src/pages/ResetPassword.tsx src/pages/ResetPassword.test.tsx
git commit -m "feat: reset-password page accepts invite links, not just recovery links

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: SMTP configuration runbook (docs only — actual config blocked on credentials)

**Files:**
- Create: `docs/smtp-setup.md`

**Interfaces:** none — operator documentation.

- [x] **Step 1: Write the runbook**

Create `docs/smtp-setup.md`:

```markdown
# SMTP Setup — invite + reset emails (self-hosted Supabase)

Emails (invite links, forgot-password) are sent by GoTrue (the `auth`
container). Until SMTP is configured, `invite_user` and
`resetPasswordForEmail` calls fail with an SMTP error.

## Prerequisites

- A Hostinger mailbox, e.g. `noreply@<domain>` (Hostinger hPanel → Emails →
  Create mailbox). Note the mailbox password.

## Configure (Coolify)

In Coolify → the Supabase stack → the `auth` (GoTrue) service → Environment
Variables, set:

| Variable | Value |
|---|---|
| `GOTRUE_SMTP_HOST` | `smtp.hostinger.com` |
| `GOTRUE_SMTP_PORT` | `465` |
| `GOTRUE_SMTP_USER` | `noreply@<domain>` |
| `GOTRUE_SMTP_PASS` | mailbox password |
| `GOTRUE_SMTP_ADMIN_EMAIL` | `noreply@<domain>` |
| `GOTRUE_SMTP_SENDER_NAME` | `PharmaSync` |

Redeploy/restart the `auth` service.

Note: some Supabase docker-compose stacks name these `SMTP_HOST`, `SMTP_PORT`,
etc. and map them through to GoTrue — check the stack's compose file for which
names it forwards, and set the ones it uses.

## Also verify

- `GOTRUE_SITE_URL` (or `SITE_URL`) is the production app URL.
- `GOTRUE_URI_ALLOW_LIST` (or `ADDITIONAL_REDIRECT_URLS`) includes
  `<production-origin>/reset-password`.

## Smoke test

1. Login page → "Forgot password" → own email → reset email arrives.
2. Role Management → Add New User → invite mode → test email → invite arrives,
   link opens `/reset-password`, password can be set, login works.
```

- [x] **Step 2: Commit**

```bash
git add docs/smtp-setup.md
git commit -m "docs: SMTP runbook for invite and reset emails

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Not in this plan (manual, after user provides mailbox)

- Creating the Hostinger mailbox and setting Coolify env vars (runbook above).
- Deploying the edge function to the VPS (existing deploy process; PostgREST
  reload not needed — no DB function changes).
- End-to-end smoke test of a real invite email.
