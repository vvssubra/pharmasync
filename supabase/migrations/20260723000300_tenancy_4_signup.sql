-- Multi-tenant migration, step 4 of 4: signup assigns clinic_id from the
-- clinic picker on the signup form (passed as auth signUp metadata).
-- profiles.facility no longer exists (dropped in migration 3) so this fully
-- replaces the old handle_new_user() from 20260318_auth_fix.sql.

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, full_name, clinic_id)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      ''
    ),
    (new.raw_user_meta_data->>'clinic_id')::uuid
  )
  on conflict (user_id) do nothing;
  -- No role assigned — user sees Pending Approval screen until admin assigns one.
  -- clinic_id may be null if metadata was missing (e.g. an OAuth path that
  -- skips the picker) — same "unassigned until fixed" handling as no-role.
  return new;
end;
$$ language plpgsql security definer set search_path = public;
