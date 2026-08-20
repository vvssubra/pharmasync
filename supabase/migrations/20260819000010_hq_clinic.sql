-- Logistic pharmacist HQ role, step 2 of 2: the HQ clinic itself.
--
-- Adds an is_hq flag to clinics, seeds the single HQ clinic row, and exposes
-- its id via a security definer helper so later migrations/RLS policies can
-- resolve "the HQ clinic" without a client-supplied uuid.

-- ── 1. is_hq flag ────────────────────────────────────────────────────────
alter table public.clinics add column is_hq boolean not null default false;

-- At most one HQ clinic. Partial unique index over the constant expression
-- (is_hq) so only rows where is_hq is true participate — a second is_hq =
-- true insert violates this, any number of is_hq = false rows are fine.
create unique index clinics_single_hq on public.clinics ((is_hq)) where is_hq;

-- ── 2. Seed the HQ clinic ───────────────────────────────────────────────
insert into public.clinics (name, is_hq) values ('Logistik PKDJB', true);

-- ── 3. hq_clinic_id() ────────────────────────────────────────────────────
-- security definer so RLS policies on clinics (clinic-scoped select) do not
-- block this lookup for non-HQ callers; stable since the HQ clinic does not
-- change within a statement/transaction.
create or replace function public.hq_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.clinics where is_hq limit 1;
$$;

notify pgrst, 'reload schema';
