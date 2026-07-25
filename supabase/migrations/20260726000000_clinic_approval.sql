-- Clinic approval: the missing half of the pending_clinic_id flow.
--
-- 20260724000000_security_tenancy_hardening.sql section 3 made handle_new_user()
-- park a signup's clinic choice in profiles.pending_clinic_id and leave
-- clinic_id NULL until an admin approves. Nothing was ever built to approve.
-- Every account created since then has a NULL clinic_id, so user_clinic_id()
-- returns NULL and stamp_clinic_id() (section 7) raises on every insert:
--
--   clinic_id could not be resolved for user <uuid> — profile has no clinic
--
-- which blocks antibiotic forms, drug requests and transactions alike. The only
-- fix available was a manual UPDATE in psql with trg_guard_profile_clinic_change
-- disabled, because section 1 revokes update (clinic_id) from authenticated.
--
-- This migration adds the approval step as a security definer RPC (the revoke
-- does not apply to the function owner) and widens the two listing functions so
-- an admin can actually see everyone awaiting approval.

-- ── 1. Orphans: signups that never recorded a clinic request ────────────────
-- A Google OAuth sign-in carries no clinic_id metadata, so handle_new_user()
-- leaves BOTH clinic_id and pending_clinic_id NULL. The existing predicate only
-- matches pending_clinic_id = user_clinic_id(), so those accounts are invisible
-- to every clinic admin and cannot be approved by anyone but a super_admin.
--
-- Such a user belongs to no clinic, so exposing the row leaks only their name
-- and email — no clinic-scoped data. Weighed against accounts that silently
-- cannot use the app at all, showing them to any admin is the better trade.

-- Two new OUT columns, so this is a return-type change: create or replace
-- refuses it and the function has to be dropped first.
drop function if exists public.get_all_users_with_roles();

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
       or (p.clinic_id is null and p.pending_clinic_id is null);
end;
$$;

-- Same widening, so the sidebar badge and the page never disagree about who is
-- waiting.
create or replace function public.get_unassigned_user_count()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  result integer;
begin
  if not (public.is_admin() or public.is_super_admin()) then
    raise exception 'Access denied: admin role required';
  end if;

  select count(*)::integer into result
  from public.profiles p
  left join public.user_roles ur on ur.user_id = p.user_id
  where ur.role is null
    and (
      public.is_super_admin()
      or p.clinic_id = public.user_clinic_id()
      or (p.clinic_id is null and p.pending_clinic_id = public.user_clinic_id())
      or (p.clinic_id is null and p.pending_clinic_id is null)
    );

  return result;
end;
$$;

-- ── 2. The approval itself ─────────────────────────────────────────────────
-- Grants clinic and role together: a user with one and not the other still
-- cannot work, so approving in two steps only widens the window where a new
-- account looks broken.
--
-- security definer for the revoked update (clinic_id) privilege. That makes the
-- guards below the only thing standing between a caller and another clinic's
-- membership, so they are deliberately narrow:
--
--   * admins may only adopt INTO their own clinic — target_clinic is ignored
--     for them entirely, not merely validated;
--   * a target that already has a clinic is refused, so this can never move an
--     approved member from one clinic to another;
--   * super_admin is not grantable here, matching the user_roles policies in
--     20260724000000 section 4.
--
-- Raise messages are surfaced verbatim by the UI, so they are written for the
-- admin reading them.

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
    raise exception 'super_admin may not be granted here';
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

  update public.profiles
     set clinic_id = resolved_clinic,
         pending_clinic_id = null
   where user_id = target_user;

  insert into public.user_roles (user_id, role)
  values (target_user, target_role)
  on conflict (user_id) do update set role = excluded.role;
end;
$$;

-- The function's own guards are the access control; the trigger's admin branch
-- would allow this write anyway, and its super_admin branch likewise.
grant execute on function public.approve_clinic_member(uuid, public.app_role, uuid) to authenticated;
