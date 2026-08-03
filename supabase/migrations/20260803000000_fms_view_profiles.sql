-- supabase/migrations/20260803000000_fms_view_profiles.sql
-- FMS reviewers open the pending-antibiotic-form queue (FmsDashboard,
-- SpecialistDashboard) and look up the submitting MO's name by joining
-- profiles on submitted_by. profiles RLS granted "view all, own clinic" to
-- admin and pharmacist (20260723000200_tenancy_3_rls.sql) but never added
-- the same grant for fms — so that join always returned zero rows for an
-- FMS user, and every submitter name fell back to "Unknown MO", for every
-- MO, on every form, for every FMS reviewer. Not specific to any one pair
-- of users.
drop policy if exists "FMS can view all profiles" on public.profiles;
create policy "FMS can view all profiles" on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin() or (public.is_fms() and clinic_id = public.user_clinic_id()));

notify pgrst, 'reload schema';
