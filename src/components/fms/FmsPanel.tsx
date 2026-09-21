import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface FmsPanelProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Small pill next to the title, e.g. a count or scope note. */
  badge?: ReactNode;
  /** Right-aligned header controls (filters, tabs, selects). */
  action?: ReactNode;
  /** Content sits flush to the card edge — use for tables. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

/** Shared section shell for the FMS dashboard: icon chip + title block + controls, then content. */
export function FmsPanel({ icon: Icon, title, description, badge, action, flush, className, children }: FmsPanelProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold leading-tight text-foreground">{title}</h2>
              {badge}
            </div>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className={cn(!flush && "p-4 sm:p-5")}>{children}</div>
    </Card>
  );
}

const TONE_FILL = {
  ok: "bg-primary",
  warn: "bg-amber-500",
  bad: "bg-red-600",
  muted: "bg-muted-foreground/40",
} as const;

/** Thin proportional bar. Decorative — the number it illustrates is always rendered beside it. */
export function MeterBar({ pct, tone = "ok", className }: { pct: number; tone?: keyof typeof TONE_FILL; className?: string }) {
  const width = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div aria-hidden className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", TONE_FILL[tone])} style={{ width: `${width}%` }} />
    </div>
  );
}
