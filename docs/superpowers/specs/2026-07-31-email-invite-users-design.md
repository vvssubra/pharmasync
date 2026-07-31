# Email Invite for Manually Created Users — Design

**Date:** 2026-07-31
**Status:** Approved by user (invite-link delivery, Hostinger SMTP)

## Problem

Some staff have no `@moh.gov.my` email, so Google OAuth login is unavailable to them.
Admins can already create email/password accounts manually via Role Management
(`admin-user-mgmt` edge function, `create_user` action), but the password must be
handed over out-of-band. The clinic wants login details delivered to the user's
email automatically.

## Decision

Send an **invite link** (user sets own password) rather than emailing a temporary
password. No plaintext password ever travels by email.

## Scope

### Part 1 — SMTP on self-hosted Supabase (infrastructure, deferred)

- Hostinger mailbox (e.g. `noreply@<domain>`) — credentials to be provided by user.
- GoTrue SMTP env vars in Coolify: `GOTRUE_SMTP_HOST=smtp.hostinger.com`,
  `GOTRUE_SMTP_PORT=465`, `GOTRUE_SMTP_USER`, `GOTRUE_SMTP_PASS`,
  `GOTRUE_SMTP_ADMIN_EMAIL`, `GOTRUE_SMTP_SENDER_NAME=PharmaSync`.
- Restart auth container after setting.
- Side benefit: the existing forgot-password email flow starts working.
- **Blocked until user supplies the mailbox.** Code parts below are independent.

### Part 2 — Edge function: `invite_user` action in `admin-user-mgmt`

- Schema: `{ action: "invite_user", full_name, email, role, clinic_id? }` — no password.
- Same authorization as `create_user`: admin or super_admin caller; plain admin is
  clinic-scoped (server resolves clinic, ignores any passed `clinic_id`);
  super_admin must pass `clinic_id`.
- Any email domain accepted (the moh.gov.my restriction applies only to Google
  OAuth in `AuthContext.tsx` and is untouched).
- Calls `supabase.auth.admin.inviteUserByEmail(email, { data: { full_name,
  clinic_id }, redirectTo: <app-origin>/reset-password })`, then upserts role in
  `user_roles`. On role failure, delete the auth user (rollback), same as
  `create_user`.

### Part 3 — Frontend: Role Management invite mode

- Add New User dialog gets a delivery mode toggle:
  - **Send email invite** (default) — password field hidden, calls `invite_user`.
  - **Set password manually** — current behavior, calls `create_user`.

### Part 4 — ResetPassword invite-token handling

- `ResetPassword.tsx` currently only sets `ready` on the `PASSWORD_RECOVERY`
  auth event. Invite links produce a `SIGNED_IN` event with `type=invite` in the
  URL hash. Capture the hash type synchronously on mount; treat
  `SIGNED_IN && type=invite` as ready too.

## Out of scope (YAGNI)

- Custom email templates (GoTrue default invite email is fine initially).
- Resend-invite button, invite expiry management.
- Any change to Google OAuth domain restriction.

## Error handling

- Duplicate email → 409 surfaced in dialog (existing pattern).
- Role upsert failure → auth user deleted, 500 "rolled back" (existing pattern).
- SMTP failure → `inviteUserByEmail` returns error → surfaced in dialog.

## Testing

- Frontend: extend `RoleManagement.test.tsx` for mode toggle + payload shape;
  extend/add ResetPassword test for invite-hash readiness.
- Edge function: no existing Deno test harness; validation logic covered by
  schema; manual smoke test after SMTP configured.
