-- Configurable low-quota alert threshold per drug (percentage remaining that triggers a warning).
-- Default 20 preserves prior hardcoded behavior (warn once ~80% of quota is used).
ALTER TABLE public.drug_quotas
  ADD COLUMN IF NOT EXISTS alert_threshold_pct integer NOT NULL DEFAULT 20
  CHECK (alert_threshold_pct BETWEEN 0 AND 100);
