-- De-identified diagnosis frequency, for the weekly "common diagnoses"
-- picker-update job (see .github or the scheduled routine that calls this).
--
-- Deliberately grants to anon, unlike get_fms_list (authenticated-only):
-- the output carries zero PII by construction — no patient_name, no
-- patient_ic, no submitted_by identity, just a normalized diagnosis string
-- with an occurrence count and a distinct-submitter count. Anon access lets
-- the weekly job call this over plain REST with the same publishable anon
-- key already shipped in the frontend bundle, with no service_role key and
-- no stored login credential to leak.
create or replace function public.get_diagnosis_frequency(days_back integer default 28)
returns table (
  normalized_diagnosis text,
  sample_label text,
  occurrence_count bigint,
  distinct_mo_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(regexp_replace(trim(af.diagnosis), '\s+', ' ', 'g')) as normalized_diagnosis,
    -- One as-typed example to seed a human-readable label from — the job
    -- still does its own title-casing, this just avoids shipping an
    -- all-lowercase diagnosis into the picker.
    (array_agg(af.diagnosis order by af.created_at desc))[1] as sample_label,
    count(*) as occurrence_count,
    count(distinct af.submitted_by) as distinct_mo_count
  from public.antibiotic_forms af
  where af.created_at >= now() - (days_back || ' days')::interval
    and trim(af.diagnosis) <> ''
  group by 1
  order by occurrence_count desc, normalized_diagnosis;
$$;

grant execute on function public.get_diagnosis_frequency(integer) to anon, authenticated;
