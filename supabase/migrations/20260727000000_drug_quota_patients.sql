-- KK Kempas controlled-drug quota import — schema.
-- Adds a per-patient, per-drug enrolment register (drug_quota_patients),
-- widens drug_quotas to be per-clinic (it was accidentally global), and
-- makes quota usage a single server-side source of truth shared by every
-- page that shows "remaining quota" and by the insert-time enforcement
-- trigger on dispensing_requests.

-- ── 1. Widen drug_quotas uniqueness to (clinic_id, drug_id, year) ──────────
-- Today's UNIQUE(drug_id, year) is global, which makes it impossible for
-- two clinics to hold different quotas for the same drug (e.g. Novomix is
-- 100 at KK Kempas but 50 at KK Larkin). Widening a unique constraint can
-- never fail against existing data — the old key was strictly narrower.
alter table public.drug_quotas
  drop constraint if exists drug_quotas_drug_id_year_key;

alter table public.drug_quotas
  add constraint drug_quotas_clinic_drug_year_key unique (clinic_id, drug_id, year);

-- ── 2. Per-clinic patient IC uniqueness ─────────────────────────────────────
-- patient_registry.no_ic was UNIQUE globally. Only one clinic exists today
-- so this is latent, but an ON CONFLICT (no_ic) DO UPDATE from a future
-- clinic's seed could silently rename another clinic's patient. Widen now.
alter table public.patient_registry
  drop constraint if exists patient_registry_no_ic_key;

alter table public.patient_registry
  add constraint patient_registry_clinic_no_ic_key unique (clinic_id, no_ic);

-- ── 3. Make stamp_clinic_id() usable from a superuser session ──────────────
-- The data-seed migration runs as `postgres` in the Coolify terminal, where
-- auth.uid() is NULL. Previously that made user_clinic_id() return NULL,
-- and the BEFORE INSERT trigger would stamp NULL into a NOT NULL clinic_id
-- column, failing every insert. RLS is not the obstacle here (a superuser
-- bypasses it) — the trigger is. When there is no JWT at all, trust the
-- caller-supplied clinic_id; every PostgREST request always carries
-- auth.uid(), so this cannot be used to spoof a clinic from the client.
create or replace function public.stamp_clinic_id()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    if new.clinic_id is null then
      raise exception 'clinic_id must be supplied when inserting without an authenticated session';
    end if;
    return new;
  end if;

  if public.is_super_admin() then
    new.clinic_id := coalesce(new.clinic_id, public.user_clinic_id());
  else
    new.clinic_id := public.user_clinic_id();
  end if;
  return new;
end;
$$;

-- ── 4. drug_quota_patients ───────────────────────────────────────────────────
-- One row per (patient, drug, year) enrolment in the annual quota register.
-- patient_registry stays one row per person; a patient on both Novomix and
-- Levemir gets two rows here.
create table public.drug_quota_patients (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references public.patient_registry(id) on delete cascade,
  drug_id              uuid not null references public.drugs(id) on delete cascade,
  clinic_id            uuid not null default public.user_clinic_id()
                            references public.clinics(id),
  year                 integer not null default extract(year from now())::int
                            check (year >= 2024),
  source_bil           integer,                 -- Excel "BIL" — preserves original sheet order
  tarikh_mula_rawatan  date,
  status               text not null default 'AKTIF',
  dosing               text,
  fms_name             text,
  catatan              text,
  kuota                integer not null default 1 check (kuota >= 0),
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint drug_quota_patients_uniq unique (clinic_id, drug_id, year, patient_id)
);

comment on column public.drug_quota_patients.kuota is
  'Quota units this enrolment consumes. Normally 1. 0 = suspended/inactive '
  '("x AKTIF" in the source register) — still holds the slot, consumes none. '
  '>1 = duplicate source rows for the same IC merged into one enrolment.';

create index idx_dqp_patient on public.drug_quota_patients (patient_id);
create index idx_dqp_drug_year on public.drug_quota_patients (drug_id, year);

create trigger trg_stamp_clinic_id before insert on public.drug_quota_patients
  for each row execute function public.stamp_clinic_id();

create trigger update_drug_quota_patients_updated_at
  before update on public.drug_quota_patients
  for each row execute function public.update_updated_at_column();

alter table public.drug_quota_patients enable row level security;

create policy "Clinic-scoped view drug_quota_patients" on public.drug_quota_patients
  for select to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id());

-- Writer gate matches the transactions/drug_quotas pattern in
-- 20260724000200_security_writer_role_gates.sql: consuming a quota slot is
-- a dispensing act. FMS is a decision role on dispensing_requests, not a
-- writer here — it keeps SELECT only.
create policy "Clinic staff insert drug_quota_patients" on public.drug_quota_patients
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and (public.is_admin() or public.is_pharmacist()))
  );

create policy "Clinic staff update drug_quota_patients" on public.drug_quota_patients
  for update to authenticated
  using (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and (public.is_admin() or public.is_pharmacist()))
  )
  with check (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and (public.is_admin() or public.is_pharmacist()))
  );

create policy "Clinic staff delete drug_quota_patients" on public.drug_quota_patients
  for delete to authenticated
  using (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and (public.is_admin() or public.is_pharmacist()))
  );

-- ── 5. Single source of truth for "quota used" ──────────────────────────────
-- Enrolments contribute sum(kuota); dispensing_requests contribute only ICs
-- that are not already enrolled, so an MO request for an already-enrolled
-- patient never double-counts. Both sides are compared on digits-only IC:
-- dispensing_requests.no_ic is stored dash-formatted ("880101-01-5555") by
-- DoctorRequest.tsx, while patient_registry.no_ic is digits-only — comparing
-- the raw strings would never match and every enrolled patient's next
-- request would double-count.
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
           dqp.kuota
    from public.drug_quota_patients dqp
    join public.patient_registry pr on pr.id = dqp.patient_id
    where dqp.clinic_id = p_clinic_id
      and dqp.drug_id   = p_drug_id
      and dqp.year      = p_year
  ),
  dispensed as (
    select distinct regexp_replace(dr.no_ic, '\D', '', 'g') as ic
    from public.dispensing_requests dr
    where dr.clinic_id = p_clinic_id
      and dr.drug_id   = p_drug_id
      and dr.is_pesara = false
      and dr.status <> 'rejected'
      and dr.created_at >= make_date(p_year, 1, 1)
      and dr.created_at <  make_date(p_year + 1, 1, 1)
  )
  select coalesce((select sum(kuota) from enrolled), 0)::int
       + coalesce((select count(*) from dispensed d
                   where not exists (select 1 from enrolled e where e.ic = d.ic)), 0)::int;
$$;

grant execute on function public.drug_quota_used(uuid, uuid, integer) to authenticated;

-- Set-returning wrapper for the UI: one row per (clinic, drug, year) with
-- quota_limit/used/remaining computed together. security definer bypasses
-- RLS, so the clinic filter here is explicit rather than implied by a policy.
create or replace function public.get_drug_quota_usage(p_year integer default null)
returns table (
  clinic_id           uuid,
  drug_id             uuid,
  year                integer,
  quota_limit         integer,
  alert_threshold_pct integer,
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
         public.drug_quota_used(q.clinic_id, q.drug_id, q.year) as used,
         q.quota_limit - public.drug_quota_used(q.clinic_id, q.drug_id, q.year) as remaining
  from public.drug_quotas q
  where q.year = coalesce(p_year, extract(year from now())::int)
    and (public.is_super_admin() or q.clinic_id = public.user_clinic_id());
$$;

grant execute on function public.get_drug_quota_usage(integer) to authenticated;

-- ── 6. Rewrite the insert-time enforcement trigger to use drug_quota_used() ─
-- Previously counted only dispensing_requests via count(*), so once
-- enrolments exist it would think 0 of a drug's quota is used regardless of
-- how many patients are enrolled. Also corrects a real bug: a patient who
-- already holds a slot (via enrolment, or an earlier non-rejected request
-- this year) was refused a repeat request the moment the quota filled —
-- FmsDashboard/SpecialistDashboard already dedupe by IC when displaying
-- usage, so the trigger and the dashboards previously disagreed.
create or replace function public.enforce_dispensing_request_limits()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_blocked     boolean;
  v_quota_limit integer;
  v_used        integer;
  v_year        integer := extract(year from now())::int;
  v_already     boolean;
begin
  select is_blocked into v_blocked from public.drugs where id = new.drug_id;
  if v_blocked then
    raise exception 'This drug is blocked by admin and cannot be requested';
  end if;

  if not new.is_pesara then
    select quota_limit into v_quota_limit
    from public.drug_quotas
    where drug_id = new.drug_id and clinic_id = new.clinic_id and year = v_year;

    if v_quota_limit is not null then
      select exists (
        select 1
        from public.drug_quota_patients dqp
        join public.patient_registry pr on pr.id = dqp.patient_id
        where dqp.clinic_id = new.clinic_id
          and dqp.drug_id   = new.drug_id
          and dqp.year      = v_year
          and regexp_replace(pr.no_ic, '\D', '', 'g')
            = regexp_replace(new.no_ic, '\D', '', 'g')
        union all
        select 1
        from public.dispensing_requests dr
        where dr.clinic_id = new.clinic_id
          and dr.drug_id   = new.drug_id
          and dr.is_pesara = false
          and dr.status <> 'rejected'
          and dr.created_at >= make_date(v_year, 1, 1)
          and dr.created_at <  make_date(v_year + 1, 1, 1)
          and regexp_replace(dr.no_ic, '\D', '', 'g')
            = regexp_replace(new.no_ic, '\D', '', 'g')
      ) into v_already;

      if not v_already then
        v_used := public.drug_quota_used(new.clinic_id, new.drug_id, v_year);
        if v_used >= v_quota_limit then
          raise exception 'Annual quota exhausted for this drug';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
