-- Security hardening for the multi-tenancy work in 27840cb.
--
-- The tenancy migrations correctly stamped and fenced the six clinic-scoped
-- data tables, but three tables that decide *which* tenant you belong to were
-- left with their pre-tenancy policies: profiles (clinic membership),
-- user_roles (privilege), and drugs (shared formulary). Membership and
-- privilege were therefore self-assignable, which defeats the data policies
-- downstream of them.
--
-- Ordering matters here: profiles is fixed before user_roles, because the
-- user_roles policies resolve the target user's clinic through profiles.

-- ── 1. profiles: clinic membership is no longer self-assignable ─────────────
-- "Users can update their own profile" (20260311004825, line 33) is FOR UPDATE
-- USING (auth.uid() = user_id) with no WITH CHECK and no column restriction,
-- and no later migration drops it. Postgres reuses USING as the check when
-- WITH CHECK is absent, and USING only constrains user_id — which does not
-- change. So any authenticated user could PATCH their own row, set clinic_id
-- to any UUID read from the anon-readable clinics table, and gain full read
-- and write on that clinic through user_clinic_id().
--
-- A WITH CHECK alone is awkward here: user_clinic_id() reads the very row
-- being updated. A BEFORE UPDATE trigger is explicit about intent and is not
-- sensitive to statement-level read semantics.

create or replace function public.guard_profile_clinic_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.clinic_id is distinct from old.clinic_id then
    -- super_admin reassigns freely; that is its purpose.
    if public.is_super_admin() then
      return new;
    end if;
    -- An admin may adopt a not-yet-assigned user into their own clinic.
    -- This is the approval step for the pending_clinic_id flow in section 3.
    if public.is_admin()
       and old.clinic_id is null
       and new.clinic_id = public.user_clinic_id() then
      return new;
    end if;
    raise exception 'clinic_id may not be changed by this user';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_clinic_change on public.profiles;
create trigger trg_guard_profile_clinic_change
  before update on public.profiles
  for each row execute function public.guard_profile_clinic_change();

-- Belt and braces: the trigger is authoritative, but revoking the column
-- privilege means a stray policy can never re-open this path.
revoke update (clinic_id) on public.profiles from authenticated;

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── 2. profiles: a place to park a requested-but-unapproved clinic ──────────
alter table public.profiles
  add column if not exists pending_clinic_id uuid references public.clinics(id);

comment on column public.profiles.pending_clinic_id is
  'Clinic the user selected at signup. A request, not a grant — an admin of '
  'that clinic (or a super_admin) promotes it to clinic_id.';

-- ── 3. signup no longer grants the clinic it asks for ──────────────────────
-- handle_new_user() (20260723000300, line 17) read clinic_id straight out of
-- raw_user_meta_data, which is client-supplied via supabase.auth.signUp
-- ({ options: { data: { clinic_id } } }) in src/pages/Login.tsx:68. Combined
-- with the anon-readable clinics table, any self-service signup could name any
-- clinic and immediately reach that clinic's patient and ledger rows over
-- PostgREST — the "Pending Approval" screen is client-side only.
--
-- The picker stays; what changes is that it now records a request. Until an
-- admin approves, clinic_id is NULL, user_clinic_id() returns NULL, and every
-- clinic-scoped policy evaluates false. That also removes the need for a
-- separate role predicate on those policies.

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, full_name, clinic_id, pending_clinic_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    null,
    (new.raw_user_meta_data ->> 'clinic_id')::uuid
  );
  return new;
end;
$$;

-- ── 4. user_roles: privilege is clinic-scoped, and super_admin is not ───────
-- ── grantable by an admin ──────────────────────────────────────────────────
-- The previous policies were WITH CHECK (is_admin()) / USING (is_admin() AND
-- user_id != auth.uid()) — no restriction on which user is targeted and none
-- on which enum value is assigned, including the 'super_admin' value added by
-- the tenancy work. An admin of clinic A could mint a super_admin on an
-- accomplice account (the user_id != auth.uid() guard only blocks doing it to
-- yourself) and read every clinic in the system. src/pages/RoleManagement.tsx
-- writes these rows with the anon key, so the path is live.

-- Resolves the clinic of the user a role row points at. Separate function so
-- the policies below stay readable.
create or replace function public.role_target_clinic_id(target uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select clinic_id from public.profiles where user_id = target;
$$;

drop policy if exists "Admins can view all user_roles" on public.user_roles;
create policy "Admins can view all user_roles"
  on public.user_roles for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_super_admin()
    or (
      (public.is_admin() or public.is_pharmacist())
      and public.role_target_clinic_id(user_id) = public.user_clinic_id()
    )
  );

drop policy if exists "Admins can insert user_roles" on public.user_roles;
create policy "Admins can insert user_roles"
  on public.user_roles for insert
  to authenticated
  with check (
    public.is_super_admin()
    or (
      public.is_admin()
      and role <> 'super_admin'
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
      and role <> 'super_admin'                                   -- existing row
      and public.role_target_clinic_id(user_id) = public.user_clinic_id()
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.is_admin()
      and role <> 'super_admin'                                   -- replacement row
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
      and role <> 'super_admin'
      and public.role_target_clinic_id(user_id) = public.user_clinic_id()
    )
  );

-- ── 5. drugs: the shared formulary is no longer world-writable ─────────────
-- drugs was deliberately left out of the tenancy work and still carried
-- USING (true) WITH CHECK (true) TO authenticated, so any user of any clinic
-- could edit rows every clinic depends on — including clearing
-- perlu_kelulusan_pakar, which removes the specialist-approval requirement for
-- a controlled drug system-wide, or clearing is_blocked.
--
-- OPEN PRODUCT DECISION: this keeps drugs a single shared formulary and only
-- restricts who may write it. If formularies are meant to be per-clinic, this
-- needs a clinic_id column, a stamp trigger, and clinic-scoped policies like
-- the other six tables. Reads stay open to all authenticated users either way.

drop policy if exists "Authenticated users can insert drugs" on public.drugs;
drop policy if exists "Authenticated users can update drugs" on public.drugs;

create policy "Admins can insert drugs"
  on public.drugs for insert
  to authenticated
  with check (public.is_admin() or public.is_super_admin());

create policy "Admins can update drugs"
  on public.drugs for update
  to authenticated
  using (public.is_admin() or public.is_super_admin())
  with check (public.is_admin() or public.is_super_admin());

-- ── 6. unassigned users must be visible to someone ────────────────────────
-- get_all_users_with_roles() filtered on
--   is_super_admin() or p.clinic_id = user_clinic_id()
-- which is NULL-false for exactly the unassigned profiles that section 3 now
-- creates on every signup. Without this, a new user is invisible to the admin
-- who is supposed to approve them.
-- The signature is deliberately unchanged — same six columns, same types, same
-- admin guard — so src/pages/RoleManagement.tsx and the generated types keep
-- working without regeneration. Only the WHERE clause moves.
create or replace function public.get_all_users_with_roles()
returns table (
  user_id    uuid,
  email      text,
  full_name  text,
  clinic_id  uuid,
  clinic_name text,
  role       text
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
      ur.role::text
    from public.profiles p
    join auth.users u on u.id = p.user_id
    left join public.clinics c on c.id = p.clinic_id
    left join public.user_roles ur on ur.user_id = p.user_id
    where public.is_super_admin()
       or p.clinic_id = public.user_clinic_id()
       -- Pending members of my clinic. Without this an admin cannot see the
       -- signups they are meant to approve, because section 3 now leaves
       -- clinic_id NULL until approval and NULL = anything is never true.
       or (p.clinic_id is null and p.pending_clinic_id = public.user_clinic_id());
end;
$$;

-- ── 7. stamp_clinic_id: fail loudly rather than with a constraint error ────
-- A super_admin whose own profile has no clinic, inserting without an explicit
-- clinic_id, previously produced NULL and hit the NOT NULL constraint with an
-- opaque 23502. Availability only, no isolation impact.
create or replace function public.stamp_clinic_id()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_super_admin() then
    new.clinic_id := coalesce(new.clinic_id, public.user_clinic_id());
  else
    new.clinic_id := public.user_clinic_id();
  end if;

  if new.clinic_id is null then
    raise exception 'clinic_id could not be resolved for user % — profile has no clinic', auth.uid();
  end if;

  return new;
end;
$$;
