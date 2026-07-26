import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { quotaBadgeState, QUOTA_BADGE_CLASS } from "@/lib/quotaHelpers";

interface Props {
  quotaLimit: number;
  used: number;
  remaining: number;
  alertThresholdPct: number;
  isLoading?: boolean;
}

const BADGE_LABEL: Record<ReturnType<typeof quotaBadgeState>, string> = {
  healthy: "Normal",
  warning: "Kuota Rendah",
  exhausted: "Kuota Habis",
  "no-quota": "Tiada Kuota",
};

// Header strip for the drug-scoped patient registry (/pesakit). Always reads
// server-computed numbers (get_drug_quota_usage RPC via useDrugQuotaUsage) —
// never sum(kuota) of the rows on screen, since a patient who only ever came
// through an MO dispensing_request consumes quota with no enrolment row.
export function QuotaHeaderStrip({ quotaLimit, used, remaining, alertThresholdPct, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map(i => (
          <Card key={i}><CardContent className="p-3"><Skeleton className="h-10 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  const state = quotaBadgeState(used, quotaLimit, alertThresholdPct);
  // remaining can go negative in the underlying data (over-quota states are
  // real) — clamp for display only, never for the badge/alert logic above.
  const displayRemaining = Math.max(0, remaining);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Jumlah Kuota</p>
          <p className="text-xl font-bold text-foreground">{quotaLimit}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Kuota Digunakan</p>
          <p className="text-xl font-bold text-foreground">{used}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 text-center space-y-1">
          <p className="text-xs text-muted-foreground">Baki</p>
          <p className="text-xl font-bold text-foreground">{displayRemaining}</p>
          <Badge variant="outline" className={`text-[10px] ${QUOTA_BADGE_CLASS[state]}`}>
            {BADGE_LABEL[state]}
          </Badge>
        </CardContent>
      </Card>
      <div className="sm:col-span-3">
        <Progress value={quotaLimit > 0 ? Math.min(100, (used / quotaLimit) * 100) : 0} />
      </div>
    </div>
  );
}
