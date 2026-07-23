-- Multi-tenant migration, step 2 of 4: backfill existing rows to the seed
-- clinic, then enforce NOT NULL on the 6 ledger/request tables.
-- profiles.clinic_id stays NULLable — an unassigned signup (or a Google
-- OAuth signup that skips the clinic picker) has no clinic yet, mirroring
-- the existing "no role -> Pending Approval" pattern.

update public.transactions        set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;
update public.dispensing_requests set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;
update public.patient_registry    set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;
update public.patient_drug_history set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;
update public.drug_quotas         set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;
update public.antibiotic_forms    set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;

-- All existing users belong to the single current clinic today.
update public.profiles set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;

alter table public.transactions        alter column clinic_id set not null;
alter table public.dispensing_requests alter column clinic_id set not null;
alter table public.patient_registry    alter column clinic_id set not null;
alter table public.patient_drug_history alter column clinic_id set not null;
alter table public.drug_quotas         alter column clinic_id set not null;
alter table public.antibiotic_forms    alter column clinic_id set not null;
