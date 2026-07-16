# Migrating the office-PC Supabase to the VPS

Both sides are the official self-host stack (plain Postgres), so **auth users
migrate with their password hashes intact** — nobody's password changes. The
new `JWT_SECRET` on the VPS invalidates *sessions* only: everyone just logs
in again.

Prereq: the VPS stack is already up with this repo's migrations applied
(DEPLOY.md steps 1–7).

---

## 0. Pre-flight (on the office PC)

**Version check — critical.** GoTrue and storage-api each keep their own
schema-migration tables; restoring rows dumped from a *newer* service into an
*older* schema fails. The VPS images must be **same or newer**:

```powershell
docker compose images   # note supabase/postgres, supabase/gotrue, supabase/storage-api tags
```

Compare against the VPS (`pcompose images`). If the VPS is older, bump its
compose file to at least the office versions before migrating.

**Freeze writes** (leave only the DB up):

```powershell
cd C:\supabase-self-host
docker compose stop kong auth rest storage functions
```

## 1. Dump (office PC, PowerShell)

Dump as `supabase_admin` (superuser — required for `--disable-triggers` and
clean ownership/ACL lines):

```powershell
# Public schema: DATA only (DDL comes from this repo's migrations on the VPS)
docker exec supabase-db pg_dump -U supabase_admin -d postgres `
  -n public --data-only --disable-triggers -f /tmp/public_data.sql

# Auth + storage rows — EXCLUDING each service's migration-tracking tables
# and the buckets seed rows (the VPS migrations recreate the buckets)
docker exec supabase-db pg_dump -U supabase_admin -d postgres `
  -n auth -n storage --data-only --disable-triggers `
  --exclude-table-data=auth.schema_migrations `
  --exclude-table-data=storage.migrations `
  --exclude-table-data=storage.buckets `
  -f /tmp/auth_storage_data.sql

docker cp supabase-db:/tmp/public_data.sql .
docker cp supabase-db:/tmp/auth_storage_data.sql .
```

## 2. Copy to the VPS

```powershell
scp .\public_data.sql .\auth_storage_data.sql root@<vps-ip>:/root/migration/
```

**Storage object FILES** (DB rows are metadata only — the bytes live on disk):

```powershell
scp -r C:\supabase-self-host\volumes\storage root@<vps-ip>:/opt/supabase/docker/volumes/
```

Also sync the Obsidian vault if not done yet (DEPLOY.md step 9).

## 3. Restore (VPS)

```bash
pcompose stop kong auth rest storage functions   # quiesce

docker cp /root/migration/auth_storage_data.sql supabase-db:/tmp/
docker cp /root/migration/public_data.sql       supabase-db:/tmp/

# auth/storage first (public.profiles has FKs to auth.users)
docker exec supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f /tmp/auth_storage_data.sql
docker exec supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f /tmp/public_data.sql

pcompose start auth rest storage kong functions
```

If a restore aborts (ON_ERROR_STOP), the usual causes:
- **duplicate key**: leftover rows from VPS testing — `TRUNCATE <table> CASCADE;` and re-run.
- **role does not exist**: dump made as `postgres` instead of `supabase_admin` — re-dump.

## 4. Verify

```bash
# Row counts vs the office (spot-check every table)
docker exec supabase-db psql -U supabase_admin -d postgres -c "
  SELECT 'auth.users' t, count(*) FROM auth.users
  UNION ALL SELECT 'drugs', count(*) FROM public.drugs
  UNION ALL SELECT 'transactions', count(*) FROM public.transactions
  UNION ALL SELECT 'dispensing_requests', count(*) FROM public.dispensing_requests
  UNION ALL SELECT 'antibiotic_forms', count(*) FROM public.antibiotic_forms
  UNION ALL SELECT 'patient_registry', count(*) FROM public.patient_registry
  UNION ALL SELECT 'profiles', count(*) FROM public.profiles
  UNION ALL SELECT 'user_roles', count(*) FROM public.user_roles;"

# Stock views over migrated data
docker exec supabase-db psql -U supabase_admin -d postgres \
  -c "SELECT drug_name, current_stock, status FROM drug_stock_status ORDER BY drug_name LIMIT 10;"
```

Then **log in as a real staff member** at `https://app.<domain>` — a working
login proves both the password-hash migration and the new JWT config.

## 5. Cutover

1. Announce the new URL; staff bookmark `https://app.<domain>`.
2. Re-point any office shortcuts; keep the office PC stack **stopped** (don't
   run both against diverging data).
3. After a comfortable soak (e.g. 2 weeks with good backups), decommission
   the office stack or keep it as a cold spare — restoring a VPS backup into
   it is the same procedure as this file, in reverse.
