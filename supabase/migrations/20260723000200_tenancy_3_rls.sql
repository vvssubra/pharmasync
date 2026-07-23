-- Multi-tenant migration, step 3 of 4: helpers, RLS, borrow-facility FK,
-- BinCard removal. Runs only after backfill + NOT NULL (migration 2) so no
-- policy ever evaluates against a null clinic_id on a ledger table.

-- ── 1. SECURITY DEFINER helpers ─────────────────────────────────────────────
-- Both bypass RLS by design — a policy on `profiles` that itself queried
-- `profiles` under RLS would recurse (see 20260316_fix_rls_circular_recursion.sql
-- for the same trap with is_pharmacist()/is_admin()).
create or replace function public.user_clinic_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select clinic_id from public.profiles where user_id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'super_admin'
  );
$$;

-- ── 2. clinics table RLS ────────────────────────────────────────────────────
-- Anon-readable (id, name only — nothing sensitive) so the signup page can
-- populate the clinic picker before the user is authenticated.
alter table public.clinics enable row level security;

create policy "Anyone can view clinics"
  on public.clinics for select
  to anon, authenticated
  using (true);

create policy "Super admin can manage clinics"
  on public.clinics for insert
  to authenticated
  with check (public.is_super_admin());

create policy "Super admin can update clinics"
  on public.clinics for update
  to authenticated
  using (public.is_super_admin());

create policy "Super admin can delete clinics"
  on public.clinics for delete
  to authenticated
  using (public.is_super_admin());

-- ── 3. BEFORE INSERT stamp trigger (shared) ─────────────────────────────────
-- Forces clinic_id = caller's own clinic for everyone except super_admin —
-- a client-supplied clinic_id in the payload is ignored/overwritten, so no
-- insert site needs to change and no user can spoof another clinic's data.
create or replace function public.stamp_clinic_id()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_super_admin() then
    new.clinic_id := coalesce(new.clinic_id, public.user_clinic_id());
  else
    new.clinic_id := public.user_clinic_id();
  end if;
  return new;
end;
$$;

create trigger trg_stamp_clinic_id before insert on public.transactions
  for each row execute function public.stamp_clinic_id();
create trigger trg_stamp_clinic_id before insert on public.dispensing_requests
  for each row execute function public.stamp_clinic_id();
create trigger trg_stamp_clinic_id before insert on public.patient_registry
  for each row execute function public.stamp_clinic_id();
create trigger trg_stamp_clinic_id before insert on public.patient_drug_history
  for each row execute function public.stamp_clinic_id();
create trigger trg_stamp_clinic_id before insert on public.drug_quotas
  for each row execute function public.stamp_clinic_id();
create trigger trg_stamp_clinic_id before insert on public.antibiotic_forms
  for each row execute function public.stamp_clinic_id();

-- ── 4. RLS: transactions ─────────────────────────────────────────────────────
drop policy if exists "Authenticated users can view transactions" on public.transactions;
drop policy if exists "Authenticated users can insert transactions" on public.transactions;
drop policy if exists "Authenticated users can update transactions" on public.transactions;

create policy "Clinic-scoped view transactions" on public.transactions
  for select to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id());
create policy "Clinic-scoped insert transactions" on public.transactions
  for insert to authenticated
  with check (public.is_super_admin() or clinic_id = public.user_clinic_id());
create policy "Clinic-scoped update transactions" on public.transactions
  for update to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id())
  with check (public.is_super_admin() or clinic_id = public.user_clinic_id());

-- ── 5. RLS: dispensing_requests ─────────────────────────────────────────────
drop policy if exists "Authenticated users can view dispensing_requests" on public.dispensing_requests;
drop policy if exists "Authenticated users can insert dispensing_requests" on public.dispensing_requests;
drop policy if exists "Authenticated users can update dispensing_requests" on public.dispensing_requests;

create policy "Clinic-scoped view dispensing_requests" on public.dispensing_requests
  for select to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id());
create policy "Clinic-scoped insert dispensing_requests" on public.dispensing_requests
  for insert to authenticated
  with check (public.is_super_admin() or clinic_id = public.user_clinic_id());
create policy "Clinic-scoped update dispensing_requests" on public.dispensing_requests
  for update to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id())
  with check (public.is_super_admin() or clinic_id = public.user_clinic_id());

-- ── 6. RLS: patient_registry ─────────────────────────────────────────────────
drop policy if exists "Authenticated users can view patient_registry" on public.patient_registry;
drop policy if exists "Authenticated users can insert patient_registry" on public.patient_registry;
drop policy if exists "Authenticated users can update patient_registry" on public.patient_registry;

create policy "Clinic-scoped view patient_registry" on public.patient_registry
  for select to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id());
create policy "Clinic-scoped insert patient_registry" on public.patient_registry
  for insert to authenticated
  with check (public.is_super_admin() or clinic_id = public.user_clinic_id());
create policy "Clinic-scoped update patient_registry" on public.patient_registry
  for update to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id())
  with check (public.is_super_admin() or clinic_id = public.user_clinic_id());

-- ── 7. RLS: patient_drug_history (select + insert only — no update/delete existed before) ──
drop policy if exists "Authenticated users can view patient_drug_history" on public.patient_drug_history;
drop policy if exists "Authenticated users can insert patient_drug_history" on public.patient_drug_history;

create policy "Clinic-scoped view patient_drug_history" on public.patient_drug_history
  for select to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id());
create policy "Clinic-scoped insert patient_drug_history" on public.patient_drug_history
  for insert to authenticated
  with check (public.is_super_admin() or clinic_id = public.user_clinic_id());

-- ── 8. RLS: drug_quotas (existing admin-only write checks preserved, ANDed with clinic) ──
drop policy if exists "Authenticated users can read drug_quotas" on public.drug_quotas;
drop policy if exists "Admin can insert drug_quotas" on public.drug_quotas;
drop policy if exists "Admin can update drug_quotas" on public.drug_quotas;
drop policy if exists "Admin can delete drug_quotas" on public.drug_quotas;

create policy "Clinic-scoped view drug_quotas" on public.drug_quotas
  for select to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id());
create policy "Clinic admin can insert drug_quotas" on public.drug_quotas
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  );
create policy "Clinic admin can update drug_quotas" on public.drug_quotas
  for update to authenticated
  using (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  );
create policy "Clinic admin can delete drug_quotas" on public.drug_quotas
  for delete to authenticated
  using (
    public.is_super_admin()
    or (clinic_id = public.user_clinic_id()
        and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  );

-- ── 9. RLS: antibiotic_forms ─────────────────────────────────────────────────
drop policy if exists "Authenticated users can view antibiotic_forms" on public.antibiotic_forms;
drop policy if exists "Authenticated users can insert antibiotic_forms" on public.antibiotic_forms;
drop policy if exists "Authenticated users can update antibiotic_forms" on public.antibiotic_forms;

create policy "Clinic-scoped view antibiotic_forms" on public.antibiotic_forms
  for select to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id());
create policy "Clinic-scoped insert antibiotic_forms" on public.antibiotic_forms
  for insert to authenticated
  with check (public.is_super_admin() or clinic_id = public.user_clinic_id());
create policy "Clinic-scoped update antibiotic_forms" on public.antibiotic_forms
  for update to authenticated
  using (public.is_super_admin() or clinic_id = public.user_clinic_id())
  with check (public.is_super_admin() or clinic_id = public.user_clinic_id());

-- ── 10. RLS: profiles (admin/pharmacist "view all" scoped to own clinic) ────
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles" on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin() or (public.is_admin() and clinic_id = public.user_clinic_id()));

drop policy if exists "Pharmacists can view all profiles" on public.profiles;
create policy "Pharmacists can view all profiles" on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin() or (public.is_pharmacist() and clinic_id = public.user_clinic_id()));

-- ── 11. get_all_users_with_roles(): clinic-scoped, returns clinic name ──────
-- Return type is changing (facility text -> clinic_id uuid, clinic_name text),
-- so CREATE OR REPLACE isn't enough — Postgres requires the old signature dropped first.
drop function if exists public.get_all_users_with_roles();

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
    where public.is_super_admin() or p.clinic_id = public.user_clinic_id()
    order by p.full_name;
end;
$$;

-- ── 12. borrowed_from_facility -> borrowed_from_clinic_id ───────────────────
-- Note: `borrowed_from_facility` does not exist in the live schema (it's a
-- stale/phantom column in the generated types.ts, never created by any
-- migration) even though SpecialistDashboard.tsx writes to it on approve —
-- that write currently 400s against PostgREST whenever a specialist fills in
-- the borrow-facility field. Adding this column fixes that bug as a side
-- effect; there is no old free-text data to backfill.
alter table public.dispensing_requests
  add column borrowed_from_clinic_id uuid references public.clinics(id);

-- ── 13. Remove BinCard / physical location tracking ─────────────────────────
-- Product direction: quota/ledger tracking only, no shelf-location tracking.
-- Drop the trigger that maintained kod_lokasi_penuh before dropping its columns.
drop trigger if exists set_kod_lokasi_penuh on public.drugs;
drop function if exists public.compute_kod_lokasi_penuh();

alter table public.drugs
  drop column if exists gudang_seksyen,
  drop column if exists baris,
  drop column if exists rak,
  drop column if exists tingkat,
  drop column if exists petak,
  drop column if exists kod_lokasi_penuh;

-- ── 14. Drop dead facility column (clinic_id fully replaces it) ─────────────
alter table public.profiles drop column facility;
