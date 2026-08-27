-- Patient status becomes the quota switch.
--
-- Until now `drug_quota_patients.status` was a free-text label copied out of
-- the source register and read by nobody: what a patient actually consumed was
-- `kuota` (0 = suspended, 1 = normal, >1 = merged duplicate rows). That left an
-- admin no way to say "this patient has stopped — give the slot back" short of
-- editing a number that is not on screen and whose other meaning (merge weight)
-- they would silently destroy.
--
-- After this migration status carries three values and TIDAK AKTIF is the one
-- that frees the slot. `kuota` keeps its merge-weight job untouched, so
-- reactivating a collapsed row restores the 2 it was worth rather than 1.
--
-- Depends on 20260819000300_national_quota_pool.sql (the function rewritten in
-- section 2) and 20260727000000_drug_quota_patients.sql (the table).

-- ── 1. Three statuses, and a backfill of the old encoding ──────────────────
-- kuota = 0 WAS the inactive flag ("x AKTIF" in the source register, per the
-- column comment), so those rows become TIDAK AKTIF regardless of what their
-- status text says. Their kuota stays 0 — section 2 returns 0 for them either
-- way, so this backfill does not move a single quota number.
update public.drug_quota_patients
   set status = case when kuota = 0 then 'TIDAK AKTIF' else 'AKTIF' end
 where status not in ('AKTIF', 'PENDING', 'TIDAK AKTIF')
    or (kuota = 0 and status <> 'TIDAK AKTIF');

alter table public.drug_quota_patients
  drop constraint if exists drug_quota_patients_status_chk;
alter table public.drug_quota_patients
  add constraint drug_quota_patients_status_chk
  check (status in ('AKTIF', 'PENDING', 'TIDAK AKTIF'));

comment on column public.drug_quota_patients.status is
  'AKTIF | PENDING | TIDAK AKTIF. TIDAK AKTIF releases the national quota slot '
  '(drug_quota_used() counts the enrolment as 0); AKTIF and PENDING both '
  'consume it. Only an admin or super_admin may set or change it — see '
  'enforce_quota_patient_status_writer().';

comment on column public.drug_quota_patients.kuota is
  'Quota units this enrolment consumes while its status is not TIDAK AKTIF. '
  'Normally 1. >1 = duplicate source rows for the same IC merged into one '
  'enrolment. 0 is the pre-20260827 way of saying inactive — status is that '
  'switch now, and those rows were backfilled to TIDAK AKTIF.';

-- ── 2. drug_quota_used(): TIDAK AKTIF consumes nothing ─────────────────────
-- Reproduced byte-for-byte from 20260819000300_national_quota_pool.sql section
-- 3 except for the max() expression in the `enrolled` CTE. Everything else —
-- the national scope, the p_clinic_id-is-ignored contract, the digits-only IC
-- collapse on both halves — is unchanged.
--
-- The case sits INSIDE max() rather than in a where clause, and that is the
-- whole design:
--   • an inactive enrolment contributes 0 but its IC stays in `enrolled`, so
--     the `dispensed` half still will not re-add that person. Marking someone
--     inactive frees the slot even while a non-rejected dispensing request of
--     theirs is on file this year — the deliberate rule, not an oversight. A
--     where-clause filter would drop the IC from `enrolled` entirely and the
--     dispensing request would immediately claim the slot back, which reads to
--     an admin as "the button did nothing".
--   • a person active at one clinic and inactive at another still holds one
--     slot, because max() picks the active 1 over the inactive 0. Same reason
--     the original chose max() over min() or sum().
create or replace function public.drug_quota_used(
  p_clinic_id uuid,
  p_drug_id   uuid,
  p_year      integer
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with enrolled as (
    select regexp_replace(pr.no_ic, '\D', '', 'g') as ic,
           max(case when dqp.status = 'TIDAK AKTIF' then 0 else dqp.kuota end) as kuota
    from public.drug_quota_patients dqp
    join public.patient_registry pr on pr.id = dqp.patient_id
    where dqp.drug_id = p_drug_id
      and dqp.year    = p_year
    group by regexp_replace(pr.no_ic, '\D', '', 'g')
  ),
  dispensed as (
    select distinct regexp_replace(dr.no_ic, '\D', '', 'g') as ic
    from public.dispensing_requests dr
    where dr.drug_id   = p_drug_id
      and dr.is_pesara = false
      and dr.status <> 'rejected'
      and dr.created_at >= make_date(p_year, 1, 1)
      and dr.created_at <  make_date(p_year + 1, 1, 1)
  )
  select coalesce((select sum(kuota) from enrolled), 0)::int
       + coalesce((select count(*) from dispensed d
                   where not exists (select 1 from enrolled e where e.ic = d.ic)), 0)::int;
$$;

comment on function public.drug_quota_used(uuid, uuid, integer) is
  'National quota consumption for (drug, year). p_clinic_id is retained for '
  'call-site compatibility and is ignored — usage is pooled across all clinics. '
  'Enrolments whose status is TIDAK AKTIF consume nothing but still hold their '
  'IC out of the dispensing-request half. For the per-clinic breakdown use '
  'get_quota_usage_by_clinic().';

-- ── 3. Only an admin may move a patient between statuses ───────────────────
-- RLS on this table grants UPDATE to admin AND pharmacist (20260727000000
-- section: "consuming a quota slot is a dispensing act"), which is right for
-- enrolling and dosing. Releasing a national slot is not that — it is an
-- allocation decision, so it is gated here rather than left to the UI hiding
-- the dropdown.
--
-- INSERT is gated too, and not out of symmetry: without it a pharmacist could
-- free a slot by inserting a fresh TIDAK AKTIF enrolment for an IC that is
-- currently counted through the dispensing-request half — the same effect as
-- the update this trigger refuses.
--
-- auth.uid() null means no end-user JWT: the service_role key, a migration, or
-- a psql session. Those already bypass RLS entirely, so refusing them here
-- would buy no safety and would break backfills like section 1 above.
create or replace function public.enforce_quota_patient_status_writer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_super_admin() or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status <> 'AKTIF' then
    raise exception 'Only an admin may enrol a patient as %', new.status
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    raise exception 'Only an admin may change a quota patient''s status'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_quota_patient_status_writer on public.drug_quota_patients;
create trigger trg_enforce_quota_patient_status_writer
  before insert or update on public.drug_quota_patients
  for each row execute function public.enforce_quota_patient_status_writer();
