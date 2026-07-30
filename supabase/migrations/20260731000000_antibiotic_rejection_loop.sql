-- Rejection → correction loop for antibiotic forms.
--
-- When FMS rejects a form it goes BACK to the submitting MO, who corrects and
-- resubmits it. Two pieces:
--   1. RLS: MOs are deliberately excluded from the general update policy
--      (20260724000200 — self-approval guard). This policy grants exactly one
--      narrow path: the submitter may edit their OWN form while it is
--      'rejected', and the updated row must go back to 'pending_specialist'.
--      They still cannot touch pending or approved forms, and the acknowledged
--      lock (20260725010000) is untouched.
--   2. Push: rejection notifies the ONE submitting MO (targeted);
--      resubmission notifies the approvers again (broadcast), same as a fresh
--      submission.
--
-- Apply on the VPS (public repo — no secrets in migrations):
--   curl -sSL https://raw.githubusercontent.com/vvssubra/pharmasync/main/supabase/migrations/20260731000000_antibiotic_rejection_loop.sql \
--     | docker exec -i supabase-db-l8dsa2iokodt3yafiwcmfkvi psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1

-- ─── 1. MO may correct + resubmit their own rejected form ───────────────────

DROP POLICY IF EXISTS "MO resubmits own rejected antibiotic form" ON public.antibiotic_forms;
CREATE POLICY "MO resubmits own rejected antibiotic form" ON public.antibiotic_forms
  FOR UPDATE TO authenticated
  USING (submitted_by = auth.uid() AND status = 'rejected')
  WITH CHECK (submitted_by = auth.uid() AND status = 'pending_specialist');

-- ─── 2. Push events for the loop ────────────────────────────────────────────

-- Same shape as notify_push() (20260730000000) but parameterised with an event
-- name via TG_ARGV, and carrying target_user for the targeted 'rejected' case.
-- Exception-guarded for the same reason: a broken webhook must never block the
-- FMS's reject or the MO's resubmit.
CREATE OR REPLACE FUNCTION public.notify_push_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kong_url text;
  anon_key text;
  secret   text;
  payload  jsonb;
BEGIN
  BEGIN
    kong_url := current_setting('app.push_kong_url');
    anon_key := current_setting('app.push_anon_key');
    secret   := current_setting('app.push_webhook_secret');

    payload := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'id',    NEW.id,
      'event', TG_ARGV[0]
    );
    IF TG_ARGV[0] = 'rejected' THEN
      payload := payload || jsonb_build_object('target_user', NEW.submitted_by);
    END IF;

    PERFORM net.http_post(
      url     := kong_url || '/functions/v1/push-notify',
      body    := payload,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'apikey',        anon_key,
        'Authorization', 'Bearer ' || anon_key,
        'x-push-secret', secret
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_push_event failed (non-fatal): %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- FMS rejects → tell the submitting MO.
DROP TRIGGER IF EXISTS push_on_antibiotic_rejected ON public.antibiotic_forms;
CREATE TRIGGER push_on_antibiotic_rejected
  AFTER UPDATE ON public.antibiotic_forms
  FOR EACH ROW
  WHEN (OLD.status = 'pending_specialist' AND NEW.status = 'rejected')
  EXECUTE FUNCTION public.notify_push_event('rejected');

-- MO resubmits → tell the approvers again.
DROP TRIGGER IF EXISTS push_on_antibiotic_resubmitted ON public.antibiotic_forms;
CREATE TRIGGER push_on_antibiotic_resubmitted
  AFTER UPDATE ON public.antibiotic_forms
  FOR EACH ROW
  WHEN (OLD.status = 'rejected' AND NEW.status = 'pending_specialist')
  EXECUTE FUNCTION public.notify_push_event('resubmitted');
