-- 15-clinic scaling, P4 migration: clinic name uniqueness, and a latent bug
-- in approve_clinic_member that has made logistic_pharmacist ungrantable
-- through the UI since the role was introduced.

-- ── 1. Case-insensitive unique clinic names ─────────────────────────────────
-- Nothing prevents two clinics named "KK Larkin" today, and every picker
-- (ClinicRequest, Login, RoleManagement, the future /clinics page) renders
-- name only — a duplicate would be unrecoverable from the UI, with no way to
-- tell the two apart. lower(name) so "KK Larkin" and "kk larkin" collide too.
create unique index clinics_name_key on public.clinics (lower(name));

-- ── 2. approve_clinic_member(): logistic_pharmacist was never grantable ─────
-- 20260819000100 section 3 refuses target_role IN ('super_admin',
-- 'logistic_pharmacist') UNCONDITIONALLY — including for a super_admin
-- caller. create_user (supabase/functions/admin-user-mgmt/index.ts) calls
-- this RPC for every role including logistic_pharmacist, so that call always
-- creates the auth user, gets refused here, and rolls back. The role has
-- never once been grantable through the UI, by anyone, since it was
-- introduced.
--
-- The original comment's intent was narrower than its code: keep
-- logistic_pharmacist out of a plain admin's reach (matching the
-- user_roles write policies in 20260819000100 section 2, which exist so a
-- clinic admin cannot self-escalate into the HQ role), not out of
-- super_admin's. super_admin refused always (unchanged — this RPC is not
-- the path for granting super_admin, same reasoning as before); the
-- logistic_pharmacist refusal now only fires when the caller is not a
-- super_admin.
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

  update public.profiles
     set clinic_id = resolved_clinic,
         pending_clinic_id = null
   where user_id = target_user;

  insert into public.user_roles (user_id, role)
  values (target_user, target_role)
  on conflict (user_id) do update set role = excluded.role;
end;
$$;

notify pgrst, 'reload schema';
