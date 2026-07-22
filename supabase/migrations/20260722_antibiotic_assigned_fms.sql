ALTER TABLE public.antibiotic_forms
  ADD COLUMN IF NOT EXISTS assigned_fms text
    CHECK (assigned_fms IN ('Dr Amelia', 'Dr Muslim'));
