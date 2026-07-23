-- Multi-tenant migration, step 1 of 4: schema additions (nullable only).
-- Nothing here is enforced yet — clinic_id columns are added nullable and
-- backfilled in the next migration, RLS lands after that. This keeps the
-- running app in a valid state at every step.

-- ── 1. clinics table ─────────────────────────────────────────────────────────
create table public.clinics (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- Seed the existing (only) clinic with a fixed, known UUID so later
-- migrations/backfills can reference it without a lookup.
insert into public.clinics (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Klinik Kesihatan Kempas');

-- ── 2. super_admin role ──────────────────────────────────────────────────────
-- Isolated in its own statement/migration: an enum value added via ALTER TYPE
-- cannot be used as a literal later in the SAME transaction. Migration 3 (a
-- separate file/transaction) is the first place 'super_admin' is referenced.
alter type public.app_role add value if not exists 'super_admin';

-- ── 3. clinic_id columns (nullable) ─────────────────────────────────────────
alter table public.transactions        add column clinic_id uuid references public.clinics(id);
alter table public.dispensing_requests add column clinic_id uuid references public.clinics(id);
alter table public.patient_registry    add column clinic_id uuid references public.clinics(id);
alter table public.patient_drug_history add column clinic_id uuid references public.clinics(id);
alter table public.drug_quotas         add column clinic_id uuid references public.clinics(id);
alter table public.antibiotic_forms    add column clinic_id uuid references public.clinics(id);
alter table public.profiles            add column clinic_id uuid references public.clinics(id);
