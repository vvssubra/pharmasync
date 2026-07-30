-- Web Push notifications: subscriptions table + insert triggers that call the
-- push-notify edge function via pg_net.
--
-- Apply on the VPS (runbook pattern — repo is public, so no copy-paste):
--   curl -sSL https://raw.githubusercontent.com/vvssubra/pharmasync/main/supabase/migrations/20260730000000_push_notifications.sql \
--     | docker exec -i supabase-db-l8dsa2iokodt3yafiwcmfkvi psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- Requires three database settings, set ONCE on the VPS and never committed
-- (this repo is public):
--   ALTER DATABASE postgres SET app.push_kong_url       = 'http://supabase-kong:8000';
--   ALTER DATABASE postgres SET app.push_anon_key       = '<anon key>';
--   ALTER DATABASE postgres SET app.push_webhook_secret = '<openssl rand -hex 32>';
-- New settings are picked up by NEW connections; run
--   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
--   WHERE datname = 'postgres' AND pid <> pg_backend_pid() AND application_name LIKE 'postgrest%';
-- or simply restart PostgREST if triggers report missing settings.

-- ─── Subscriptions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- One row per browser push endpoint. The same user can hold several
  -- (phone + desktop); re-subscribing upserts on this.
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users manage only their own subscriptions. There is deliberately no broad
-- SELECT: the push-notify edge function reads with the service-role key.
CREATE POLICY "own push subscriptions select" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own push subscriptions insert" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own push subscriptions update" ON public.push_subscriptions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own push subscriptions delete" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ─── Trigger → edge function ────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

-- SECURITY DEFINER so the calling role does not need pg_net grants. The
-- entire body is exception-guarded: a broken webhook must degrade to "no
-- notification", never to "MO cannot submit a request". net.http_post is
-- itself asynchronous (queued), so the insert does not wait on the edge
-- function either way.
CREATE OR REPLACE FUNCTION public.notify_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kong_url text;
  anon_key text;
  secret   text;
BEGIN
  BEGIN
    kong_url := current_setting('app.push_kong_url');
    anon_key := current_setting('app.push_anon_key');
    secret   := current_setting('app.push_webhook_secret');

    PERFORM net.http_post(
      url     := kong_url || '/functions/v1/push-notify',
      body    := jsonb_build_object('table', TG_TABLE_NAME, 'id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'apikey',        anon_key,
        'Authorization', 'Bearer ' || anon_key,
        'x-push-secret', secret
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Settings missing, pg_net hiccup, anything: log and move on.
    RAISE WARNING 'notify_push failed (non-fatal): %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Only rows that actually enter the specialist approval queue notify anyone.
-- Non-specialist drug requests go straight to pharmacy and stay silent.
DROP TRIGGER IF EXISTS push_on_dispensing_request ON public.dispensing_requests;
CREATE TRIGGER push_on_dispensing_request
  AFTER INSERT ON public.dispensing_requests
  FOR EACH ROW
  WHEN (NEW.status = 'pending_specialist')
  EXECUTE FUNCTION public.notify_push();

DROP TRIGGER IF EXISTS push_on_antibiotic_form ON public.antibiotic_forms;
CREATE TRIGGER push_on_antibiotic_form
  AFTER INSERT ON public.antibiotic_forms
  FOR EACH ROW
  WHEN (NEW.status = 'pending_specialist')
  EXECUTE FUNCTION public.notify_push();
