// supabase/functions/ingest-guidelines/index.ts
// Scheduled (pg_cron → pg_net) refresh of admin-curated guideline documents.
// Fetches each due active guideline_sources URL, strips it to plain text, and
// caches it in the guideline-documents storage bucket. The AI functions only
// ever read the cached copies — never the live sites — so a slow, changed, or
// compromised external page can't affect a live clinical query.
//
// Auth: internal-only shared secret (x-cron-secret), no JWT path.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import { htmlToText } from "../_shared/htmlText.ts";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_DOC_CHARS = 500_000; // same cap as the NAG document

interface SourceRow {
  id: string;
  title: string;
  url: string;
  fetch_interval_hours: number;
  last_fetched_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: sources, error: selectError } = await supabase
    .from("guideline_sources")
    .select("id, title, url, fetch_interval_hours, last_fetched_at")
    .eq("is_active", true);

  if (selectError) {
    return new Response(JSON.stringify({ error: `Query failed: ${selectError.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = Date.now();
  const due = ((sources ?? []) as SourceRow[]).filter((s) => {
    if (!s.last_fetched_at) return true;
    const ageMs = now - new Date(s.last_fetched_at).getTime();
    return ageMs >= s.fetch_interval_hours * 60 * 60 * 1000;
  });

  let ok = 0;
  let failed = 0;

  // One bad URL must not kill the batch — per-source try/catch.
  for (const source of due) {
    const storagePath = `${source.id}.txt`;
    try {
      const resp = await fetch(source.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
        headers: { "User-Agent": "PharmaSync-GuidelineIngest/1.0" },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const raw = await resp.text();
      const contentType = resp.headers.get("content-type") ?? "";
      const text = contentType.includes("text/plain")
        ? raw.trim().slice(0, MAX_DOC_CHARS)
        : htmlToText(raw, MAX_DOC_CHARS);
      if (!text) throw new Error("Empty document after text extraction");

      const { error: uploadError } = await supabase.storage
        .from("guideline-documents")
        .upload(storagePath, new Blob([text], { type: "text/plain" }), { upsert: true });
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      await supabase.from("guideline_sources").update({
        last_fetched_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
        storage_path: storagePath,
        updated_at: new Date().toISOString(),
      }).eq("id", source.id);
      ok++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`ingest-guidelines: ${source.url} failed: ${errMsg}`);
      await supabase.from("guideline_sources").update({
        last_fetched_at: new Date().toISOString(),
        last_status: "error",
        last_error: errMsg.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", source.id);
      failed++;
    }
  }

  return new Response(
    JSON.stringify({ processed: due.length, ok, failed }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
