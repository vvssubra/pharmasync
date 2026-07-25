-- Make clinic_id optional in generated Insert types.
--
-- The tenancy work set clinic_id NOT NULL on six tables and installed the
-- stamp_clinic_id() BEFORE INSERT trigger to populate it, noting in
-- 20260723000200_tenancy_3_rls.sql:52 that "no insert site needs to change".
-- That is true of the runtime, but not of the types: supabase gen types marks
-- a NOT NULL column with no DEFAULT as required on Insert, so all six tables
-- produced compile errors at every call site — 18 of them across 11 files.
--
-- The fix belongs here rather than at the call sites. A column DEFAULT is only
-- evaluated when the column is omitted, and the BEFORE INSERT trigger still
-- overwrites whatever value arrives, so tenant stamping is unchanged. The
-- default exists so the generated Insert type reads clinic_id as optional.

alter table public.transactions          alter column clinic_id set default public.user_clinic_id();
alter table public.dispensing_requests   alter column clinic_id set default public.user_clinic_id();
alter table public.patient_registry      alter column clinic_id set default public.user_clinic_id();
alter table public.patient_drug_history  alter column clinic_id set default public.user_clinic_id();
alter table public.drug_quotas           alter column clinic_id set default public.user_clinic_id();
alter table public.antibiotic_forms      alter column clinic_id set default public.user_clinic_id();
