-- Preflight checks before the 15-clinic scaling migrations land.
-- Read-only. Run on production via the Coolify terminal and read the
-- output before proceeding to the clinic_drug_settings migration.

-- 1. How many drugs carry non-default stock thresholds or a block? Sizes
--    the clinic_drug_settings backfill and confirms it isn't a no-op.
select count(*) filter (where coalesce(stok_min, 0) <> 0)     as has_min,
       count(*) filter (where coalesce(stok_reorder, 0) <> 0) as has_reorder,
       count(*) filter (where coalesce(stok_max, 0) <> 0)     as has_max,
       count(*) filter (where is_blocked)                     as blocked,
       count(*)                                                as total
from public.drugs;

-- 2. Any row where the stock thresholds are out of order? The new table has
--    no ordering CHECK specifically so this can't block the backfill, but
--    it's worth knowing about.
select id, drug_name, stok_min, stok_reorder, stok_max
from public.drugs
where coalesce(stok_min, 0) > coalesce(stok_reorder, 0)
   or (coalesce(stok_max, 0) > 0 and coalesce(stok_reorder, 0) > coalesce(stok_max, 0));

-- 3. Is anyone currently holding the dead 'specialist' role?
select ur.user_id, p.full_name
from public.user_roles ur
join public.profiles p on p.user_id = ur.user_id
where ur.role = 'specialist';

-- 4. Clinic sanity: any duplicate names (the clinics_name_key migration in
--    a later task will fail if so), and confirm current HQ state.
select id, name, is_hq from public.clinics order by name;
select lower(name), count(*) from public.clinics group by 1 having count(*) > 1;

-- 5. Confirm the baki_awal index is still the old global one (i.e. the
--    Task 2 migration hasn't landed on this database yet).
select indexdef from pg_indexes
where schemaname = 'public' and indexname = 'idx_one_baki_awal_per_drug';
