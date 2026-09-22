import type { ReactNode } from "react";
import { Activity, Pill } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { quotaBadgeState, QUOTA_BADGE_CLASS, type QuotaBadgeState } from "@/lib/quotaHelpers";
import type { DrugQuotaUsage } from "@/hooks/useDrugQuotaUsage";

const BADGE_LABEL: Record<QuotaBadgeState, string> = {
  healthy: "Normal",
  warning: "Kuota Rendah",
  exhausted: "Kuota Habis",
  "no-quota": "Tiada Kuota",
};

const BAR_COLOR: Record<QuotaBadgeState, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  exhausted: "bg-red-500",
  "no-quota": "bg-muted-foreground/40",
};

interface Props {
  drugId: string;
  drugName: string;
  year: number;
  availableYears: number[];
  onYearChange: (year: number) => void;
  usage: DrugQuotaUsage | undefined;
  /** Every quota drug's national usage this year — drives the national average and the peer list. */
  allUsage: Map<string, DrugQuotaUsage>;
  prevUsage: DrugQuotaUsage | undefined;
  /** drug_id -> drug_name, for labeling entries in allUsage. */
  drugNamesById: Map<string, string>;
  isLoading?: boolean;
}

/** One of the three headline numbers in the hero tile row. */
function Metric({ label, value, tone, children }: { label: string; value: number; tone?: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <div className={cn("mt-1 text-2xl font-bold tracking-tight", tone)}>{value.toLocaleString()}</div>
      {children}
    </div>
  );
}

export function QuotaBenchmarkCard({
  drugId,
  drugName,
  year,
  availableYears,
  onYearChange,
  usage,
  allUsage,
  prevUsage,
  drugNamesById,
  isLoading,
}: Props) {
  if (isLoading) {
    return (
      <Card className="w-full">
        <CardContent className="p-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!usage || usage.quota_limit <= 0) {
    return (
      <Card className="w-full">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Tiada kuota ditetapkan untuk ubat ini.
        </CardContent>
      </Card>
    );
  }

  const state = quotaBadgeState(usage.used, usage.quota_limit, usage.alert_threshold_pct);
  const displayRemaining = Math.max(0, usage.remaining);
  const usagePct = usage.quota_limit > 0 ? Math.min(100, (usage.used / usage.quota_limit) * 100) : 0;

  const percentageChange =
    prevUsage && prevUsage.used > 0 ? Math.round(((usage.used - prevUsage.used) / prevUsage.used) * 100) : null;

  // Compares against the *other* quota drugs, not this one — including the
  // selected drug in its own average would trivially equal mainValue whenever
  // it's the only quota drug configured (a common state). The rows come from
  // get_drug_quota_usage, which since
  // 20260819000300_national_quota_pool.sql returns NATIONAL per-drug figures,
  // so this average is across drugs nationally, not across this clinic —
  // hence "Purata kebangsaan" rather than the old "Purata klinik".
  const peerRows = Array.from(allUsage.values()).filter((r) => r.drug_id !== drugId);
  const benchmarkAverage = peerRows.length > 0 ? Math.round(peerRows.reduce((sum, r) => sum + r.used, 0) / peerRows.length) : 0;
  const topPeers = peerRows.sort((a, b) => b.used - a.used).slice(0, 3);

  return (
    <div className="grid grid-cols-1 gap-space-base lg:grid-cols-12 items-stretch">
      {/* Hero: this drug's own quota burn */}
      <Card className="lg:col-span-7">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <Badge variant="outline" className={cn("font-semibold", QUOTA_BADGE_CLASS[state])}>
                {BADGE_LABEL[state]}
              </Badge>
              <h2 className="text-lg font-bold tracking-tight truncate">{drugName}</h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="rounded-lg bg-muted p-2 text-primary">
                <Activity className="h-5 w-5" />
              </div>
              <Select value={String(year)} onValueChange={(v) => onYearChange(Number(v))}>
                <SelectTrigger className="h-8 w-[5.5rem] text-xs" aria-label="Pilih tahun">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Metric label="Pesakit Aktif" value={usage.used}>
              {percentageChange !== null && (
                <span
                  className={cn(
                    "mt-1 block text-xs font-medium",
                    percentageChange > 0 ? "text-red-500" : percentageChange < 0 ? "text-emerald-500" : "text-muted-foreground"
                  )}
                >
                  {percentageChange >= 0 ? "▲" : "▼"} {Math.abs(percentageChange)}% berbanding tahun lalu
                </span>
              )}
            </Metric>
            {/* Labelled "Kebangsaan" (national), not per-clinic: since
                20260819000300_national_quota_pool.sql these figures come from
                get_drug_quota_usage()'s NATIONAL rows. */}
            <Metric label="Jumlah Kuota Kebangsaan" value={usage.quota_limit} />
            <Metric label="Baki Kebangsaan" value={displayRemaining} tone="text-emerald-600" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Kadar Penggunaan Kuota Semasa: {usagePct.toFixed(0)}%</span>
              <span className="font-mono text-muted-foreground">{usage.used} / {usage.quota_limit} Pesakit</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full transition-all", BAR_COLOR[state])} style={{ width: `${usagePct}%` }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Peer panel: the district's other restricted-formulary drugs */}
      <Card className="lg:col-span-5">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Pill className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Ubat Lain Berkuota</h3>
          </div>
          {topPeers.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4">Tiada ubat berkuota lain untuk tahun ini.</p>
          ) : (
            <div className="space-y-3">
              {topPeers.map((peer) => {
                const peerState = quotaBadgeState(peer.used, peer.quota_limit, peer.alert_threshold_pct);
                const peerPct = peer.quota_limit > 0 ? Math.min(100, (peer.used / peer.quota_limit) * 100) : 0;
                return (
                  <div key={peer.drug_id} className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium truncate">{drugNamesById.get(peer.drug_id) ?? peer.drug_id}</span>
                      <span className={cn("font-mono text-sm font-semibold shrink-0", peerState === "exhausted" ? "text-red-600" : peerState === "warning" ? "text-amber-600" : "text-foreground")}>
                        {peer.used} / {peer.quota_limit}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", BAR_COLOR[peerState])} style={{ width: `${peerPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between border-t pt-3 text-xs">
            <span className="text-muted-foreground">Purata kebangsaan</span>
            <span className="font-semibold">{benchmarkAverage.toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
