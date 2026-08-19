-- Logistic pharmacist HQ role, step 3 (of the role-and-quota plan): the
-- is_logistic_pharmacist() helper, plus closing the privilege-escalation
-- path a clinic admin would otherwise have onto this new role.
--
-- Depends on 20260819000000_logistic_role_enum.sql (enum value must already
-- exist — an enum value added by ALTER TYPE cannot be used as a literal in
-- the same transaction that added it, and that migration is a prior,
-- separate transaction, so it is safe to reference here).

-- ── 1. is_logistic_pharmacist() ─────────────────────────────────────────────
-- Mirrors is_super_admin() (20260723000200_tenancy_3_rls.sql:15-22): security
-- definer so a policy that calls this does not recurse into user_roles' own
-- RLS; stable since the caller's role does not change within a statement.
create or replace function public.is_logistic_pharmacist()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'logistic_pharmacist'
  );
$$;

-- ── 2. user_roles write policies: logistic_pharmacist is not admin-grantable ─
-- 20260724000000_security_tenancy_hardening.sql section 4 gave a clinic admin
-- the ability to insert/update/delete any user_roles row in their own clinic
-- except one carrying role = 'super_admin'. logistic_pharmacist is, like
-- super_admin, a role a clinic admin must not be able to mint on an
-- accomplice account — it is meant to be provisioned only by a super_admin
-- (this is the HQ-wide role the rest of this plan builds on top of). The
-- fix is the same shape as the existing super_admin guard: widen the
-- excluded-role check from a single equality to a two-value list, in all
-- three write policies (insert, update, delete) that carry it. The select
-- policy carries no such check — visibility is unaffected — so it is left
-- untouched.
--
-- create or replace does not work for policies; this repo's convention
-- (every policy redefinition in every prior migration) is drop + create.

drop policy if exists "Admins can insert user_roles" on public.user_roles;
create policy "Admins can insert user_roles"
  on public.user_roles for insert
  to authenticated
  with check (
    public.is_super_admin()
    or (
      public.is_admin()
      and role not in ('super_admin', 'logistic_pharmacist')
      and public.role_target_clinic_id(user_id) = public.user_clinic_id()
    )
  );

drop policy if exists "Admins can update user_roles" on public.user_roles;
create policy "Admins can update user_roles"
  on public.user_roles for update
  to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_admin()
      and user_id != auth.uid()
      and role not in ('super_admin', 'logistic_pharmacist')       -- existing row
      and public.role_target_clinic_id(user_id) = public.user_clinic_id()
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.is_admin()
      and role not in ('super_admin', 'logistic_pharmacist')       -- replacement row
      and public.role_target_clinic_id(user_id) = public.user_clinic_id()
    )
  );

drop policy if exists "Admins can delete user_roles" on public.user_roles;
create policy "Admins can delete user_roles"
  on public.user_roles for delete
  to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_admin()
      and user_id != auth.uid()
      and role not in ('super_admin', 'logistic_pharmacist')
      and public.role_target_clinic_id(user_id) = public.user_clinic_id()
    )
  );

-- ── 3. approve_clinic_member(): same escalation path, second door ──────────
-- 20260726000000_clinic_approval.sql added this SECURITY DEFINER RPC, which
-- both adopts a pending user into the caller's clinic AND grants them a role
-- in the same call. It runs as its owner, so it bypasses user_roles RLS
-- entirely (the policies above are simply not consulted) — its own body is
-- the only guard. It already refuses target_role = 'super_admin' ("matching
-- the user_roles policies in 20260724000000 section 4", per its comment); the
-- same reasoning that widened those policies above applies here verbatim, or
-- an admin could grant logistic_pharmacist through this RPC even after the
-- table-level policies are closed. Signature is unchanged, so create or
-- replace is sufficient (no drop function needed).
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

  if target_role in ('super_admin', 'logistic_pharmacist') then
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
