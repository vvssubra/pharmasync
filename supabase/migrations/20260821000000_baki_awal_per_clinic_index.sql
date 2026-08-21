-- Widen the baki_awal uniqueness from per-drug to per-clinic-per-drug.
-- idx_one_baki_awal_per_drug (drug_id) blocks a second clinic from ever
-- setting its own opening balance for a drug KK Kempas has already
-- balanced — every clinic #2+ insert fails with 23505. Create the wider
-- index before dropping the old one; the new key is strictly narrower
-- in scope than the old one, so it can never fail against existing data
-- (same argument as 20260727000000_drug_quota_patients.sql:11-12).

create unique index if not exists idx_one_baki_awal_per_clinic_drug
  on public.transactions (clinic_id, drug_id)
  where jenis = 'baki_awal';

drop index if exists public.idx_one_baki_awal_per_drug;
