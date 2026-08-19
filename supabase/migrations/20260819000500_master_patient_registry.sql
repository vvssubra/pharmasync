-- Logistic pharmacist HQ role, step 6: master patient registry RPC.
--
-- patient_registry is unique on (clinic_id, no_ic) — the same human legitimately
-- holds a separate row at every clinic that treats them (20260727000000). That
-- is correct for per-clinic dispensing but wrong for an HQ-level "who is this
-- national pool serving" view, which needs one row per PERSON with the list of
-- clinics they have visited. This migration adds a read-only RPC that groups
-- patient_registry by normalized IC for exactly that view.
--
-- Depends on:
--   20260819000100_logistic_role_helpers.sql — public.is_logistic_pharmacist()
--   20260723000200_tenancy_3_rls.sql          — public.is_super_admin()
--
-- Independent of Tasks 3-5 (national quota pool) — this is read-only and does
-- not touch drug_quotas/drug_quota_patients/enforcement at all. It reuses the
-- SAME normalization expression Task 4's drug_quota_used() uses
-- (regexp_replace(no_ic, '\D', '', 'g')) so this dashboard's patient count
-- agrees with the quota RPC's patient count for the same underlying data.

-- ── 1. Supporting index for the grouping expression ─────────────────────────
create index if not exists idx_patient_registry_ic_norm
  on public.patient_registry ((regexp_replace(no_ic, '\D', '', 'g')));

-- ── 2. get_master_patient_registry() ─────────────────────────────────────────
-- Groups patient_registry rows by normalized IC across all clinics, so a
-- patient registered at two clinics under the same IC shows up as one row
-- with clinic_count = 2 and both clinic names listed.
--
-- Malformed ICs (not exactly 12 digits after stripping non-digits, or all
-- identical digits — e.g. a placeholder like 000000000000) are deliberately
-- EXCLUDED from grouping: merging on a placeholder value would silently
-- combine unrelated people into one "patient" who appears to have visited
-- every clinic that ever used that placeholder. Those rows still appear in
-- the results, one row per clinic, clinic_count = 1 — nothing is dropped,
-- they are just never merged with anything.
--
-- patient_name is the most-recently-updated row's name for that normalized IC
-- (updated_at desc). clinic_names is the distinct list of clinic names the
-- person (or, for a malformed IC, that single row) is associated with.
--
-- total_count reflects the number of distinct groups AFTER grouping (i.e. the
-- deduped patient count), not the raw patient_registry row count, so pagination
-- math on the frontend is correct.
create or replace function public.get_master_patient_registry(
  p_search text default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  normalized_ic text,
  display_ic    text,
  patient_name  text,
  clinic_names  text[],
  clinic_count  integer,
  first_seen    timestamptz,
  last_seen     timestamptz,
  total_count   bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit       integer := least(coalesce(p_limit, 50), 200);
  v_offset      integer := greatest(coalesce(p_offset, 0), 0);
  v_search_ic   text;
begin
  if not (public.is_logistic_pharmacist() or public.is_super_admin()) then
    raise exception 'Access denied: logistic pharmacist role required';
  end if;

  -- Digits-only extraction of the search term for IC-prefix matching. An empty
  -- digit string (e.g. p_search is only letters/punctuation) must NOT match
  -- every row, so it is treated as "no IC search" via nullif below.
  v_search_ic := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');

  return query
  with base as (
    select
      pr.id,
      pr.patient_name,
      pr.no_ic,
      pr.updated_at,
      pr.created_at,
      c.name as clinic_name,
      regexp_replace(pr.no_ic, '\D', '', 'g') as ic_norm
    from public.patient_registry pr
    join public.clinics c on c.id = pr.clinic_id
  ),
  classified as (
    select
      b.*,
      -- Valid only if exactly 12 digits and not all-identical-digits (a
      -- placeholder like '000000000000' or '111111111111'). Anything else is
      -- treated as malformed and grouped alone (one row per clinic).
      (length(b.ic_norm) = 12 and b.ic_norm !~ '^(\d)\1{11}$') as ic_valid
    from base b
  ),
  grouped as (
    -- Valid ICs: grouped by normalized IC across all clinics.
    select
      cl.ic_norm as normalized_ic,
      (array_agg(cl.no_ic order by cl.updated_at desc))[1] as display_ic,
      (array_agg(cl.patient_name order by cl.updated_at desc))[1] as patient_name,
      array_agg(distinct cl.clinic_name order by cl.clinic_name) as clinic_names,
      count(distinct cl.clinic_name)::int as clinic_count,
      min(cl.created_at) as first_seen,
      max(cl.updated_at) as last_seen
    from classified cl
    where cl.ic_valid
    group by cl.ic_norm

    union all

    -- Malformed ICs: never merged with anything, one row per source row.
    select
      cl.ic_norm as normalized_ic,
      cl.no_ic as display_ic,
      cl.patient_name,
      array[cl.clinic_name] as clinic_names,
      1 as clinic_count,
      cl.created_at as first_seen,
      cl.updated_at as last_seen
    from classified cl
    where not cl.ic_valid
  ),
  filtered as (
    select g.*
    from grouped g
    where p_search is null
       or p_search = ''
       or g.patient_name ilike '%' || p_search || '%'
       or (v_search_ic is not null and g.normalized_ic like v_search_ic || '%')
  ),
  counted as (
    select f.*, count(*) over ()::bigint as total_count
    from filtered f
  )
  select
    c.normalized_ic,
    c.display_ic,
    c.patient_name,
    c.clinic_names,
    c.clinic_count,
    c.first_seen,
    c.last_seen,
    coalesce(c.total_count, 0)
  from counted c
  order by c.last_seen desc
  limit v_limit
  offset v_offset;
end;
$$;

comment on function public.get_master_patient_registry(text, integer, integer) is
  'National, deduplicated patient list for the HQ dashboard. Groups '
  'patient_registry by regexp_replace(no_ic, ''\D'', '''', ''g'') — the same '
  'normalization drug_quota_used() uses, so patient counts agree between the '
  'two RPCs. Malformed ICs (not exactly 12 digits, or all-identical-digits) '
  'are never merged and appear one row per clinic. p_limit is clamped to 200 '
  'server-side. Restricted to logistic_pharmacist/super_admin.';

grant execute on function public.get_master_patient_registry(text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
