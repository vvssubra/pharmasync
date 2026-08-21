-- 15-clinic scaling, P3 migration A: clinic_drug_settings table, RLS,
-- stamp trigger, backfill.
--
-- drugs.stok_min/stok_reorder/stok_max and drugs.is_blocked are shared
-- global columns today, so any of 15 clinic admins editing a threshold or
-- toggling the block flag would silently corrupt every other clinic's
-- dashboard. This table splits clinic-owned operational settings out from
-- the district formulary drugs keeps owning (identity, is_active,
-- perlu_kelulusan_pakar). drugs.stok_* columns are kept for this release
-- (keep-then-drop — the frontend deploys separately from this migration
-- and PWA service workers keep old bundles alive past both); a later
-- migration drops them once the app no longer reads them.
--
-- is_blocked here is LOCAL blocking only ("we don't stock it at this
-- clinic"). drugs.is_blocked remains the NATIONAL block (MOH withdrawal /
-- recall) — a later migration in this plan resets every drugs.is_blocked
-- currently true back to false, since today's true values are all a
-- Kempas admin's local intent recorded on the only column that existed.

-- ── 1. Table ─────────────────────────────────────────────────────────────
-- No created_by: a threshold row carries no authorship value worth adding
-- another BLOCKING_REFERENCES entry for admin-user-mgmt's account-deletion
-- preflight (index.ts:74-84) to know about.
--
-- No ordering CHECK (min <= reorder <= max): the client already enforces
-- it (DrugFormDialog.tsx:28-34), and a table CHECK would abort the
-- backfill below on any legacy drugs row that already violates it.
create table public.clinic_drug_settings (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id),
  drug_id       uuid not null references public.drugs(id),
  stok_min      integer not null default 0 check (stok_min >= 0),
  stok_reorder  integer not null default 0 check (stok_reorder >= 0),
  stok_max      integer not null default 0 check (stok_max >= 0),
  is_blocked    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint clinic_drug_settings_clinic_drug_key unique (clinic_id, drug_id)
);

comment on table public.clinic_drug_settings is
  'Per-clinic stock thresholds and local blocking, split out of the shared '
  'drugs table so one clinic admin cannot corrupt another clinic''s dashboard. '
  'No row for a (clinic_id, drug_id) pair means "use the defaults" — (0,0,0, '
  'false) — identical to a fresh drugs row''s own column defaults.';

create index idx_clinic_drug_settings_clinic on public.clinic_drug_settings (clinic_id);
create index idx_clinic_drug_settings_drug on public.clinic_drug_settings (drug_id);

-- ── 2. Triggers ──────────────────────────────────────────────────────────
-- public.stamp_clinic_id() (20260723000200 section 3) overwrites
-- new.clinic_id with the caller's own clinic for everyone except
-- super_admin. BEFORE ROW triggers fire before the ON CONFLICT arbiter, so
-- the stamped clinic_id is what conflict detection sees — the same reason
-- DrugFormDialog.tsx's drug_quotas upsert already omits clinic_id from its
-- payload.
create trigger trg_stamp_clinic_id before insert on public.clinic_drug_settings
  for each row execute function public.stamp_clinic_id();

create trigger update_clinic_drug_settings_updated_at
  before update on public.clinic_drug_settings
  for each row execute function public.update_updated_at_column();

-- ── 3. RLS ───────────────────────────────────────────────────────────────
alter table public.clinic_drug_settings enable row level security;

-- SELECT: super_admin, logistic_pharmacist (matching the cross-clinic read
-- grant 20260819000400 gave that role on the other clinic-scoped tables —
-- HQ reconciles across all 15 clinics), or the caller's own clinic.
create policy "Clinic-scoped view clinic_drug_settings" on public.clinic_drug_settings
  for select to authenticated
  using (
    public.is_super_admin()
    or public.is_logistic_pharmacist()
    or clinic_id = public.user_clinic_id()
  );

-- INSERT/UPDATE/DELETE: admin only, NOT logistic_pharmacist — HQ owns the
-- formulary (drugs), the clinic owns its own thresholds. The admin clause
-- is the inline exists(...) form copied from 20260819000600, not
-- public.is_admin(): reproducing the predicate text keeps this policy
-- independent of any future redefinition of that helper, exactly as
-- 20260819000600's own comment argues for drug_quotas.
create policy "Clinic admin can insert clinic_drug_settings" on public.clinic_drug_settings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  );

-- No WITH CHECK: Postgres defaults an UPDATE policy's WITH CHECK to its
-- USING expression, so an admin cannot move a row onto another clinic via
-- UPDATE either.
create policy "Clinic admin can update clinic_drug_settings" on public.clinic_drug_settings
  for update to authenticated
  using (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  );

create policy "Clinic admin can delete clinic_drug_settings" on public.clinic_drug_settings
  for delete to authenticated
  using (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  );

-- ── 4. Backfill ──────────────────────────────────────────────────────────
-- clinics CROSS JOIN drugs, carrying today's global values onto every
-- clinic. No ON CONFLICT: this table is empty three statements ago, so a
-- silent DO NOTHING here would only mask a repeated run of this migration
-- rather than protect anything real. Keeps the table dense so the "no row"
-- default branch is reachable only by clinics created after this point.
insert into public.clinic_drug_settings (clinic_id, drug_id, stok_min, stok_reorder, stok_max, is_blocked)
select c.id, d.id,
       coalesce(d.stok_min, 0),
       coalesce(d.stok_reorder, 0),
       coalesce(d.stok_max, 0),
       coalesce(d.is_blocked, false)
from public.clinics c
cross join public.drugs d;

notify pgrst, 'reload schema';
