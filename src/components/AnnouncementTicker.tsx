import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Announcement = { id: string; message: string; created_at: string };

// Cosmetic accent per row, cycling deterministically by position — there is no
// severity field on the table, this is purely so a stack of cards doesn't
// read as one undifferentiated block.
const ACCENTS = [
  { border: "border-amber-400", dot: "bg-amber-400", text: "text-amber-300" },
  { border: "border-sky-400", dot: "bg-sky-400", text: "text-sky-300" },
  { border: "border-emerald-400", dot: "bg-emerald-400", text: "text-emerald-300" },
] as const;

/**
 * Login page "Clinical Directives & District Bulletins" card — a vertically
 * scrolling stack fed from the `announcements` table, managed at /settings
 * (admin + super_admin). Anon-readable (active rows only), so it renders
 * before sign-in.
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

  // A single card scrolling into a copy of itself reads as a glitch, not
  // motion — only animate when there's an actual stack to cycle through.
  const scrolling = announcements.length > 2;
  const rows = scrolling ? [...announcements, ...announcements] : announcements;
  const durationS = announcements.length * 4.5;
  // Fixed viewport: ~2.2 cards tall regardless of message length, so the
  // fade masks always sit over real content instead of guessing at a
  // per-card pixel height that message text would drift anyway.
  const viewportH = 190;

  return (
    <div className="pt-2 max-w-2xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
          <Megaphone className="h-3.5 w-3.5 text-emerald-300" />
          Clinical Directives &amp; District Bulletins
        </span>
      </div>
      <div className="relative overflow-hidden rounded-xl" style={{ height: viewportH }}>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-[#04140d] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-5 bg-gradient-to-t from-[#04140d] to-transparent" />
        <div
          className={cn("space-y-2.5", scrolling && "ticker-scroll-vertical")}
          style={scrolling ? { animationDuration: `${durationS}s` } : undefined}
        >
          {rows.map((a, i) => {
            const accent = ACCENTS[i % ACCENTS.length];
            return (
              <article
                key={`${a.id}-${i}`}
                aria-hidden={i >= announcements.length ? true : undefined}
                className={cn(
                  "min-h-[72px] rounded-xl border-y border-r border-white/10 border-l-4 bg-white/[0.03] p-3.5 shadow-md transition-colors hover:bg-white/[0.06]",
                  accent.border,
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className={cn("inline-flex items-center gap-1.5 font-semibold", accent.text)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", accent.dot)} />
                    District Bulletin
                  </span>
                  <span className="whitespace-nowrap font-mono text-[11px] text-slate-400">
                    {formatDistanceToNowStrict(new Date(a.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-300">{a.message}</p>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
