// supabase/functions/_shared/guidelineDocs.ts
// Loads the cached plain-text guideline documents (admin-curated URLs,
// refreshed by ingest-guidelines) from the guideline-documents bucket so the
// clinical functions can include them in section retrieval alongside the NAG.
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";

type SupabaseClient = ReturnType<typeof createClient>;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour, matching the NAG cache
const MAX_TOTAL_CHARS = 500_000;

let cache: { text: string; fetchedAt: number } | null = null;

/**
 * Concatenated cached guideline docs, each prefixed with its source title as
 * a heading so nagRetrieval's section splitter can rank them. Best-effort:
 * returns "" (or the stale cache) on any failure.
 */
export async function loadGuidelineDocs(supabase: SupabaseClient): Promise<string> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.text;

  try {
    const { data: sources, error } = await supabase
      .from("guideline_sources")
      .select("title, storage_path")
      .eq("is_active", true)
      .eq("last_status", "ok")
      .not("storage_path", "is", null);
    if (error || !sources) return cache?.text ?? "";

    const parts: string[] = [];
    let used = 0;
    for (const source of sources as { title: string; storage_path: string }[]) {
      if (used >= MAX_TOTAL_CHARS) break;
      const { data: blob, error: dlError } = await supabase.storage
        .from("guideline-documents")
        .download(source.storage_path);
      if (dlError || !blob) continue;
      const text = (await blob.text()).slice(0, MAX_TOTAL_CHARS - used);
      // Uppercase title line = heading for nagRetrieval's splitter.
      parts.push(`${source.title.toUpperCase()}\n${text}`);
      used += text.length;
    }

    cache = { text: parts.join("\n\n"), fetchedAt: now };
    return cache.text;
  } catch {
    return cache?.text ?? "";
  }
}
