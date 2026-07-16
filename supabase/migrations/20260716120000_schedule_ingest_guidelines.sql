-- Nightly refresh of the cached guideline documents. Runs inside Postgres
-- (pg_cron + pg_net, both bundled with the supabase/postgres image) so the
-- schedule is versioned with the stack instead of living in a host crontab.
--
-- The ingest-guidelines edge function authenticates the call with a shared
-- secret, set once per deployment (never committed):
--   ALTER DATABASE postgres SET app.settings.cron_secret = '<CRON_SECRET>';
-- The same value must be present as CRON_SECRET in the functions container.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'ingest-guidelines-nightly',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url     := 'http://kong:8000/functions/v1/ingest-guidelines',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body    := '{}'::jsonb
  );
  $$
);
