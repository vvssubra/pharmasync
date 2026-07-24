-- Fixes 3 privilege-escalation gaps found in a full security audit of the
-- clinic-scoped tables. Each was previously fenced by clinic_id only — any
-- authenticated member of a clinic (including an MO) could act as pharmacist
-- or specialist purely by writing to PostgREST directly, since client-side
-- role gating (ProtectedRoute, disabled buttons) does not deny the write.

-- ── 0. is_fms() helper, matching the existing is_admin()/is_pharmacist() pattern ──
create or replace function public.is_fms()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'fms'
  );
$$;

-- ── 1. transactions: only staff who dispense/receive stock may write ───────
-- Every insert site in the app (Terimaan, PharmacistFulfilment,
-- DrugQuotaDialog/DrugFormDialog opening balance, PatientRegistry,
-- ReplenishQuotaDialog) runs as admin or pharmacist — those are also the only
-- two roles ProtectedRoute grants /terimaan, /fulfilment, /pesakit, /drugs to.
-- MO and FMS never insert a transaction in the UI; previously nothing in the
-- database stopped either from doing so directly, which lets an MO dispense
-- (including a perlu_kelulusan_pakar controlled drug) without ever going
-- through dispensing_requests, specialist approval, or quota checks.
drop policy if exists "Clinic-scoped insert transactions" on public.transactions;
create policy "Clinic-scoped insert transactions" on public.transactions
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and (public.is_admin() or public.is_pharmacist()))
  );

-- ── 2. dispensing_requests: MO may submit, not decide ───────────────────────
-- The only UPDATE policy checked clinic_id, so the MO who submitted a request
-- (FOR UPDATE has no notion of "am I the original submitter" restriction
-- anyway — this is a blanket clinic check) could set status to
-- 'pending_pharmacy'/'approved' and stamp their own specialist_id, self-
-- approving a controlled-drug request. admin/fms/pharmacist are all
-- legitimate writers here (FmsDashboard and SpecialistDashboard, both
-- reachable by fms and, per ProtectedRoute, admin/pharmacist too;
-- PharmacistFulfilment for fulfil/reject/defer). MO is excluded — the app
-- never updates a dispensing_request from the MO role.
drop policy if exists "Clinic-scoped update dispensing_requests" on public.dispensing_requests;
create policy "Clinic-scoped update dispensing_requests" on public.dispensing_requests
  for update to authenticated
  using (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and (public.is_admin() or public.is_pharmacist() or public.is_fms()))
  )
  with check (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and (public.is_admin() or public.is_pharmacist() or public.is_fms()))
  );

-- ── 3. antibiotic_forms: same self-approval gap ─────────────────────────────
-- Submitted by MO (AntibioticForm.tsx), decided by fms/admin (FmsDashboard,
-- SpecialistDashboard), acknowledged by pharmacist (PharmacistFulfilment).
-- MO is excluded for the same reason as above.
drop policy if exists "Clinic-scoped update antibiotic_forms" on public.antibiotic_forms;
create policy "Clinic-scoped update antibiotic_forms" on public.antibiotic_forms
  for update to authenticated
  using (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and (public.is_admin() or public.is_pharmacist() or public.is_fms()))
  )
  with check (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and (public.is_admin() or public.is_pharmacist() or public.is_fms()))
  );

-- ── 4. dispensing_requests: quota + block enforced server-side ─────────────
-- DoctorRequest.tsx's onSubmit guard (adminBlocked / quotaInfo.exhausted) is
-- the only place either was checked — nothing stopped an insert straight to
-- PostgREST from a blocked drug or past its annual quota. Mirrors the client
-- calculation exactly: quota usage = non-pesara requests this clinic, this
-- calendar year, with status != 'rejected'.
--
-- Runs after trg_stamp_clinic_id (same BEFORE INSERT event, alphabetically
-- later trigger name), so NEW.clinic_id is already the caller's clinic.
create or replace function public.enforce_dispensing_request_limits()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_blocked boolean;
  v_quota_limit integer;
  v_used integer;
begin
  select is_blocked into v_blocked from public.drugs where id = new.drug_id;
  if v_blocked then
    raise exception 'This drug is blocked by admin and cannot be requested';
  end if;

  if not new.is_pesara then
    select quota_limit into v_quota_limit
    from public.drug_quotas
    where drug_id = new.drug_id
      and clinic_id = new.clinic_id
      and year = extract(year from now());

    if v_quota_limit is not null then
      select count(*) into v_used
      from public.dispensing_requests
      where drug_id = new.drug_id
        and clinic_id = new.clinic_id
        and is_pesara = false
        and status <> 'rejected'
        and created_at >= date_trunc('year', now())
        and created_at < date_trunc('year', now()) + interval '1 year';

      if v_used >= v_quota_limit then
        raise exception 'Annual quota exhausted for this drug';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_zz_enforce_dispensing_request_limits on public.dispensing_requests;
create trigger trg_zz_enforce_dispensing_request_limits
  before insert on public.dispensing_requests
  for each row execute function public.enforce_dispensing_request_limits();
