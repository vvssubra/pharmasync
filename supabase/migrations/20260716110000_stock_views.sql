-- Single source of truth for current stock and consumption forecasts,
-- replacing the client-side reductions duplicated across the dashboard pages.
-- Ledger semantics: exactly one baki_awal row per drug (enforced by
-- idx_one_baki_awal_per_drug) SETS the base; terimaan adds and keluaran
-- subtracts, counting only movements at/after the baki_awal timestamp
-- (movements before an opening balance are already folded into it).
CREATE OR REPLACE VIEW public.drug_stock_status
WITH (security_invoker = true) AS
WITH base AS (
  SELECT drug_id, kuantiti, created_at
  FROM public.transactions
  WHERE jenis = 'baki_awal'
),
movement AS (
  SELECT t.drug_id,
         SUM(CASE t.jenis WHEN 'terimaan' THEN t.kuantiti WHEN 'keluaran' THEN -t.kuantiti ELSE 0 END) AS net
  FROM public.transactions t
  LEFT JOIN base b ON b.drug_id = t.drug_id
  WHERE t.jenis IN ('terimaan', 'keluaran')
    AND (b.created_at IS NULL OR t.created_at >= b.created_at)
  GROUP BY t.drug_id
)
SELECT d.id AS drug_id,
       d.drug_name,
       d.unit_pengukuran,
       d.stok_min,
       d.stok_reorder,
       d.stok_max,
       d.is_active,
       COALESCE(b.kuantiti, 0) + COALESCE(m.net, 0) AS current_stock,
       -- Same thresholds as the dashboard's getStatus (Index.tsx):
       -- badge labels map kritikal=critical, rendah=low, lebihan=excess.
       CASE
         WHEN COALESCE(d.stok_min, 0) = 0 AND COALESCE(d.stok_max, 0) = 0 THEN 'no-level'
         WHEN COALESCE(b.kuantiti, 0) + COALESCE(m.net, 0) < COALESCE(d.stok_min, 0) THEN 'critical'
         WHEN COALESCE(b.kuantiti, 0) + COALESCE(m.net, 0) < COALESCE(d.stok_reorder, 0) THEN 'low'
         WHEN COALESCE(b.kuantiti, 0) + COALESCE(m.net, 0) > COALESCE(d.stok_max, 0) THEN 'excess'
         ELSE 'normal'
       END AS status
FROM public.drugs d
LEFT JOIN base b ON b.drug_id = d.id
LEFT JOIN movement m ON m.drug_id = d.id;

-- Trailing-30-day consumption forecast; math ported from
-- src/lib/quotaHelpers.ts (daysRemaining / forecastStatus) and the
-- FmsDashboard usage30 query so SQL and UI agree.
CREATE OR REPLACE VIEW public.drug_stock_forecast
WITH (security_invoker = true) AS
WITH usage30 AS (
  SELECT drug_id, SUM(kuantiti)::numeric / 30 AS avg_daily
  FROM public.transactions
  WHERE jenis = 'keluaran'
    AND created_at >= now() - interval '30 days'
  GROUP BY drug_id
)
SELECT s.drug_id,
       s.drug_name,
       s.unit_pengukuran,
       s.is_active,
       s.current_stock,
       ROUND(COALESCE(u.avg_daily, 0), 2) AS avg_daily_keluaran,
       CASE WHEN COALESCE(u.avg_daily, 0) > 0
            THEN FLOOR(s.current_stock / u.avg_daily)::integer
       END AS days_remaining,
       CASE WHEN COALESCE(u.avg_daily, 0) > 0 AND s.current_stock > 0
            THEN (CURRENT_DATE + FLOOR(s.current_stock / u.avg_daily)::integer)
       END AS projected_exhaustion_date,
       CASE
         WHEN COALESCE(u.avg_daily, 0) = 0 THEN 'no-data'
         WHEN FLOOR(s.current_stock / u.avg_daily) < 7 THEN 'critical'
         WHEN FLOOR(s.current_stock / u.avg_daily) < 14 THEN 'warning'
         ELSE 'healthy'
       END AS forecast_status
FROM public.drug_stock_status s
LEFT JOIN usage30 u ON u.drug_id = s.drug_id;

GRANT SELECT ON public.drug_stock_status, public.drug_stock_forecast TO authenticated, service_role;
