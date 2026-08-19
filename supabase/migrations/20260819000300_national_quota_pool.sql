-- Logistic pharmacist HQ role, step 5: controlled-drug quotas become a single
-- NATIONAL pool held by the HQ clinic, consumed by every clinic together.
--
-- Until now every clinic held its own drug_quotas row and its own usage count:
-- a limit of 100 across two clinics meant 200 patients could be enrolled. PKDJB
-- allocates one annual figure per drug for the whole district, so the limit,
-- the usage count, and the insert-time enforcement all move from per-clinic to
-- national in this migration.
--
-- Depends on:
--   20260819000010_hq_clinic.sql        — public.hq_clinic_id()
--   20260819000100_logistic_role_helpers.sql — public.is_logistic_pharmacist()
--   20260727000000_drug_quota_patients.sql   — the functions rewritten below
--
-- Nothing here changes the *shape* of drug_quotas, drug_quota_patients or
-- dispensing_requests. It changes which rows enforcement reads.

-- ── 1. Guard: per-clinic limits must not disagree before they are collapsed ──
-- Collapsing N per-clinic rows into one national row is only well defined when
-- every clinic already carries the same quota_limit for that (drug_id, year).
-- Today only KK Kempas has rows, so this is expected to be a no-op — but if a
-- second clinic ever seeded a *different* limit, silently keeping one of them
-- would quietly change that clinic's allowance with no trace. Fail loudly
-- instead, naming the clinics and the limits, so a human decides.
do $$
declare
  v_conflicts text;
begin
  if public.hq_clinic_id() is null then
    raise exception
      'No HQ clinic found (clinics.is_hq). Run 20260819000010_hq_clinic.sql first.';
  end if;

  select string_agg(
           format('drug_id %s / year %s -> %s', x.drug_id, x.year, x.detail),
           '; ' order by x.drug_id, x.year)
    into v_conflicts
  from (
    select q.drug_id,
           q.year,
           string_agg(format('%s = %s', c.name, q.quota_limit), ', ' order by c.name)
             as detail
    from public.drug_quotas q
    join public.clinics c on c.id = q.clinic_id
    where q.clinic_id is distinct from public.hq_clinic_id()
    group by q.drug_id, q.year
    having count(distinct q.quota_limit) > 1
  ) x;

  if v_conflicts is not null then
    -- RAISE uses % as its only placeholder; v_conflicts already carries the
    -- clinic names and their disagreeing limits.
    raise exception
      'Cannot collapse drug_quotas into a national pool: clinics disagree on quota_limit for the same (drug_id, year): %',
      v_conflicts;
  end if;
end $$;

-- ── 2. Migrate existing per-clinic rows onto the HQ clinic ──────────────────
-- One HQ row per (drug_id, year) carrying that year's quota_limit and
-- alert_threshold_pct. quota_limit is unambiguous by construction (guard
-- above). alert_threshold_pct is not guarded — it only controls when a warning
-- badge turns amber, never whether a request is allowed — so the *earliest*
-- warning wins (alert_threshold_pct is "percent remaining that triggers the
-- warning", so a higher value warns sooner: max() is the conservative pick).
--
-- INSERT ... SELECT from the same table is safe: the SELECT reads the
-- pre-statement snapshot, so newly inserted HQ rows cannot feed back into it.
-- drug_quotas carries trg_stamp_clinic_id, whose auth.uid() is null branch
-- (20260727000000 section 3) passes a caller-supplied clinic_id through
-- untouched — which is what a migration running as `postgres` gets.
insert into public.drug_quotas (clinic_id, drug_id, year, quota_limit, alert_threshold_pct)
select public.hq_clinic_id(),
       q.drug_id,
       q.year,
       max(q.quota_limit),
       max(q.alert_threshold_pct)
from public.drug_quotas q
where q.clinic_id is distinct from public.hq_clinic_id()
group by q.drug_id, q.year
on conflict (clinic_id, drug_id, year) do update
  set quota_limit         = excluded.quota_limit,
      alert_threshold_pct = excluded.alert_threshold_pct,
      updated_at          = now();

-- The old per-clinic rows are deliberately NOT deleted: they are the rollback
-- path if the national pool has to be reverted. They are also, from this
-- migration on, dead data — nothing reads them.
comment on table public.drug_quotas is
  'Annual patient quota per controlled drug. As of '
  '20260819000300_national_quota_pool.sql the quota is a single NATIONAL pool: '
  'enforcement (enforce_dispensing_request_limits) and reporting '
  '(get_drug_quota_usage) read ONLY the row whose clinic_id = hq_clinic_id(), '
  'and usage is counted across every clinic. Rows for non-HQ clinics are '
  'pre-migration data retained solely as a rollback path — they are never '
  'read, so editing one has no effect on what any clinic may request.';

-- ── 3. drug_quota_used(): national, not per clinic ─────────────────────────
-- Signature is unchanged so no caller has to move in this migration, but
-- p_clinic_id is now IGNORED: "how much of this drug's quota is used" is a
-- national question and must return the same number whichever clinic asks.
--
-- The two halves keep their original meaning from 20260727000000 section 5,
-- widened from one clinic to all, and de-duplicated by person on BOTH halves:
--   enrolments contribute one kuota per digits-only IC across every clinic
--   (max() where a person is enrolled at more than one clinic — see below);
--   dispensing_requests contribute only digits-only ICs that are not already
--   enrolled *anywhere*, so a patient enrolled at clinic A who is requested
--   for at clinic B does not consume a second national slot.
-- A person therefore consumes at most one slot no matter how many clinics
-- know them, which is what "one national pool of patients" means.
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
    -- One row per PERSON, not per enrolment row. patient_registry is unique on
    -- (clinic_id, no_ic), so the same human legitimately holds a separate
    -- patient_registry row — and therefore a separate enrolment — at every
    -- clinic that treats them. Under a national pool that is still ONE slot for
    -- that person, so the per-clinic kuota values are collapsed by normalized
    -- IC rather than summed; summing them would inflate `used` by one for every
    -- extra clinic a patient is registered at.
    --
    -- max() is the right collapse, not min() or sum():
    --   • a suspended enrolment (kuota = 0, "x AKTIF") at one clinic must not
    --     erase an active slot (kuota = 1) the same person holds at another;
    --   • a merged-duplicate enrolment (kuota > 1) keeps its intended weight.
    -- This mirrors the dedupe the `dispensed` half below already does, so both
    -- halves now count a person at most once.
    select regexp_replace(pr.no_ic, '\D', '', 'g') as ic,
           max(dqp.kuota) as kuota
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
  'For the per-clinic breakdown use get_quota_usage_by_clinic().';

-- ── 4. get_drug_quota_usage(): one row per drug, sourced from the HQ row ────
-- Return shape is UNCHANGED (same column names, types and order), so the
-- generated TypeScript type and every existing caller keep compiling. clinic_id
-- is retained but is now always hq_clinic_id() rather than the caller's clinic —
-- keeping the column is what allows `create or replace` here at all (changing a
-- returns-table shape would need a drop + recreate, invalidating dependents).
--
-- Two behavioural changes:
--   • rows come only from the HQ clinic's drug_quotas — one row per (drug, year);
--   • the `q.clinic_id = user_clinic_id()` visibility filter is GONE. It has to
--     be: the pool is shared, so a KK Kempas pharmacist must be able to see how
--     much of the national allowance is left even though the limit row belongs
--     to HQ. The function exposes limits and counts only, never patient data.
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
         u.used,
         q.quota_limit - u.used as remaining
  from public.drug_quotas q
  cross join lateral (
    -- lateral so drug_quota_used() is evaluated once per row rather than twice
    -- (once for `used`, once inside `remaining`) as it was before.
    select public.drug_quota_used(q.clinic_id, q.drug_id, q.year) as used
  ) u
  where q.year = coalesce(p_year, extract(year from now())::int)
    and q.clinic_id = public.hq_clinic_id();
$$;

grant execute on function public.get_drug_quota_usage(integer) to authenticated;

-- ── 5. get_quota_usage_by_clinic(): who consumed the national pool ─────────
-- Powers the HQ dashboard's expandable per-drug breakdown. Callable by any
-- authenticated user: it returns clinic names and integer counts, no patient
-- data of any kind, and a clinic seeing that it holds 40 of a national 100 is
-- the point of pooling. No page other than the HQ dashboard consumes it today
-- (grep: no call sites in src/ or supabase/functions/), so no FMS/pharmacist
-- page is broken by a tighter guard later if one is ever wanted —
-- is_super_admin() or is_logistic_pharmacist() is the pattern to narrow to.
--
-- Each unit of national usage is attributed to exactly ONE clinic, so these
-- rows sum back to drug_quota_used() for the same (drug, year):
--   • an enrolment's kuota belongs to the clinic that enrolled the patient;
--   • an IC that reached a slot through a request instead belongs to the
--     clinic that requested it FIRST — otherwise the same patient requested
--     for at two clinics would be billed to both and the breakdown would
--     over-count relative to the national total it is breaking down.
create or replace function public.get_quota_usage_by_clinic(p_year integer default null)
returns table (
  clinic_id   uuid,
  clinic_name text,
  drug_id     uuid,
  year        integer,
  used        integer
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select coalesce(p_year, extract(year from now())::int) as y
  ),
  enrolled_rows as (
    select dqp.clinic_id,
           dqp.drug_id,
           regexp_replace(pr.no_ic, '\D', '', 'g') as ic,
           dqp.kuota,
           dqp.created_at
    from public.drug_quota_patients dqp
    join public.patient_registry pr on pr.id = dqp.patient_id
    cross join params p
    where dqp.year = p.y
  ),
  -- One row per (drug, person), matching the same collapse drug_quota_used()
  -- applies: a person enrolled at several clinics still holds ONE national
  -- slot, worth max(kuota). That single slot is attributed to the clinic
  -- holding the winning enrolment (highest kuota, earliest enrolment on a
  -- tie) — the enrolment-side counterpart of the "first clinic to request
  -- wins" rule used for `dispensed` below. Without this the breakdown would
  -- bill the same person to every clinic that enrolled them and would no
  -- longer sum to the national total it is breaking down.
  enrolled as (
    select distinct on (er.drug_id, er.ic)
           er.clinic_id,
           er.drug_id,
           er.ic,
           er.kuota
    from enrolled_rows er
    order by er.drug_id, er.ic, er.kuota desc, er.created_at
  ),
  dispensed as (
    select distinct on (dr.drug_id, regexp_replace(dr.no_ic, '\D', '', 'g'))
           dr.drug_id,
           regexp_replace(dr.no_ic, '\D', '', 'g') as ic,
           dr.clinic_id
    from public.dispensing_requests dr
    cross join params p
    where dr.is_pesara = false
      and dr.status <> 'rejected'
      and dr.created_at >= make_date(p.y, 1, 1)
      and dr.created_at <  make_date(p.y + 1, 1, 1)
    order by dr.drug_id,
             regexp_replace(dr.no_ic, '\D', '', 'g'),
             dr.created_at
  ),
  contributions as (
    select e.clinic_id, e.drug_id, e.kuota as units
    from enrolled e
    union all
    select d.clinic_id, d.drug_id, 1 as units
    from dispensed d
    where not exists (
      select 1 from enrolled e
      where e.drug_id = d.drug_id and e.ic = d.ic
    )
  )
  select ct.clinic_id,
         c.name as clinic_name,
         ct.drug_id,
         coalesce(p_year, extract(year from now())::int) as year,
         sum(ct.units)::int as used
  from contributions ct
  join public.clinics c on c.id = ct.clinic_id
  group by ct.clinic_id, c.name, ct.drug_id
  having sum(ct.units) > 0;
$$;

grant execute on function public.get_quota_usage_by_clinic(integer) to authenticated;

comment on function public.get_quota_usage_by_clinic(integer) is
  'Per-clinic breakdown of the national quota pool for a year. Sums to '
  'drug_quota_used() per (drug, year). Counts only — contains no patient data.';

-- ── 6. enforce_dispensing_request_limits(): national gate + race guard ─────
-- Rewritten from 20260727000000 section 6. Four changes, nothing else:
--
--   a) ADVISORY LOCK, taken as the very first statement of the function —
--      before the drugs lookup, before the drug_quotas SELECT, and before
--      drug_quota_used() counts anything. This is the whole point of the lock:
--      two concurrent inserts for the same drug both used to read used = N,
--      both pass N < limit, and both commit, taking the pool to N+2 over a
--      limit of N+1. MVCC cannot prevent this — neither transaction can see
--      the other's uncommitted row — so the check-then-act has to be
--      serialized explicitly. Taking it *after* either read would leave the
--      exact window it exists to close. It is an xact lock, so it is released
--      on commit/rollback with no unlock path to forget.
--      Cost of taking it before the is_blocked/is_pesara branches: a pesara or
--      blocked-drug insert briefly serializes against other inserts for the
--      same drug. dispensing_requests is a human-paced table; correctness of
--      the ordering is worth more than that contention.
--      hashtext() is 32-bit, so two different (drug, year) keys can collide.
--      A collision only makes two unrelated drugs queue behind each other —
--      it can never let an over-limit insert through.
--
--   b) The quota LIMIT is read from the HQ clinic's row, not new.clinic_id.
--
--   c) USAGE is national. Both the "does this patient already hold a slot"
--      probe and the count itself drop their clinic_id predicates. The probe
--      has to move too: under a shared pool a patient enrolled at clinic A
--      already occupies a national slot, so a request for them at clinic B
--      adds nothing to the total and must not be refused when the pool is
--      full. Leaving the probe clinic-scoped would reject exactly those
--      patients while their slot sat counted against the limit.
--
--   d) FAIL CLOSED when hq_clinic_id() is NULL. See the inline comment — a
--      missing HQ clinic would otherwise turn the `v_quota_limit is not null`
--      guard into a silent global disable of quota enforcement.
--
-- is_pesara = false, status <> 'rejected' and the calendar-year window are
-- untouched, as is the raise message text and the `if v_quota_limit is not
-- null` guard (no HQ row for a drug = no quota = unlimited, as before).
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
  -- (a) Serialize every concurrent insert for this (drug, year) before any
  --     quota read below. Must stay the first statement in this function.
  perform pg_advisory_xact_lock(hashtext(new.drug_id::text || ':' || v_year::text));

  -- Fail closed if the HQ clinic is missing. hq_clinic_id() reads
  -- clinics.is_hq, which a super_admin can clear at any time. If it returns
  -- NULL the limit SELECT below matches no row, v_quota_limit stays NULL, and
  -- the `if v_quota_limit is not null` guard skips enforcement entirely —
  -- silently making EVERY controlled drug unlimited nationally, with no error
  -- and nothing in the logs. An unconfigured HQ clinic is a broken deployment,
  -- so refuse the write rather than quietly stop enforcing. Deliberately
  -- placed before the is_blocked/is_pesara branches: a pesara request does not
  -- consult the quota and is collateral here, but a deployment in this state
  -- needs to surface loudly and immediately, not on the first non-pesara
  -- request that happens along.
  if public.hq_clinic_id() is null then
    raise exception 'National HQ clinic is not configured — controlled-drug quota cannot be enforced';
  end if;

  select is_blocked into v_blocked from public.drugs where id = new.drug_id;
  if v_blocked then
    raise exception 'This drug is blocked by admin and cannot be requested';
  end if;

  if not new.is_pesara then
    -- (b) national limit: the HQ clinic's row is the only one enforcement reads
    select quota_limit into v_quota_limit
    from public.drug_quotas
    where drug_id = new.drug_id
      and clinic_id = public.hq_clinic_id()
      and year = v_year;

    if v_quota_limit is not null then
      -- (c) does this IC already hold a national slot, at ANY clinic?
      select exists (
        select 1
        from public.drug_quota_patients dqp
        join public.patient_registry pr on pr.id = dqp.patient_id
        where dqp.drug_id = new.drug_id
          and dqp.year    = v_year
          and regexp_replace(pr.no_ic, '\D', '', 'g')
            = regexp_replace(new.no_ic, '\D', '', 'g')
        union all
        select 1
        from public.dispensing_requests dr
        where dr.drug_id   = new.drug_id
          and dr.is_pesara = false
          and dr.status <> 'rejected'
          and dr.created_at >= make_date(v_year, 1, 1)
          and dr.created_at <  make_date(v_year + 1, 1, 1)
          and regexp_replace(dr.no_ic, '\D', '', 'g')
            = regexp_replace(new.no_ic, '\D', '', 'g')
      ) into v_already;

      if not v_already then
        -- p_clinic_id is ignored by drug_quota_used() now; new.clinic_id is
        -- passed only to keep the call site unchanged.
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

-- Trigger itself is unchanged (trg_zz_enforce_dispensing_request_limits, BEFORE
-- INSERT, defined in 20260724000200) — only the function body is replaced.

notify pgrst, 'reload schema';
