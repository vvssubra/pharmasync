-- Logistic pharmacist HQ role, step 1 of 2: enum value only.
--
-- Isolated in its own statement/migration: an enum value added via ALTER TYPE
-- cannot be used as a literal later in the SAME transaction. Precedent:
-- 20260723000000_tenancy_1_schema.sql added 'super_admin' the same way, in
-- its own file. The next migration (20260819000010_hq_clinic.sql) is the
-- first place 'logistic_pharmacist' is referenced.
alter type public.app_role add value if not exists 'logistic_pharmacist';
