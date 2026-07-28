# Database setup for Supabase (Pharmacy Bin Keeper)

This project uses **one Postgres database per Supabase project**. The schema is defined in `supabase/migrations/` and follows Postgres and Supabase best practices (RLS, indexes, auth triggers).

## Target project

- **URL:** `https://aeclqhwpqvbmhepkayuy.supabase.co`
- **Project ref:** `aeclqhwpqvbmhepkayuy` (20 chars, lowercase)

## Option A: Apply migrations with Supabase CLI (recommended)

1. **Install Supabase CLI** (if needed):
   ```bash
   npm install -g supabase
   ```

2. **Log in and link the project**:
   ```bash
   supabase login
   supabase link --project-ref aeclqhwpqvbmhepkayuy
   ```
   When prompted, enter the database password you set for the project (or reset it in [Supabase Dashboard](https://supabase.com/dashboard) → Project → Settings → Database).

3. **Push migrations** (creates all tables, RLS, triggers, indexes):
   ```bash
   supabase db push
   ```

4. **Configure the app** (see [Configure env](#configure-env) below).

## Option B: Run SQL in Supabase Dashboard

If you prefer not to use the CLI:

1. Open [SQL Editor](https://supabase.com/dashboard/project/aeclqhwpqvbmhepkayuy/sql/new).
2. Run each migration file **in order** (oldest first):
   - `20260311004825_*.sql` — app_role, profiles, user_roles, RLS, handle_new_user
   - `20260311011620_*.sql` — drugs table, RLS, triggers
   - `20260311011744_*.sql` — compute_kod_lokasi_penuh (trigger)
   - `20260311014302_*.sql` — transactions table, RLS, baki_awal index
   - `20260311023117_*.sql` — transactions extra columns
   - `20260312022027_*.sql` — app_role doctor/specialist, dispensing_requests, patient_registry, patient_drug_history
   - `20260312064656_*.sql` — antibiotic_forms table, triggers, RLS
   - `20260314120000_add_performance_indexes.sql` — performance indexes

Copy-paste each file’s contents into a new query and run it.

## Configure env

Backend is self-hosted Supabase via Coolify on the Hostinger VPS (Malaysia) —
data residency requirement. Not Supabase cloud.

After the database is created, point the app at this project:

1. In Coolify, open the Supabase service and find its Kong/API container's env vars.
2. Copy the Kong URL and **anon public** key.
3. Copy `.env.example` to `.env` and set:
   - `VITE_SUPABASE_URL` = Kong URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = anon public key

## Schema overview (after migrations)

| Table / object        | Purpose |
|-----------------------|--------|
| `auth.users`          | Supabase Auth (managed) |
| `public.profiles`     | full_name, facility; created by `handle_new_user` |
| `public.user_roles`   | app_role (admin, pharmacist, staff, doctor, specialist) |
| `public.drugs`        | Drug master, storage location, min/reorder/max stock |
| `public.transactions` | Ledger: baki_awal, terimaan, keluaran, etc. |
| `public.dispensing_requests` | Doctor requests → specialist → pharmacy |
| `public.antibiotic_forms`    | Antibiotic forms, specialist approval |
| `public.patient_registry`    | Patients (no_ic, patient_name) |
| `public.patient_drug_history`| Dispensing history per patient |

RLS is enabled on all public tables; policies allow **authenticated** users to SELECT/INSERT/UPDATE as used by the app. For stricter rules, add or replace policies in new migrations.

## Auth (Next.js / Supabase)

- The app uses **Supabase Auth** with email/password and stores the session in `localStorage` (see `src/integrations/supabase/client.ts`).
- New users get a row in `profiles` and a default `staff` role in `user_roles` via `handle_new_user` trigger.
- Use **Dashboard → Authentication → Users** to create the first user or enable sign-up.

## Postgres best practices applied

- **Indexes:** Partial and composite indexes for common filters (e.g. `transactions(drug_id, created_at DESC)`, `drugs(is_active, drug_name)` where `is_active = true`).
- **RLS:** All app tables use RLS with explicit policies for `authenticated` role.
- **Triggers:** `updated_at` maintained by `update_updated_at_column()`; `kod_lokasi_penuh` computed on `drugs`; `handle_new_user` for profile/role bootstrap.
- **Constraints:** Unique `baki_awal` per drug, `no_ic` unique in `patient_registry`, enum and check triggers where used.

For more detail, see the individual migration files under `supabase/migrations/`.
