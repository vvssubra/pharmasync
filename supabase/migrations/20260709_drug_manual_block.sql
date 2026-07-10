-- Manual admin block: prevents new dispensing requests for a drug regardless of quota level.
ALTER TABLE public.drugs
  ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;
