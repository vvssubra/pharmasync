-- Logistic pharmacist HQ role, follow-up: narrow the drug_quotas write lockdown
-- from 20260819000400_logistic_access.sql section 4 back to what it was actually
-- meant to close.
--
-- Depends on:
--   20260723000200_tenancy_3_rls.sql          — the ORIGINAL clinic-admin write
--                                               policies whose predicate shape is
--                                               restored verbatim below
--   20260819000010_hq_clinic.sql              — public.hq_clinic_id()
--   20260819000300_national_quota_pool.sql    — HQ row is the national pool; the
--                                               `is distinct from
--                                               public.hq_clinic_id()` idiom
--   20260819000400_logistic_access.sql        — the three policies dropped here
--
-- ── The regression ──────────────────────────────────────────────────────────
-- 20260819000400 section 4 replaced the three drug_quotas write policies with a
-- bare `public.is_super_admin()`, deleting the clinic-admin branch and with it
-- any clinic predicate at all. The intent was narrow and correct: an admin whose
-- profile sits in the HQ clinic ('Logistik PKDJB') could otherwise edit the
-- *national* allocation row straight through PostgREST, bypassing
-- set_national_drug_quota()'s validation and its drug_quota_audit trail.
--
-- The blast radius was not narrow. Three frontend components upsert a
-- drug_quotas row on EVERY drug save / quota replenish, not only for
-- controlled or quota-tracked drugs:
--   src/components/DrugFormDialog.tsx
--   src/components/DrugQuotaDialog.tsx
--   src/components/ReplenishQuotaDialog.tsx
-- Task 12 gated those components for CONTROLLED drugs only. For ordinary,
-- non-controlled drugs all three still issue the upsert, and since
-- 20260819000400 RLS denies it for every ordinary clinic admin at every
-- non-HQ clinic. DrugFormDialog is the worst of the three: it writes the
-- `drugs` row first and the `drug_quotas` row second, with no enclosing
-- transaction, so an admin editing something as mundane as stok_min gets an
-- RLS error toast on an edit that already committed.
--
-- ── The correction ──────────────────────────────────────────────────────────
-- Restore the admin branch scoped to the admin's OWN clinic, and additionally
-- exclude the HQ clinic. That closes exactly the bypass 20260819000400 was
-- after (an HQ-stationed admin writing the live national row) while returning
-- every other clinic admin to the write path that existed before this plan
-- started. Per-clinic drug_quotas rows at non-HQ clinics are, per
-- 20260819000300 (section 2's comment), retained but no longer read by
-- enforcement — writable-but-inert is the correct, harmless state for them.
--
-- Additive migration, per this branch's convention: 20260819000400 is left
-- untouched and its policies are dropped and recreated here.
--
-- ── Predicate, before and after ─────────────────────────────────────────────
-- Original (20260723000200:147-167), all three policies:
--     public.is_super_admin()
--     or (clinic_id = public.user_clinic_id()
--         and exists (select 1 from public.user_roles ur
--                     where ur.user_id = auth.uid() and ur.role = 'admin'))
--
-- After 20260819000400 (the regression), all three:
--     public.is_super_admin()
--
-- Now, all three:
--     public.is_super_admin()
--     or (clinic_id = public.user_clinic_id()
--         and clinic_id is distinct from public.hq_clinic_id()
--         and exists (select 1 from public.user_roles ur
--                     where ur.user_id = auth.uid() and ur.role = 'admin'))
--
-- The admin-detection clause is the inline `exists (...)` copied verbatim from
-- the original, NOT public.is_admin(). The two happen to be equivalent as
-- public.is_admin() stands today (20260318_auth_fix.sql:33-44 — `role =
-- 'admin'`, super_admin excluded, and no migration redefines it since), but
-- reproducing the original text keeps this migration a pure scope correction
-- and leaves the policy independent of any future change to that helper.
--
-- ── Why `is distinct from` and not `<>` ─────────────────────────────────────
-- `clinic_id = public.user_clinic_id()` stays a plain `=`, matching every other
-- clinic-comparison policy in 20260723000200: NULL there means "caller has no
-- clinic", and yielding NULL (→ deny) is the fail-closed answer.
--
-- The new HQ term is the opposite polarity, so plain `<>` would fail the WRONG
-- way. hq_clinic_id() should never be NULL — clinics_single_hq guarantees at
-- most one HQ row and 20260819000010 seeds exactly one — but if the HQ clinic
-- were ever absent, `clinic_id <> NULL` is NULL, the whole AND-chain is NULL,
-- and EVERY clinic admin at EVERY clinic loses drug_quotas writes: precisely
-- the regression this migration exists to undo, reintroduced by a defensive
-- operator choice. `is distinct from` returns true instead: with no HQ clinic
-- configured the predicate has no clinic to exclude, so it excludes none. See
-- the residual note below for what that does and does not cover.
--
-- One residual, stated precisely rather than waved away. There are two ways
-- hq_clinic_id() can return NULL and they are NOT equivalent:
--
--   a) The HQ clinics row is DELETED. Then its national drug_quotas rows are
--      gone too (or the delete is refused by drug_quotas.clinic_id's FK while
--      they exist), so there is no national row left to protect and nothing is
--      reopened.
--
--   b) `update clinics set is_hq = false` on the HQ clinic — the row and ALL of
--      its national drug_quotas rows survive, hq_clinic_id() starts returning
--      NULL, `is distinct from` yields true, and an admin stationed at that
--      now-ex-HQ clinic regains DIRECT PostgREST write access to the orphaned
--      national rows. That is exactly the bypass this migration exists to
--      close, and this predicate cannot close it: the predicate's only handle
--      on "which clinic is HQ" is the flag that was just cleared.
--
-- (b) is accepted, not overlooked. Clearing is_hq is a super_admin action —
-- `update clinics` is super_admin-only per 20260723000200:39-42 — and a
-- super_admin already holds an unconditional direct write to drug_quotas
-- through term 1 of this very predicate, so the action is taken by someone who
-- did not need the bypass in the first place. Swapping in `<>` would not fix
-- (b) either; it would only trade it for the far likelier regression of
-- breaking every clinic's writes. The real mitigation is that the state is
-- loud: enforce_dispensing_request_limits() (20260819000300 section 6d) and
-- set_national_drug_quota() (20260819000400 section 2) both raise on a missing
-- HQ clinic, so quota enforcement and the HQ dashboard stop working the moment
-- is_hq is cleared. Anyone clearing it will know immediately.
--
-- `is distinct from public.hq_clinic_id()` is also the established idiom for
-- "not the HQ clinic" in this branch — see 20260819000300:45 and :79.
--
-- Policy names revert to the "Clinic admin can ..." wording of the original,
-- since the admin capability genuinely exists again. Both the original names
-- and 20260819000400's "Super admin can ..." names are dropped explicitly so
-- this migration is idempotent from either prior state and leaves no stale,
-- permissive policy behind (policies on a table are OR-ed together, so a
-- leftover duplicate would be additive, not shadowed).
--
-- SELECT is untouched: 20260819000400 section 3 owns the read policy, and
-- reading a quota was never the concern.

-- ── INSERT ──────────────────────────────────────────────────────────────────
-- Belt and braces with trg_stamp_clinic_id (20260723000200:74-75), which
-- overwrites new.clinic_id with public.user_clinic_id() for every non
-- super_admin caller: the `clinic_id = public.user_clinic_id()` term is
-- therefore already true by construction for an admin, and the HQ term is what
-- does the work — an admin stationed at HQ gets their insert stamped with the
-- HQ clinic_id and is then refused by the WITH CHECK.
drop policy if exists "Super admin can insert drug_quotas" on public.drug_quotas;
drop policy if exists "Clinic admin can insert drug_quotas" on public.drug_quotas;
create policy "Clinic admin can insert drug_quotas" on public.drug_quotas
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and clinic_id is distinct from public.hq_clinic_id()
        and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  );

-- ── UPDATE ──────────────────────────────────────────────────────────────────
-- No WITH CHECK, matching the original policy in 20260723000200:154-160.
-- Postgres defaults an UPDATE policy's WITH CHECK to its USING expression, so
-- the post-image is held to the same predicate: an admin cannot move a row onto
-- another clinic, nor onto the HQ clinic, via UPDATE. (20260724000000's
-- clinic_id guard trigger covers profiles only, so the defaulted WITH CHECK is
-- what protects drug_quotas here.)
drop policy if exists "Super admin can update drug_quotas" on public.drug_quotas;
drop policy if exists "Clinic admin can update drug_quotas" on public.drug_quotas;
create policy "Clinic admin can update drug_quotas" on public.drug_quotas
  for update to authenticated
  using (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and clinic_id is distinct from public.hq_clinic_id()
        and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  );

-- ── DELETE ──────────────────────────────────────────────────────────────────
drop policy if exists "Super admin can delete drug_quotas" on public.drug_quotas;
drop policy if exists "Clinic admin can delete drug_quotas" on public.drug_quotas;
create policy "Clinic admin can delete drug_quotas" on public.drug_quotas
  for delete to authenticated
  using (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and clinic_id is distinct from public.hq_clinic_id()
        and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  );

notify pgrst, 'reload schema';
