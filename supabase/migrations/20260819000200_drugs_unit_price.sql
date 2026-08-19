-- Logistic pharmacist HQ role, step 4 (of the role-and-quota plan): give
-- drugs a unit price, and let the new logistic_pharmacist role write it (and
-- the rest of the drug row) without becoming a full clinic admin.
--
-- Depends on 20260819000000_logistic_role_enum.sql for the enum value (used
-- here only via the pre-existing public.is_logistic_pharmacist() helper from
-- 20260819000100_logistic_role_helpers.sql, not as a literal, so same-
-- transaction visibility is not a concern).

-- ── 1. drugs.unit_price ─────────────────────────────────────────────────────
-- Nullable, no default: NULL means "not priced yet" and must render as such
-- in the UI, not as free (0) or omitted. numeric(12,2) matches money handling
-- elsewhere in this schema; the check keeps a price honest without forcing
-- one to exist.
alter table public.drugs
  add column if not exists unit_price numeric(12,2)
    check (unit_price is null or unit_price >= 0);

comment on column public.drugs.unit_price is
  'Cost per unit_pengukuran. NULL means not yet priced — render as such, '
  'never as free or omitted.';

-- ── 2. drugs write policies: logistic_pharmacist joins the admin grant ─────
-- 20260724000000_security_tenancy_hardening.sql section 5 deliberately kept
-- drugs writes narrow — is_admin() or is_super_admin() only — because an
-- open policy let any authenticated user clear perlu_kelulusan_pakar or
-- is_blocked. unit_price is just another column on that same row, so
-- logistic_pharmacist needs to join the existing broad grant, not get a
-- narrower policy scoped to unit_price alone — a column-restricted policy
-- would silently fail the moment this role also needs to touch stock
-- thresholds or location codes on the same row. drugs SELECT is already
-- USING (true); no read-side change.
--
-- This repo's convention (every policy redefinition in every prior
-- migration) is drop + create, since create or replace does not work for
-- policies.

drop policy if exists "Admins can insert drugs" on public.drugs;
create policy "Admins can insert drugs"
  on public.drugs for insert
  to authenticated
  with check (public.is_admin() or public.is_super_admin() or public.is_logistic_pharmacist());

drop policy if exists "Admins can update drugs" on public.drugs;
create policy "Admins can update drugs"
  on public.drugs for update
  to authenticated
  using (public.is_admin() or public.is_super_admin() or public.is_logistic_pharmacist())
  with check (public.is_admin() or public.is_super_admin() or public.is_logistic_pharmacist());

-- No function or RPC signature changed in this file — the repo-wide rule
-- that a migration touching a function/RPC ends with a schema-cache reload
-- does not, strictly, apply here. It is issued anyway because the new
-- column must be visible in PostgREST's cached schema before
-- supabase-js selects/inserts/updates against drugs.unit_price will work,
-- and because policy changes on an already-exposed table are cheap to
-- resync at the same time. See the report for full reasoning.
notify pgrst, 'reload schema';
