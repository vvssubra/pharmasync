import { Pill, Share2, Copy } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  PerformanceCard,
  type BenchmarkCompetitor,
  type BenchmarkLevel,
} from "@/components/ui/performance-benchmark-card";
import { quotaBadgeState, QUOTA_BADGE_CLASS } from "@/lib/quotaHelpers";
import type { DrugQuotaUsage } from "@/hooks/useDrugQuotaUsage";

const BADGE_LABEL: Record<ReturnType<typeof quotaBadgeState>, string> = {
  healthy: "Normal",
  warning: "Kuota Rendah",
  exhausted: "Kuota Habis",
  "no-quota": "Tiada Kuota",
};

interface Props {
  drugId: string;
  drugName: string;
  year: number;
  availableYears: number[];
  onYearChange: (year: number) => void;
  usage: DrugQuotaUsage | undefined;
  /** Every quota drug's national usage this year — drives the national average and the competitors list. */
  allUsage: Map<string, DrugQuotaUsage>;
  prevUsage: DrugQuotaUsage | undefined;
  /** drug_id -> drug_name, for labeling entries in allUsage. */
  drugNamesById: Map<string, string>;
  isLoading?: boolean;
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
      <Card className="w-full max-w-lg mx-auto">
        <CardContent className="p-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!usage || usage.quota_limit <= 0) {
    return (
      <Card className="w-full max-w-lg mx-auto">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Tiada kuota ditetapkan untuk ubat ini.
        </CardContent>
      </Card>
    );
  }

  const state = quotaBadgeState(usage.used, usage.quota_limit, usage.alert_threshold_pct);
  const displayRemaining = Math.max(0, usage.remaining);

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

  const competitors: BenchmarkCompetitor[] = peerRows
    .sort((a, b) => b.used - a.used)
    .slice(0, 3)
    .map((r) => ({
      name: drugNamesById.get(r.drug_id) ?? r.drug_id,
      value: r.used,
      icon: <Pill className="h-4 w-4" />,
    }));

  const warnAt = Math.round(usage.quota_limit * (1 - usage.alert_threshold_pct / 100));
  const cap = Math.max(usage.quota_limit, usage.used);
  const performanceLevels: BenchmarkLevel[] = [
    // First tick is left unlabeled (implied zero at the bar's start) — the
    // literal "0" collided with a clamped-to-zero Baki figure elsewhere on
    // the card.
    { label: "", value: Math.min(warnAt, cap), color: "bg-green-500" },
    { label: String(warnAt), value: Math.min(usage.quota_limit, cap), color: "bg-amber-400" },
    { label: `+${usage.quota_limit}`, value: cap, color: "bg-red-500" },
  ];

  const shareUrl = `${window.location.origin}/pesakit?drug=${drugId}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Pautan disalin");
    } catch {
      toast.error("Gagal menyalin pautan");
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: drugName, url: shareUrl });
      } catch {
        // user cancelled the share sheet — no toast needed
      }
    } else {
      await copyLink();
    }
  };

  return (
    <PerformanceCard
      title={drugName}
      headerIcon={<Pill className="h-4 w-4" />}
      mainValue={usage.used}
      percentageChange={percentageChange}
      percentageChangeLabel="berbanding tahun lalu"
      benchmarkAverage={benchmarkAverage}
      benchmarkLabel="Purata kebangsaan"
      competitors={competitors}
      competitorsLabel="Ubat lain berkuota"
      performanceLevels={performanceLevels}
      levelsLabel="Tahap kuota"
      filterOptions={availableYears.map((y) => ({ value: String(y), label: String(y) }))}
      filterValue={String(year)}
      onFilterChange={(v) => onYearChange(Number(v))}
      filterAriaLabel="Pilih tahun"
      actions={
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={share}>
            <Share2 className="w-3 h-3 mr-2" />
            Kongsi
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={copyLink}>
            <Copy className="w-3 h-3 mr-2" />
            Salin pautan
          </Button>
        </>
      }
      subHeader={
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
          <span>
            Jumlah Kuota Kebangsaan: <span className="font-semibold text-foreground">{usage.quota_limit}</span>
            {" · "}
            Baki Kebangsaan: <span className="font-semibold text-foreground">{displayRemaining}</span>
          </span>
          <Badge variant="outline" className={QUOTA_BADGE_CLASS[state]}>
            {BADGE_LABEL[state]}
          </Badge>
        </div>
      }
    />
  );
}
