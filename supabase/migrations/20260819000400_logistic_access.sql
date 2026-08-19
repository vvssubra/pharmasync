-- Logistic pharmacist HQ role, step 6: the ONLY write path into the national
-- quota pool, its audit trail, and the cross-clinic read access the HQ role
-- needs to do its job.
--
-- Depends on:
--   20260819000010_hq_clinic.sql             — public.hq_clinic_id()
--   20260819000100_logistic_role_helpers.sql — public.is_logistic_pharmacist()
--   20260819000300_national_quota_pool.sql   — drug_quotas is now a national pool
--                                              held by the HQ clinic
--
-- Shape of the access this migration grants:
--   • READ  — logistic_pharmacist sees every clinic's rows on the five tables
--             it must reconcile against (quotas, requests, patients, history,
--             enrolments). Widened SELECT policies only.
--   • WRITE — exactly one entry point, set_national_drug_quota() below. NO
--             INSERT/UPDATE/DELETE policy is added for this role on ANY table
--             in this migration, so PostgREST writes from a logistic
--             pharmacist are refused and the RPC (with its role check, its
--             validation and its audit row) cannot be bypassed.
--             Section 4 also removes the pre-existing clinic-admin write
--             policies on drug_quotas, which since the national-pool migration
--             would have let any admin sitting in the HQ clinic edit the
--             national allocation directly — unvalidated and unaudited. After
--             this migration the only writers of drug_quotas are the RPC and a
--             super_admin break-glass path.

-- ── 1. drug_quota_audit ─────────────────────────────────────────────────────
-- Every change to a national quota limit, with its before/after values. The
-- national pool is the number that decides whether 15 clinics may enrol another
-- patient, so a silent edit must not be possible.
create table public.drug_quota_audit (
  id                 uuid primary key default gen_random_uuid(),
  actor_id           uuid references auth.users(id),
  drug_id            uuid references public.drugs(id),
  year               integer,
  old_limit          integer,
  new_limit          integer,
  old_threshold_pct  integer,
  new_threshold_pct  integer,
  created_at         timestamptz not null default now()
);

comment on table public.drug_quota_audit is
  'Append-only trail of national drug_quotas changes. Written exclusively by '
  'public.set_national_drug_quota() (security definer, so it bypasses the RLS '
  'below). old_* columns are NULL when the quota was created rather than edited.';

alter table public.drug_quota_audit enable row level security;

-- Deliberately SELECT only. No INSERT/UPDATE/DELETE policy exists on this
-- table for any role: the sole writer is the security definer RPC below, which
-- bypasses RLS on its own, so a client cannot forge, amend or erase an entry.
create policy "HQ can view drug_quota_audit" on public.drug_quota_audit
  for select to authenticated
  using (public.is_super_admin() or public.is_logistic_pharmacist());

create index idx_drug_quota_audit_drug_year on public.drug_quota_audit (drug_id, year);

-- ── 2. set_national_drug_quota(): the audited quota write path ──────────────
-- security definer because the caller (a logistic pharmacist) intentionally has
-- NO write policy on drug_quotas — this function is the gate, and the role check
-- on its first line is what stands in for the missing policy. Together with
-- section 4 this is the only writer of drug_quotas other than a super_admin
-- acting directly, which is the codebase-wide break-glass convention.
--
-- There is deliberately no delete/clear variant. Setting p_quota_limit := 0 is
-- how a drug is stopped: enforce_dispensing_request_limits() treats "no HQ row
-- for this drug" as "no limit at all", so DELETEing the row would silently
-- remove enforcement nationally rather than tighten it.
--
-- On trg_stamp_clinic_id (trigger created in 20260723000200:74-75 and still
-- active on drug_quotas; the LIVE function body is the third and latest
-- definition, 20260727000000_drug_quota_patients.sql:37-55, which only adds the
-- auth.uid() is null passthrough for superuser migrations and leaves the
-- overwrite below intact): that BEFORE INSERT trigger overwrites new.clinic_id with
-- public.user_clinic_id() for every caller who is not a super_admin, and
-- security definer does NOT change that — auth.uid() still resolves to the
-- human making the request. So a logistic pharmacist whose profile is not
-- attached to the HQ clinic would have this insert silently redirected onto
-- their own clinic's (dead, never-read) row. Both a pre-check and a post-check
-- below refuse that case loudly instead. Deployment requirement: the
-- logistic_pharmacist account's profiles.clinic_id must be the HQ clinic
-- ('Logistik PKDJB').
create or replace function public.set_national_drug_quota(
  p_drug_id             uuid,
  p_year                integer,
  p_quota_limit         integer,
  p_alert_threshold_pct integer default 20
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hq            uuid;
  v_written       uuid;
  v_old_limit     integer;
  v_old_threshold integer;
begin
  if not (public.is_logistic_pharmacist() or public.is_super_admin()) then
    raise exception 'Access denied: logistic pharmacist role required';
  end if;

  if p_drug_id is null or p_year is null then
    raise exception 'Drug and year are required';
  end if;

  if p_quota_limit is null or p_quota_limit < 0 then
    raise exception 'Quota limit must be 0 or greater (got %)', p_quota_limit;
  end if;

  if p_alert_threshold_pct is null
     or p_alert_threshold_pct < 0
     or p_alert_threshold_pct > 100 then
    raise exception 'Alert threshold must be between 0 and 100 (got %)', p_alert_threshold_pct;
  end if;

  -- Fail closed on a missing HQ clinic, matching
  -- enforce_dispensing_request_limits() (20260819000300 section 6d): with no HQ
  -- row there is no national pool to write to, and stamping the quota onto some
  -- other clinic would leave enforcement reading nothing.
  v_hq := public.hq_clinic_id();
  if v_hq is null then
    raise exception 'National HQ clinic is not configured — cannot set a national quota';
  end if;

  -- Pre-check for the stamp trigger described above. Gives a usable message
  -- instead of either a bare NOT NULL violation (profile with no clinic) or a
  -- write that lands on the wrong clinic.
  if not public.is_super_admin() and public.user_clinic_id() is distinct from v_hq then
    raise exception
      'Your profile must be assigned to the HQ clinic to set national quotas';
  end if;

  -- Old values for the audit row: NULL when this call creates the quota.
  select quota_limit, alert_threshold_pct
    into v_old_limit, v_old_threshold
  from public.drug_quotas
  where clinic_id = v_hq
    and drug_id   = p_drug_id
    and year      = p_year;

  -- Conflict target matches drug_quotas_clinic_drug_year_key, the unique
  -- constraint on (clinic_id, drug_id, year) added in 20260727000000 section 1
  -- and untouched by the national-pool migration.
  -- created_by mirrors drug_quota_audit.actor_id, and matches what the admin
  -- UI wrote on rows created before this RPC existed. It is deliberately NOT
  -- touched on the conflict path: it records who created the quota, while the
  -- audit table records who changed it since.
  insert into public.drug_quotas (clinic_id, drug_id, year, quota_limit, alert_threshold_pct, created_by)
  values (v_hq, p_drug_id, p_year, p_quota_limit, p_alert_threshold_pct, auth.uid())
  on conflict (clinic_id, drug_id, year) do update
    set quota_limit         = excluded.quota_limit,
        alert_threshold_pct = excluded.alert_threshold_pct,
        updated_at          = now()
  returning clinic_id into v_written;

  -- Post-check: RETURNING reports the row as it was actually written, i.e.
  -- after trg_stamp_clinic_id has had its say. If anything rewrote clinic_id
  -- away from HQ, the quota would not be the one enforcement reads — raise so
  -- the whole call (row and audit entry) rolls back rather than half-applying.
  if v_written is distinct from v_hq then
    raise exception
      'Quota write landed on clinic % instead of the HQ clinic % — refusing to write a quota nothing enforces',
      v_written, v_hq;
  end if;

  insert into public.drug_quota_audit (
    actor_id, drug_id, year,
    old_limit, new_limit,
    old_threshold_pct, new_threshold_pct
  )
  values (
    auth.uid(), p_drug_id, p_year,
    v_old_limit, p_quota_limit,
    v_old_threshold, p_alert_threshold_pct
  );
end;
$$;

comment on function public.set_national_drug_quota(uuid, integer, integer, integer) is
  'Sole write path for the national controlled-drug quota pool. Upserts the HQ '
  'clinic''s drug_quotas row and records the change in drug_quota_audit. '
  'logistic_pharmacist/super_admin only. Set quota_limit = 0 to stop a drug; '
  'there is no delete variant, since a missing row means "no limit".';

-- Functions are executable by PUBLIC by default; anon has no role and would be
-- refused by the check above, but narrowing the grant keeps the reachable
-- surface honest (same pattern as ai_rate_limit_hit in 20260728000000).
revoke all on function public.set_national_drug_quota(uuid, integer, integer, integer)
  from public, anon;
grant execute on function public.set_national_drug_quota(uuid, integer, integer, integer)
  to authenticated;

-- ── 3. Cross-clinic SELECT for the HQ role ──────────────────────────────────
-- A logistic pharmacist allocates one national pool across 15 clinics, so
-- clinic-scoped reads make the job impossible: they must see every clinic's
-- enrolments, requests and patients to know where the pool has gone.
--
-- Each policy below is the existing one from 20260723000200_tenancy_3_rls.sql
-- (drug_quota_patients: 20260727000000 section 4) with `or
-- public.is_logistic_pharmacist()` added to the USING clause and nothing else
-- changed. Before, on all five:
--     using (public.is_super_admin() or clinic_id = public.user_clinic_id())
-- After:
--     using (public.is_super_admin() or public.is_logistic_pharmacist()
--            or clinic_id = public.user_clinic_id())
--
-- No write policy is added for this role here or anywhere else: the INSERT,
-- UPDATE and DELETE policies on all five tables are left exactly as they are,
-- so a logistic pharmacist has no PostgREST write path to any of them and the
-- RPC above stays the only way a quota changes. (create or replace does not
-- exist for policies — drop + create is this repo's convention.)

drop policy if exists "Clinic-scoped view drug_quotas" on public.drug_quotas;
create policy "Clinic-scoped view drug_quotas" on public.drug_quotas
  for select to authenticated
  using (
    public.is_super_admin()
    or public.is_logistic_pharmacist()
    or clinic_id = public.user_clinic_id()
  );

drop policy if exists "Clinic-scoped view dispensing_requests" on public.dispensing_requests;
create policy "Clinic-scoped view dispensing_requests" on public.dispensing_requests
  for select to authenticated
  using (
    public.is_super_admin()
    or public.is_logistic_pharmacist()
    or clinic_id = public.user_clinic_id()
  );

drop policy if exists "Clinic-scoped view patient_registry" on public.patient_registry;
create policy "Clinic-scoped view patient_registry" on public.patient_registry
  for select to authenticated
  using (
    public.is_super_admin()
    or public.is_logistic_pharmacist()
    or clinic_id = public.user_clinic_id()
  );

drop policy if exists "Clinic-scoped view patient_drug_history" on public.patient_drug_history;
create policy "Clinic-scoped view patient_drug_history" on public.patient_drug_history
  for select to authenticated
  using (
    public.is_super_admin()
    or public.is_logistic_pharmacist()
    or clinic_id = public.user_clinic_id()
  );

drop policy if exists "Clinic-scoped view drug_quota_patients" on public.drug_quota_patients;
create policy "Clinic-scoped view drug_quota_patients" on public.drug_quota_patients
  for select to authenticated
  using (
    public.is_super_admin()
    or public.is_logistic_pharmacist()
    or clinic_id = public.user_clinic_id()
  );

-- ── 4. drug_quotas writes: super_admin only ─────────────────────────────────
-- The three write policies from 20260723000200_tenancy_3_rls.sql:147-167 (never
-- redefined since — grepped) let a clinic admin insert/update/delete any
-- drug_quotas row carrying their OWN clinic_id. That was correct while quotas
-- were per-clinic. It stopped being correct at 20260819000300, which made the
-- HQ clinic's row *the* national allocation for all 15 clinics: an admin whose
-- profile sits in the HQ clinic — exactly where section 2's deployment
-- requirement puts HQ staff — could then edit the national number straight
-- through PostgREST, with none of the RPC's validation and no audit row. That
-- defeats the entire purpose of drug_quota_audit, so the admin branch goes.
--
-- Note the clause being removed is an inline `exists (select 1 from
-- public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')`
-- ANDed with `clinic_id = public.user_clinic_id()`, not a call to
-- public.is_admin() — read from the source before editing.
--
-- Safe under this plan: Task 12 retires the clinic-facing controlled-drug
-- quota-write UI, and clinic admins were never meant to set a national figure.
-- super_admin keeps a direct, unaudited write as break-glass, consistent with
-- how that role is treated throughout this codebase (it already short-circuits
-- every clinic-scoping policy). Policies are renamed to stop advertising an
-- admin capability that no longer exists; the old names are dropped explicitly.
--
-- Before (all three, from 20260723000200):
--     public.is_super_admin()
--     or (clinic_id = public.user_clinic_id()
--         and exists (select 1 from public.user_roles ur
--                     where ur.user_id = auth.uid() and ur.role = 'admin'))
-- After (all three):
--     public.is_super_admin()
--
-- SELECT is untouched by this section — section 3 above already redefined it,
-- and reading a quota was never the concern.

drop policy if exists "Clinic admin can insert drug_quotas" on public.drug_quotas;
drop policy if exists "Super admin can insert drug_quotas" on public.drug_quotas;
create policy "Super admin can insert drug_quotas" on public.drug_quotas
  for insert to authenticated
  with check (public.is_super_admin());

-- No WITH CHECK, matching the shape of the policy being replaced. For a
-- predicate that reads no column of the row this is not a loosening: Postgres
-- defaults an UPDATE policy's WITH CHECK to its USING expression.
drop policy if exists "Clinic admin can update drug_quotas" on public.drug_quotas;
drop policy if exists "Super admin can update drug_quotas" on public.drug_quotas;
create policy "Super admin can update drug_quotas" on public.drug_quotas
  for update to authenticated
  using (public.is_super_admin());

drop policy if exists "Clinic admin can delete drug_quotas" on public.drug_quotas;
drop policy if exists "Super admin can delete drug_quotas" on public.drug_quotas;
create policy "Super admin can delete drug_quotas" on public.drug_quotas
  for delete to authenticated
  using (public.is_super_admin());

notify pgrst, 'reload schema';
