-- 15-clinic scaling, P3 migration B: blocking semantics, national reset,
-- drugs write narrowing. All three in one transaction — either ordering
-- alone leaves a window where a controlled drug is requestable that
-- shouldn't be (rewrite enforcement before resetting the national flag, or a
-- moment between reset and narrowing where any of 15 admins could re-set it
-- on the shared row before clinic_drug_settings is the only local lever).
--
-- Depends on 20260821000100_clinic_drug_settings.sql (this clinic, this
-- drug's local block) and 20260819000300_national_quota_pool.sql (the
-- function being rewritten here).

-- ── 1. enforce_dispensing_request_limits(): local block joins the national one ──
-- Changes ONLY the block branch (originally lines 402-408 of
-- 20260819000300_national_quota_pool.sql, this file's section 6). Advisory
-- lock, hq_clinic_id() fail-closed guard, national quota read, national
-- v_already probe, is_pesara, status and year window are reproduced
-- byte-for-byte from that migration — nothing else in this function changes.
--
-- new.clinic_id is used for the local-block lookup, not user_clinic_id():
-- new.clinic_id is already stamped by trg_stamp_clinic_id before this
-- trigger fires, and using it (rather than re-deriving from the caller) is
-- what makes a super_admin inserting on a clinic's behalf scope to THAT
-- clinic's local block rather than the super_admin's own (none).
--
-- Distinct error messages for national vs local — the old single message
-- ("This drug is blocked by admin and cannot be requested") sent an MO to
-- argue with their own clinic admin over a national MOH withdrawal, or vice
-- versa, neither of whom could do anything about the other's block.
--
-- PL/pgSQL footgun: `select is_blocked into v into a variable` leaves that
-- variable NULL when the SELECT matches zero rows — a clinic with no
-- clinic_drug_settings row yet (not backfilled, or a clinic created after
-- Migration A) is exactly that case. Coalescing inside the SELECT list
-- would not help (the expression never runs against zero rows), so the
-- coalesce happens as a separate statement AFTER the SELECT.
create or replace function public.enforce_dispensing_request_limits()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_national_blocked boolean;
  v_local_blocked    boolean;
  v_controlled  boolean;
  v_quota_limit integer;
  v_used        integer;
  v_year        integer := extract(year from now())::int;
  v_already     boolean;
begin
  -- (a) Serialize every concurrent insert for this (drug, year) before any
  --     quota read below. Must stay the first statement in this function.
  perform pg_advisory_xact_lock(hashtext(new.drug_id::text || ':' || v_year::text));

  -- Fail closed if the HQ clinic is missing. See 20260819000300 section 6d
  -- for the full reasoning — unchanged here.
  if public.hq_clinic_id() is null then
    raise exception 'National HQ clinic is not configured — controlled-drug quota cannot be enforced';
  end if;

  select is_blocked, coalesce(perlu_kelulusan_pakar, false)
    into v_national_blocked, v_controlled
  from public.drugs where id = new.drug_id;

  if v_national_blocked then
    raise exception 'This drug has been withdrawn nationally and cannot be requested';
  end if;

  select is_blocked into v_local_blocked
  from public.clinic_drug_settings
  where clinic_id = new.clinic_id and drug_id = new.drug_id;
  v_local_blocked := coalesce(v_local_blocked, false);

  if v_local_blocked then
    raise exception 'This drug is blocked at your clinic and cannot be requested — contact your clinic admin';
  end if;

  -- (e) CONTROLLED drugs only. The national pool is a controlled-drug concept:
  --     the Logistik HQ dashboard only ever publishes rows for drugs requiring
  --     specialist approval, and the clinic-side dialogs only retire their
  --     editable quota field for those drugs. Enforcing on any drug that
  --     happens to carry a drug_quotas row would gate ordinary drugs on a
  --     number no HQ user manages — including the incidental quota_limit = 0
  --     rows DrugFormDialog used to write on every drug save, which would read
  --     as "nationally blocked". The row-migration step above applies the same
  --     filter, so these rows are not nationalized in the first place.
  if not new.is_pesara and v_controlled then
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

-- Trigger itself is unchanged (trg_zz_enforce_dispensing_request_limits,
-- BEFORE INSERT, defined in 20260724000200) — only the function body above
-- is replaced.

-- ── 2. Reset the national is_blocked flag ───────────────────────────────────
-- Every current true value was a Kempas admin pressing "Block" — local
-- intent recorded on the only column that existed, because
-- clinic_drug_settings did not. Migration A already copied every current
-- value onto Kempas's clinic_drug_settings row (backfill from drugs.is_blocked),
-- so Kempas's local state is unchanged by this reset. Leaving these true
-- would hand all 14 other clinics a block they did not set and, once section
-- 3 below narrows drugs writes to HQ, could no longer lift themselves.
do $$
declare
  r record;
begin
  for r in select drug_name from public.drugs where is_blocked loop
    raise notice 'Resetting national is_blocked for %: this was a clinic-level block recorded on the only column that existed — Migration A already copied it onto that clinic''s clinic_drug_settings row', r.drug_name;
  end loop;
end $$;

update public.drugs set is_blocked = false where is_blocked;

-- ── 3. Narrow drugs writes to HQ ─────────────────────────────────────────────
-- is_admin() carries no clinic term, so any of 15 clinic admins could rewrite
-- the shared drugs row — including clearing perlu_kelulusan_pakar (removing
-- specialist approval for a controlled drug system-wide) or re-setting the
-- national is_blocked flag section 2 above just cleared. Thresholds and local
-- blocking are now clinic_drug_settings, which every clinic admin still
-- writes (20260821000100 section 3) — this narrowing does not touch that.
--
-- Policies renamed (HQ can ... / was Admins can ...) since the capability
-- genuinely changed; old names dropped explicitly per this repo's drop+create
-- convention for policy redefinition.
drop policy if exists "Admins can insert drugs" on public.drugs;
drop policy if exists "HQ can insert drugs" on public.drugs;
create policy "HQ can insert drugs"
  on public.drugs for insert
  to authenticated
  with check (public.is_super_admin() or public.is_logistic_pharmacist());

drop policy if exists "Admins can update drugs" on public.drugs;
drop policy if exists "HQ can update drugs" on public.drugs;
create policy "HQ can update drugs"
  on public.drugs for update
  to authenticated
  using (public.is_super_admin() or public.is_logistic_pharmacist())
  with check (public.is_super_admin() or public.is_logistic_pharmacist());

notify pgrst, 'reload schema';
