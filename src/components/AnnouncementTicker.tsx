import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Announcement = { id: string; message: string; created_at: string };

// Cosmetic accent per item, cycling deterministically by position — there is
// no severity field on the table, this is purely so a run of bulletins reads
// as distinct items rather than one undifferentiated line.
const ACCENTS = ["bg-amber-400", "bg-sky-400", "bg-emerald-400"] as const;

/**
 * Login page announcement strip — a horizontally scrolling marquee fed from
 * the `announcements` table, managed at /settings (admin + super_admin).
 * Anon-readable (active rows only), so it renders before sign-in.
 */
export function AnnouncementTicker() {
  const { data: announcements = [] } = useQuery<Announcement[]>({
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

  if (announcements.length === 0) return null;

  // A single item scrolling into a copy of itself reads as a glitch, not
  // motion — only animate when there's an actual run to cycle through.
  const scrolling = announcements.length > 1;
  const items = scrolling ? [...announcements, ...announcements] : announcements;
  // Paced by total text, not just item count — a handful of long bulletins
  // and a dozen short ones should still crawl at roughly the same reading
  // speed instead of one flying past the other. Floored so a short list
  // doesn't flick past fast enough to read as a stutter.
  const totalChars = announcements.reduce((sum, a) => sum + a.message.length + 24, 0);
  const durationS = Math.max(18, totalChars / 10);

  return (
    <div className="pt-2 max-w-2xl">
      <div className="flex items-stretch overflow-hidden rounded-xl border border-white/10 bg-[#0a2a20] shadow-md">
        <div className="flex shrink-0 items-center gap-1.5 border-r border-white/10 bg-black/20 px-3 text-xs font-semibold uppercase tracking-wider text-emerald-300">
          <Megaphone className="h-3.5 w-3.5" />
          Bulletins
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-[#0a2a20] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-[#0a2a20] to-transparent" />
          <div
            className={cn(
              "flex items-center gap-8 whitespace-nowrap py-3 pl-4 pr-4 will-change-transform",
              scrolling && "ticker-scroll-horizontal",
            )}
            style={scrolling ? { animationDuration: `${durationS}s` } : undefined}
          >
            {items.map((a, i) => {
              // Modulo by announcements.length first: maps the duplicated
              // second half back onto the same original index as its twin,
              // so both halves get the same accent — otherwise a count that
              // isn't a multiple of ACCENTS.length desyncs the loop's two
              // halves and an item visibly recolors mid-scroll.
              const dot = ACCENTS[(i % announcements.length) % ACCENTS.length];
              return (
                <span
                  key={`${a.id}-${i}`}
                  aria-hidden={i >= announcements.length ? true : undefined}
                  className="inline-flex shrink-0 items-center gap-2.5"
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
                  <span className="text-sm text-slate-100">{a.message}</span>
                  <span className="font-mono text-xs text-slate-500">
                    {formatDistanceToNowStrict(new Date(a.created_at), { addSuffix: true })}
                  </span>
                  <span className="text-slate-600">•</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
