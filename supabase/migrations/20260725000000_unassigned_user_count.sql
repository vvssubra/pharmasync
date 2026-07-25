-- Adds a lightweight count RPC so the sidebar can badge the Role Management
-- nav item with the number of users awaiting a role assignment, without the
-- 15s-polling badge query pulling every user row via get_all_users_with_roles().
--
-- Mirrors get_all_users_with_roles()'s admin guard and clinic-scoping
-- (20260724000000_security_tenancy_hardening.sql, section 6) exactly, so the
-- count always matches what that page would show filtered to role is null.
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
    );

  return result;
end;
$$;
