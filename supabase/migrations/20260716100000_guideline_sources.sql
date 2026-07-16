-- Admin-curated list of trusted clinical-guideline URLs. A scheduled edge
-- function (ingest-guidelines) fetches each active source, strips it to plain
-- text, and caches it in the guideline-documents storage bucket — the AI
-- functions only ever read the cached copy, never the live site.
CREATE TABLE public.guideline_sources (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                text NOT NULL,
  url                  text NOT NULL UNIQUE CHECK (url ~ '^https://'),
  is_active            boolean NOT NULL DEFAULT true,
  fetch_interval_hours integer NOT NULL DEFAULT 168 CHECK (fetch_interval_hours >= 24),
  last_fetched_at      timestamptz,
  last_status          text NOT NULL DEFAULT 'pending' CHECK (last_status IN ('ok', 'error', 'pending')),
  last_error           text,
  storage_path         text,
  created_by           uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.guideline_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read guideline_sources"
  ON public.guideline_sources FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin can insert guideline_sources"
  ON public.guideline_sources FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

CREATE POLICY "Admin can update guideline_sources"
  ON public.guideline_sources FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

CREATE POLICY "Admin can delete guideline_sources"
  ON public.guideline_sources FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

-- Private bucket for the cached plain-text copies (mirrors nag-documents:
-- no public access, service-role reads/writes only).
INSERT INTO storage.buckets (id, name, public)
VALUES ('guideline-documents', 'guideline-documents', false)
ON CONFLICT (id) DO NOTHING;
