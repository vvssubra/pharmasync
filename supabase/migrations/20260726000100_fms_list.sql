-- Real FMS names in the antibiotic form's "Assigned FMS" dropdown.
--
-- 20260722_antibiotic_assigned_fms.sql added the column with an inline CHECK
-- pinning it to two placeholder names ('Dr Amelia', 'Dr Muslim'), and the form
-- hardcodes the same two. The dropdown should list whoever actually holds the
-- fms role in the submitting MO's clinic.
--
-- An MO cannot read other users' profiles or user_roles under RLS (profiles is
-- self-or-admin, user_roles likewise), so the list comes from a security
-- definer RPC rather than a widened policy — the form needs names of one role
-- in one clinic, nothing more.

-- ── 1. Unpin the column ─────────────────────────────────────────────────────
alter table public.antibiotic_forms
  drop constraint if exists antibiotic_forms_assigned_fms_check;

-- ── 2. Who can be assigned ──────────────────────────────────────────────────
-- Callable by any clinic member: MOs submit the form, and admins/pharmacists
-- reach it too. Scoped to the caller's clinic; super_admin sees all clinics.
-- Exposes name and id only — no email, no clinic internals.
create or replace function public.get_fms_list()
returns table (user_id uuid, full_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Access denied';
  end if;

  return query
    select p.user_id, p.full_name
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    where ur.role = 'fms'
      and (public.is_super_admin() or p.clinic_id = public.user_clinic_id())
    order by p.full_name;
end;
$$;

grant execute on function public.get_fms_list() to authenticated;
