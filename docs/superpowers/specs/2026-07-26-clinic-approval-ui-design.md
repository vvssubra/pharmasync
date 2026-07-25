# Clinic Approval UI — Design

Date: 2026-07-26
Status: approved, ready for implementation

## Problem

`20260724000000_security_tenancy_hardening.sql` rewrote `handle_new_user()` so a
signup records its clinic choice in `profiles.pending_clinic_id` and leaves
`clinic_id` NULL until an admin approves. The approval step was never built.

Consequence: every account created since that migration has a NULL `clinic_id`,
so `user_clinic_id()` returns NULL, and `stamp_clinic_id()` (same migration,
section 7) raises on every insert:

```
clinic_id could not be resolved for user <uuid> — profile has no clinic
```

This blocks antibiotic forms, drug requests, transactions — anything
clinic-scoped. The only fix today is a manual `UPDATE` in psql with
`trg_guard_profile_clinic_change` disabled.

Google OAuth signups are worse off: they carry no `clinic_id` metadata, so both
`clinic_id` and `pending_clinic_id` are NULL. `get_all_users_with_roles()` only
returns pending users whose `pending_clinic_id` matches the caller's clinic, so
these accounts are invisible to a clinic admin entirely.

## Decisions

| Question | Decision |
|---|---|
| What does Approve do? | Grants clinic **and** role in one atomic action. A pending user needs both to be usable. |
| Reject path? | None. Unapproved users stay in the list with no clinic and no role; every clinic-scoped read/write stays denied. Account deletion remains a Supabase-admin job. |
| Who adopts orphans (no `pending_clinic_id`)? | Any admin. They belong to no clinic, so listing them leaks only name and email, and it keeps existing stranded accounts fixable from the UI. |
| Where does the write live? | A `security definer` RPC, not an edge function and not by re-granting the revoked column privilege. |

## Why an RPC

`revoke update (clinic_id) on public.profiles from authenticated` means the page
cannot write the column with the anon key, even though
`guard_profile_clinic_change` would permit the adopt case. Three ways out:

- **`security definer` RPC (chosen).** Runs as owner, so the revoke does not
  apply. Guard sits beside the policies it mirrors, matching
  `get_all_users_with_roles()` and `get_unassigned_user_count()`.
- **New action on the `admin-user-mgmt` edge function.** Correct for
  `create_user`, which touches `auth.users`. Overkill for one UPDATE and one
  UPSERT on tables the anon key already reaches, and it moves the rule into
  TypeScript.
- **Re-grant the column privilege.** Smallest diff, but the revoke is a
  deliberate boundary from the hardening migration ("a stray policy can never
  re-open this path"). Not worth undoing to save an RPC.

## Migration

New migration adding one function and widening two.

### `approve_clinic_member(target_user uuid, target_role app_role, target_clinic uuid default null)`

`security definer`, `set search_path = public`, returns void.

1. Raise unless `is_admin()` or `is_super_admin()`.
2. Resolve the clinic:
   - super_admin: use `target_clinic`; raise if null.
   - admin: ignore `target_clinic` entirely, use `user_clinic_id()`; raise if
     the caller's own clinic is null.
3. Load the target profile; raise if it does not exist.
4. Raise if the target's `clinic_id` is already set. This is adoption of
   unassigned users only — reassignment stays a super_admin/psql operation, so
   an admin can never pull an approved member out of another clinic.
5. `update public.profiles set clinic_id = <resolved>, pending_clinic_id = null
   where user_id = target_user`.
6. `insert into public.user_roles (user_id, role) values (target_user,
   target_role) on conflict (user_id) do update set role = excluded.role`.

Steps 5 and 6 run in the function's implicit transaction, so a failed role
insert rolls the clinic grant back. Raise messages are user-facing: the UI
shows them verbatim.

`target_role` is the `app_role` enum. `super_admin` is not grantable here —
raise if passed, matching the user_roles policies in the hardening migration.

### `get_all_users_with_roles()` — widened

- Add `pending_clinic_id` and the pending clinic's name to the returned row so
  the UI can label what was requested.
- Add orphans to the visibility predicate:
  `or (p.clinic_id is null and p.pending_clinic_id is null)`.

### `get_unassigned_user_count()` — widened

Same orphan clause, so the sidebar badge and the page agree. The count keeps
its existing meaning: users with no role.

## UI — `src/pages/RoleManagement.tsx`

A "Pending Approval" card above the existing user list, rendered only when at
least one pending user exists. Pending = `clinic_id is null`.

Each row:

- Name, email.
- Requested clinic name, or "No clinic requested" for orphans.
- Role `Select`, defaulting to `mo`, offering the four assignable roles. No
  "Unassigned" option — approving without a role defeats the purpose.
- Clinic `Select` for super_admin only, reusing the existing `clinics` query.
- **Approve** button, disabled while the mutation is pending, and for
  super_admin until a clinic is chosen.

Approved users disappear from the card on query invalidation and appear in the
main list below with their new clinic and role.

Mutation calls `supabase.rpc("approve_clinic_member", {...})`, then invalidates
`all-users-with-roles` and the sidebar's unassigned-count query. Success →
`toast.success`. Failure → `toast.error(getErrorMessage(err, ...))`, so the
RPC's raise text reaches the user rather than a generic string.

The existing user list keeps its current behaviour, minus pending users, which
now render in the card above instead of as rows with an empty clinic.

## Testing

New `src/pages/RoleManagement.test.tsx`, following the mock style of
`DoctorRequest.test.tsx` (mock `@/integrations/supabase/client`,
`@/contexts/AuthContext`, `sonner`):

1. A user with null `clinic_id` renders in Pending Approval, not the main list.
2. Approve calls `supabase.rpc` with `approve_clinic_member`, the target user
   id, and the selected role.
3. An orphan (both clinic fields null) renders with "No clinic requested".
4. A plain admin sees no clinic picker; a super_admin does.
5. An RPC error surfaces its message through `toast.error`.

## Out of scope

- Rejecting or deleting accounts.
- Reassigning a user who already has a clinic.
- Recording `pending_clinic_id` on the Google OAuth path. Orphan adoption covers
  the symptom; the upstream fix is separate work.
- Backfilling accounts already stranded in production — that is the psql UPDATE
  documented in the debugging session, and after this ships those users can be
  approved from the UI instead.
