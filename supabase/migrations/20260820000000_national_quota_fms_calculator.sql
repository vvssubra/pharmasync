-- Logistic pharmacist HQ role, follow-up: express the national quota as a
-- rate (fms_count x quota_per_fms) rather than a raw total an admin has to
-- compute by hand off-screen.
--
-- Depends on:
--   20260819000300_national_quota_pool.sql — drug_quotas.quota_limit is the
--                                             HQ clinic's national pool
--   20260819000400_logistic_access.sql      — set_national_drug_quota(),
--                                             drug_quota_audit
--
-- Nothing about enforcement changes: enforce_dispensing_request_limits() and
-- drug_quota_used() read drug_quotas.quota_limit exactly as before. This
-- migration only changes how that number gets WRITTEN — fms_count and
-- quota_per_fms are stored alongside it so the write path (and the edit
-- dialog) can show and adjust the two inputs instead of a single total, and
-- quota_limit is recomputed as their product on every write.
--
-- Both new drug_quotas columns are nullable and left NULL for existing rows:
-- the two controlled-drug quotas set before this migration (Insulin Detemir,
-- the Novomix combination) were entered as raw totals, not as an exact
-- fms_count x quota_per_fms division, so backfilling a guessed split would
-- misrepresent how those numbers were actually decided. They keep enforcing
-- on their existing quota_limit until someone re-saves them through the new
-- calculator.

-- ── 1. drug_quotas: fms_count, quota_per_fms ────────────────────────────────
alter table public.drug_quotas
  add column fms_count integer,
  add column quota_per_fms integer;

comment on column public.drug_quotas.fms_count is
  'Number of FMS (Family Medicine Specialist) units this drug''s national '
  'quota is allocated across. NULL on rows set before this column existed — '
  'quota_limit still enforces, it just was not entered as a rate.';

comment on column public.drug_quotas.quota_per_fms is
  'Annual patient quota allocated per FMS unit. quota_limit = fms_count * '
  'quota_per_fms, recomputed on every write by set_national_drug_quota().';

-- ── 2. drug_quota_audit: track the rate, not just the resulting total ──────
alter table public.drug_quota_audit
  add column old_fms_count integer,
  add column new_fms_count integer,
  add column old_quota_per_fms integer,
  add column new_quota_per_fms integer;

-- ── 3. set_national_drug_quota(): accepts the rate, computes the total ─────
-- Signature change (quota_limit param replaced by fms_count + quota_per_fms),
-- so this is a drop + create, not a create-or-replace — Postgres does not
-- allow changing a function's parameter list in place.
drop function if exists public.set_national_drug_quota(uuid, integer, integer, integer);

create or replace function public.set_national_drug_quota(
  p_drug_id             uuid,
  p_year                integer,
  p_fms_count           integer,
  p_quota_per_fms       integer,
  p_alert_threshold_pct integer default 20
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hq                  uuid;
  v_written              uuid;
  v_quota_limit          integer;
  v_old_limit            integer;
  v_old_threshold        integer;
  v_old_fms_count        integer;
  v_old_quota_per_fms    integer;
begin
  if not (public.is_logistic_pharmacist() or public.is_super_admin()) then
    raise exception 'Access denied: logistic pharmacist role required';
  end if;

  if p_drug_id is null or p_year is null then
    raise exception 'Drug and year are required';
  end if;

  if p_fms_count is null or p_fms_count < 0 then
    raise exception 'FMS count must be 0 or greater (got %)', p_fms_count;
  end if;

  if p_quota_per_fms is null or p_quota_per_fms < 0 then
    raise exception 'Quota per FMS must be 0 or greater (got %)', p_quota_per_fms;
  end if;

  if p_alert_threshold_pct is null
     or p_alert_threshold_pct < 0
     or p_alert_threshold_pct > 100 then
    raise exception 'Alert threshold must be between 0 and 100 (got %)', p_alert_threshold_pct;
  end if;

  if not exists (
    select 1 from public.drugs d
    where d.id = p_drug_id and coalesce(d.perlu_kelulusan_pakar, false)
  ) then
    raise exception
      'National quota applies to controlled drugs only. Mark this drug as requiring specialist approval first, or leave it without a quota.';
  end if;

  v_hq := public.hq_clinic_id();
  if v_hq is null then
    raise exception 'National HQ clinic is not configured — cannot set a national quota';
  end if;

  if not public.is_super_admin() and public.user_clinic_id() is distinct from v_hq then
    raise exception
      'Your profile must be assigned to the HQ clinic to set national quotas';
  end if;

  v_quota_limit := p_fms_count * p_quota_per_fms;

  select quota_limit, alert_threshold_pct, fms_count, quota_per_fms
    into v_old_limit, v_old_threshold, v_old_fms_count, v_old_quota_per_fms
  from public.drug_quotas
  where clinic_id = v_hq
    and drug_id   = p_drug_id
    and year      = p_year;

  insert into public.drug_quotas (
    clinic_id, drug_id, year, quota_limit, alert_threshold_pct,
    fms_count, quota_per_fms, created_by
  )
  values (
    v_hq, p_drug_id, p_year, v_quota_limit, p_alert_threshold_pct,
    p_fms_count, p_quota_per_fms, auth.uid()
  )
  on conflict (clinic_id, drug_id, year) do update
    set quota_limit         = excluded.quota_limit,
        alert_threshold_pct = excluded.alert_threshold_pct,
        fms_count           = excluded.fms_count,
        quota_per_fms       = excluded.quota_per_fms,
        updated_at          = now()
  returning clinic_id into v_written;

  if v_written is distinct from v_hq then
    raise exception
      'Quota write landed on clinic % instead of the HQ clinic % — refusing to write a quota nothing enforces',
      v_written, v_hq;
  end if;

  insert into public.drug_quota_audit (
    actor_id, drug_id, year,
    old_limit, new_limit,
    old_threshold_pct, new_threshold_pct,
    old_fms_count, new_fms_count,
    old_quota_per_fms, new_quota_per_fms
  )
  values (
    auth.uid(), p_drug_id, p_year,
    v_old_limit, v_quota_limit,
    v_old_threshold, p_alert_threshold_pct,
    v_old_fms_count, p_fms_count,
    v_old_quota_per_fms, p_quota_per_fms
  );
end;
$$;

comment on function public.set_national_drug_quota(uuid, integer, integer, integer, integer) is
  'Sole write path for the national controlled-drug quota pool. quota_limit '
  'is computed as fms_count * quota_per_fms and both are stored alongside it '
  'so the rate can be edited, not just the total. Upserts the HQ clinic''s '
  'drug_quotas row and records the change in drug_quota_audit. '
  'logistic_pharmacist/super_admin only. Set quota_per_fms = 0 to stop a '
  'drug; there is no delete variant, since a missing row means "no limit".';

revoke all on function public.set_national_drug_quota(uuid, integer, integer, integer, integer)
  from public, anon;
grant execute on function public.set_national_drug_quota(uuid, integer, integer, integer, integer)
  to authenticated;

-- ── 4. get_drug_quota_usage(): surface the rate alongside the total ────────
-- RETURNS TABLE shape change (two new columns), so drop + create like the
-- write-side function above.
drop function if exists public.get_drug_quota_usage(integer);

create or replace function public.get_drug_quota_usage(p_year integer default null)
returns table (
  clinic_id           uuid,
  drug_id             uuid,
  year                integer,
  quota_limit         integer,
  alert_threshold_pct integer,
  fms_count           integer,
  quota_per_fms       integer,
  used                integer,
  remaining           integer
)
language sql
stable
security definer
set search_path = public
as $$
  select q.clinic_id,
         q.drug_id,
         q.year,
         q.quota_limit,
         q.alert_threshold_pct,
         q.fms_count,
         q.quota_per_fms,
         u.used,
         q.quota_limit - u.used as remaining
  from public.drug_quotas q
  cross join lateral (
    select public.drug_quota_used(q.clinic_id, q.drug_id, q.year) as used
  ) u
  where q.year = coalesce(p_year, extract(year from now())::int)
    and q.clinic_id = public.hq_clinic_id();
$$;

grant execute on function public.get_drug_quota_usage(integer) to authenticated;

notify pgrst, 'reload schema';
