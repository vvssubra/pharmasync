import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Announcement = { id: string; message: string; created_at: string };

// Cosmetic accent per card, cycling by position — there is no severity field
// on the table, this is purely so three bulletins read as three distinct
// items rather than one undifferentiated block.
const ACCENTS = [
  { bar: "border-l-amber-400", dot: "bg-amber-400", text: "text-amber-300" },
  { bar: "border-l-sky-400", dot: "bg-sky-400", text: "text-sky-300" },
  { bar: "border-l-emerald-400", dot: "bg-emerald-400", text: "text-emerald-300" },
] as const;

// The card grid is three wide; anything beyond that is still surfaced, but
// as a crawl in the status strip rather than a fourth row that would push
// the auth card below the fold.
const CARD_LIMIT = 3;

function useAnnouncements() {
  return useQuery<Announcement[]>({
    queryKey: ["announcements-ticker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcements")
        .select("id, message, created_at")
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    // A slow-moving admin action, not a live feed — 60s keeps the pre-auth
    // login page from hammering PostgREST every few seconds.
    refetchInterval: 60000,
  });
}

/**
 * Login page bulletin board, pinned above the fold — fed from the
 * `announcements` table, managed at /settings (admin + super_admin).
 * Anon-readable (active rows only), so it renders before sign-in.
 *
 * Two bands:
 *  1. A thin status strip: live dot, bulletin count, last-updated. If there
 *     are more bulletins than the grid can hold, the overflow crawls here.
 *  2. A glassmorphic section with up to three bulletin cards. Hidden
 *     entirely when the feed is empty so an empty board leaves no
 *     placeholder box.
 */
export function AnnouncementBoard() {
  const { data: announcements = [] } = useAnnouncements();

  const cards = announcements.slice(0, CARD_LIMIT);
  const overflow = announcements.slice(CARD_LIMIT);
  const latest = announcements[0];

  // A single overflow item scrolling into a copy of itself reads as a
  // glitch, not motion — only animate when there's an actual run to cycle.
  const crawling = overflow.length > 1;
  const crawlItems = crawling ? [...overflow, ...overflow] : overflow;
  const crawlChars = overflow.reduce((sum, a) => sum + a.message.length + 24, 0);
  const crawlDurationS = Math.max(18, crawlChars / 10);

  return (
    <>
      {/* ── Status strip ────────────────────────────────────────── */}
      <header className="relative z-30 flex w-full shrink-0 items-center gap-4 overflow-hidden border-b border-white/10 bg-white/[0.03] px-4 py-2 text-xs backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="flex shrink-0 items-center gap-2 border-r border-emerald-400/15 pr-4 font-mono text-[11px] font-semibold uppercase tracking-wider text-white">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          Live Bulletins
        </div>

        <div className="relative min-w-0 flex-1 overflow-hidden whitespace-nowrap font-mono text-[11.5px] text-slate-300">
          {overflow.length > 0 ? (
            <>
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-[#041512] to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-[#041512] to-transparent" />
              <div
                className={cn(
                  "flex items-center gap-8 will-change-transform",
                  crawling && "ticker-scroll-horizontal",
                )}
                style={crawling ? { animationDuration: `${crawlDurationS}s` } : undefined}
              >
                {crawlItems.map((a, i) => (
                  <span
                    key={`${a.id}-${i}`}
                    aria-hidden={i >= overflow.length ? true : undefined}
                    className="inline-flex shrink-0 items-center gap-2"
                  >
                    <span className="font-bold text-emerald-400">●</span>
                    {a.message}
                    <span className="text-slate-600">|</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <span className="truncate">
              {announcements.length === 0
                ? "No active bulletins"
                : `${announcements.length} active ${announcements.length === 1 ? "bulletin" : "bulletins"}`}
              {latest && (
                <>
                  <span className="mx-2 text-slate-600">·</span>
                  updated {formatDistanceToNowStrict(new Date(latest.created_at), { addSuffix: true })}
                </>
              )}
            </span>
          )}
        </div>

        <div className="hidden shrink-0 items-center gap-2 border-l border-emerald-400/15 pl-4 font-mono text-[11px] text-slate-400 lg:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {window.location.host}
        </div>
      </header>

      {/* ── Glass bulletin board ────────────────────────────────── */}
      {cards.length > 0 && (
        <section
          aria-label="Clinical directives and district bulletins"
          className="login-rise relative z-20 w-full shrink-0 border-b border-white/10 bg-white/[0.04] px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.25)] backdrop-blur-xl sm:px-6 lg:px-8"
        >
          {/* Top sheen — the white catchlight that reads as glass. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
          />
          <div className="relative mx-auto max-w-7xl">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2.5 font-mono text-xs font-extrabold uppercase tracking-wider text-slate-100">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </span>
                <Megaphone className="h-3.5 w-3.5 text-emerald-400" />
                Clinical Directives &amp; District Bulletins
              </h2>
              {latest && (
                <span className="hidden items-center gap-1.5 rounded-md border border-white/15 bg-white/[0.06] px-2.5 py-1 font-mono text-[11px] font-medium text-emerald-200 sm:flex">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  Live Synced • Updated{" "}
                  {formatDistanceToNowStrict(new Date(latest.created_at), { addSuffix: true })}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {cards.map((a, i) => {
                const accent = ACCENTS[i % ACCENTS.length];
                return (
                  <article
                    key={a.id}
                    className={cn(
                      "login-rise rounded-xl border border-white/10 border-l-4 bg-white/[0.07] px-4 py-3.5 backdrop-blur-xl transition-colors hover:bg-white/[0.11]",
                      "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_4px_20px_rgba(0,0,0,0.25)]",
                      accent.bar,
                    )}
                    style={{ animationDelay: `${80 + i * 70}ms` }}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                      <span className={cn("inline-flex items-center gap-1.5 font-bold tracking-wide", accent.text)}>
                        <span className={cn("h-2 w-2 rounded-full", accent.dot)} />
                        Bulletin {i + 1}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-slate-400">
                        {formatDistanceToNowStrict(new Date(a.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    {/* Full message, never clamped — a bulletin cut mid-sentence
                        is worse than a few px of scroll on short windows. */}
                    <p className="text-[13px] leading-relaxed text-white/90">{a.message}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
