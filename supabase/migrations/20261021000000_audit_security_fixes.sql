-- Security fixes from the 2026-10-21 audit.
--   1. approve_clinic_member could re-role any clinic-less user, including the
--      super_admin (clinic_id NULL by design) -> admin takeover.
--   7. "MO resubmits own rejected antibiotic form" had no clinic check, so an
--      MO could move a form (with patient IC) into another clinic's queue.
--  10. get_diagnosis_frequency (anon) returned free-text diagnoses with no
--      floor, so a one-off diagnosis with a typed name/IC leaked.
--  11. Stale "Pharmacists can view all user_roles" policy exposed every
--      clinic's roles; the clinic-scoped "Admins can view all user_roles"
--      policy (20260724000000) already covers pharmacists in their clinic.
--  12. Pharmacists could free national quota slots by editing kuota or
--      deleting an enrolment; only status was admin-guarded.
--  15. Quota year/month used the session timezone (UTC); Malaysia is UTC+8.
--
-- Apply on the VPS:
--   curl -sSL https://raw.githubusercontent.com/vvssubra/pharmasync/main/supabase/migrations/20261021000000_audit_security_fixes.sql \
--     | docker exec -i supabase-db-l8dsa2iokodt3yafiwcmfkvi psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
-- then restart the rest container so pooled connections pick up the timezone:
--   docker restart supabase-rest-l8dsa2iokodt3yafiwcmfkvi

begin;

-- ─── 1. approve_clinic_member: adopt only role-less users ───────────────────

create or replace function public.approve_clinic_member(
  target_user   uuid,
  target_role   public.app_role,
  target_clinic uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_clinic uuid;
  target_existing uuid;
  target_found    boolean;
begin
  if not (public.is_admin() or public.is_super_admin()) then
    raise exception 'Access denied: admin role required';
  end if;

  if target_role = 'super_admin' then
    raise exception '% may not be granted here', target_role;
  end if;

  if target_role = 'logistic_pharmacist' and not public.is_super_admin() then
    raise exception '% may not be granted here', target_role;
  end if;

  if public.is_super_admin() then
    if target_clinic is null then
      raise exception 'Select a clinic to approve this user into';
    end if;
    resolved_clinic := target_clinic;
  else
    -- Not a validation of target_clinic: an admin's own clinic is the only
    -- clinic they can ever approve into, whatever the client sends.
    resolved_clinic := public.user_clinic_id();
    if resolved_clinic is null then
      raise exception 'Your own profile has no clinic, so you cannot approve anyone';
    end if;
  end if;

  select true, p.clinic_id
    into target_found, target_existing
    from public.profiles p
   where p.user_id = target_user;

  if not coalesce(target_found, false) then
    raise exception 'No profile found for user %', target_user;
  end if;

  if target_existing is not null then
    raise exception 'That user already belongs to a clinic';
  end if;

  -- Adopt only role-less users. super_admin has clinic_id NULL by design, so
  -- without this a clinic admin could demote it into their clinic and then
  -- reset its password. super_admin may still re-home a role-holder.
  if exists (select 1 from public.user_roles where user_id = target_user)
     and not public.is_super_admin() then
    raise exception 'That user already has a role; ask the super admin';
  end if;

  update public.profiles
     set clinic_id = resolved_clinic,
         pending_clinic_id = null
   where user_id = target_user;

  insert into public.user_roles (user_id, role)
  values (target_user, target_role)
  on conflict (user_id) do update set role = excluded.role;
end;
$$;

-- The orphan branch listed role-holders (the super_admin among them) as
-- adoptable; get_unassigned_user_count already required ur.role is null.
create or replace function public.get_all_users_with_roles()
returns table (
  user_id             uuid,
  email               text,
  full_name           text,
  clinic_id           uuid,
  clinic_name         text,
  role                text,
  pending_clinic_id   uuid,
  pending_clinic_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_super_admin()) then
    raise exception 'Access denied: admin role required';
  end if;

  return query
    select
      p.user_id,
      u.email::text,
      p.full_name,
      p.clinic_id,
      c.name,
      ur.role::text,
      p.pending_clinic_id,
      pc.name
    from public.profiles p
    join auth.users u on u.id = p.user_id
    left join public.clinics c on c.id = p.clinic_id
    left join public.clinics pc on pc.id = p.pending_clinic_id
    left join public.user_roles ur on ur.user_id = p.user_id
    where public.is_super_admin()
       or p.clinic_id = public.user_clinic_id()
       -- Pending members of my clinic.
       or (p.clinic_id is null and p.pending_clinic_id = public.user_clinic_id())
       -- Orphans: no clinic, no request. Adoptable by any admin.
       or (p.clinic_id is null and p.pending_clinic_id is null and ur.role is null);
end;
$$;

-- ─── 7. Resubmit stays in the submitter's clinic ────────────────────────────

drop policy if exists "MO resubmits own rejected antibiotic form" on public.antibiotic_forms;
create policy "MO resubmits own rejected antibiotic form" on public.antibiotic_forms
  for update to authenticated
  using (submitted_by = auth.uid() and status = 'rejected'
         and clinic_id = public.user_clinic_id())
  with check (submitted_by = auth.uid() and status = 'pending_specialist'
              and clinic_id = public.user_clinic_id());

-- ─── 10. Diagnosis frequency: bounded window, no one-off free text ──────────
-- Still anon-callable for the weekly picker job; a diagnosis typed by fewer
-- than 3 forms (where a name or IC would hide) is never returned.

create or replace function public.get_diagnosis_frequency(days_back integer default 28)
returns table (
  normalized_diagnosis text,
  sample_label text,
  occurrence_count bigint,
  distinct_mo_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(regexp_replace(trim(af.diagnosis), '\s+', ' ', 'g')) as normalized_diagnosis,
    (array_agg(af.diagnosis order by af.created_at desc))[1] as sample_label,
    count(*) as occurrence_count,
    count(distinct af.submitted_by) as distinct_mo_count
  from public.antibiotic_forms af
  where af.created_at >= now() - (least(greatest(days_back, 1), 90) || ' days')::interval
    and trim(af.diagnosis) <> ''
  group by 1
  having count(*) >= 3
  order by occurrence_count desc, normalized_diagnosis;
$$;

-- ─── 11. Drop the unscoped pharmacist read on user_roles ────────────────────

drop policy if exists "Pharmacists can view all user_roles" on public.user_roles;

-- ─── 12. Quota enrolment: kuota and delete are admin-only too ───────────────

create or replace function public.enforce_quota_patient_status_writer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_super_admin() or public.is_admin() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Only an admin may remove a quota patient'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and new.status <> 'AKTIF' then
    raise exception 'Only an admin may enrol a patient as %', new.status
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (new.status is distinct from old.status
                           or new.kuota is distinct from old.kuota) then
    raise exception 'Only an admin may change a quota patient''s status or kuota'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_quota_patient_status_writer on public.drug_quota_patients;
create trigger trg_enforce_quota_patient_status_writer
  before insert or update or delete on public.drug_quota_patients
  for each row execute function public.enforce_quota_patient_status_writer();

commit;

-- ─── 15. Quota year and month in Malaysian time ─────────────────────────────
-- now(), extract(year ...), make_date(...) vs timestamptz and created_at::date
-- all follow the session timezone; one setting fixes every quota function.
-- Applies to new connections only, hence the rest-container restart above.
alter database postgres set timezone to 'Asia/Kuala_Lumpur';

notify pgrst, 'reload schema';
