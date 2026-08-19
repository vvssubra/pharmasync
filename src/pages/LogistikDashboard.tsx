// src/pages/LogistikDashboard.tsx
//
// logistic_pharmacist HQ dashboard: the national controlled-drug quota pool
// (one row per drug, pooled across every clinic — see useHqQuotaUsage and
// supabase/migrations/20260819000300_national_quota_pool.sql), with a
// per-clinic breakdown of who consumed it and an edit action that opens
// NationalQuotaDialog. Quota-status thresholds and badge styling all come
// from src/lib/quotaHelpers.ts — none of it is reimplemented here.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Warehouse, Package, AlertTriangle, CheckCircle2, Bell, ChevronDown, Pencil,
} from "lucide-react";
import {
  quotaStatus, quotaBadgeState, QUOTA_BADGE_CLASS, QUOTA_BADGE_LABEL,
} from "@/lib/quotaHelpers";
import { useHqQuotaUsage } from "@/hooks/useHqQuotaUsage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableStatCard } from "@/components/ui/expandable-stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import NationalQuotaDialog from "@/components/NationalQuotaDialog";

const CURRENCY = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });

type CardFilter = "critical" | "available" | "alerts" | null;

type DrugLookup = { drug_name: string; unit_price: number | null };

type EditTarget = {
  drugId: string;
  drugName: string;
  quotaLimit: number;
  alertThresholdPct: number;
};

export default function LogistikDashboard() {
  const currentYear = new Date().getFullYear();
  const [cardFilter, setCardFilter] = useState<CardFilter>(null);
  const [expandedDrugId, setExpandedDrugId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const {
    national,
    byClinicDrug,
    isLoading: quotaLoading,
    isError: quotaError,
  } = useHqQuotaUsage(currentYear);

  // Drug lookup restricted to is_active drugs — mirrors FmsDashboard's
  // drugStock query (.eq("is_active", true)), so "Total Drugs" below counts
  // the same population FmsDashboard treats as live. is_blocked is
  // deliberately NOT filtered, matching FmsDashboard, which does not exclude
  // blocked drugs from its own stock table either.
  const {
    data: drugsById = new Map<string, DrugLookup>(),
    isLoading: drugsLoading,
    isError: drugsError,
  } = useQuery({
    queryKey: ["logistik-drugs"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drugs")
        .select("id, drug_name, unit_price")
        .eq("is_active", true);
      if (error) throw error;
      const map = new Map<string, DrugLookup>();
      for (const d of data ?? []) map.set(d.id, { drug_name: d.drug_name, unit_price: d.unit_price });
      return map;
    },
  });

  // National quota rows joined to the active-drug lookup above. A quota row
  // whose drug isn't in drugsById (inactive, or the drug row is gone) is
  // dropped rather than rendered with a blank name.
  const rows = useMemo(
    () =>
      national
        .filter((n) => drugsById.has(n.drug_id))
        .map((n) => ({ ...n, drug: drugsById.get(n.drug_id)! })),
    [national, drugsById],
  );

  // "Total Drugs" = distinct drugs carrying a national quota row for the
  // selected year (get_drug_quota_usage already returns one row per drug),
  // scoped to is_active drugs per the comment on drugsById above.
  const totalDrugsCount = rows.length;

  const criticalRows = rows.filter((r) => quotaStatus(r.remaining, r.quota_limit) === "critical");
  const availableRows = rows.filter((r) => r.remaining > 0);

  // Alerts uses quotaBadgeState with each drug's OWN alert_threshold_pct —
  // deliberately a different helper from quotaStatus above, which applies
  // fixed 10%/25%-remaining bands for the Critical Quota card. Both are
  // correct for their own card; see the comments in quotaHelpers.ts. They
  // are not unified into a single check.
  const alertState = (r: (typeof rows)[number]) =>
    quotaBadgeState(r.used, r.quota_limit, r.alert_threshold_pct);
  const alertRows = rows.filter((r) => alertState(r) === "warning" || alertState(r) === "exhausted");
  const exhaustedCount = alertRows.filter((r) => alertState(r) === "exhausted").length;
  const warningCount = alertRows.length - exhaustedCount;

  const filteredRows = rows.filter((r) => {
    if (cardFilter === "critical") return quotaStatus(r.remaining, r.quota_limit) === "critical";
    if (cardFilter === "available") return r.remaining > 0;
    if (cardFilter === "alerts") return alertState(r) === "warning" || alertState(r) === "exhausted";
    return true;
  });

  const isLoading = quotaLoading || drugsLoading;
  const isError = quotaError || drugsError;

  const clinicRowsForDrug = (drugId: string) =>
    Array.from(byClinicDrug.values()).filter((r) => r.drug_id === drugId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Warehouse className="h-6 w-6" />
          Logistik HQ Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          National controlled-drug quota pool, pooled and consumed across every clinic.
        </p>
      </div>

      {/* Summary cards — click to filter the table below; click Total Drugs
          to clear the filter, matching the interaction pattern already used
          on FmsDashboard/MoDashboard. */}
      <div className="grid gap-4 sm:grid-cols-4">
        <ExpandableStatCard
          icon={Package}
          count={totalDrugsCount}
          label="Total Drugs"
          bgClassName="bg-emerald-50"
          colorClassName="text-emerald-700"
          active={cardFilter === null}
          onClick={() => setCardFilter(null)}
        />
        <ExpandableStatCard
          icon={AlertTriangle}
          count={criticalRows.length}
          label="Drugs at Critical Quota"
          bgClassName="bg-red-50"
          colorClassName="text-red-700"
          active={cardFilter === "critical"}
          onClick={() => setCardFilter((f) => (f === "critical" ? null : "critical"))}
        />
        <ExpandableStatCard
          icon={CheckCircle2}
          count={availableRows.length}
          label="Drugs Available for Quota"
          bgClassName="bg-green-50"
          colorClassName="text-green-700"
          active={cardFilter === "available"}
          onClick={() => setCardFilter((f) => (f === "available" ? null : "available"))}
        />
        <ExpandableStatCard
          icon={Bell}
          count={alertRows.length}
          label="Alerts"
          bgClassName="bg-amber-50"
          colorClassName="text-amber-700"
          active={cardFilter === "alerts"}
          breakdown={[
            { label: "Exhausted", value: exhaustedCount },
            { label: "Warning", value: warningCount },
          ]}
          onClick={() => setCardFilter((f) => (f === "alerts" ? null : "alerts"))}
        />
      </div>

      {/* National quota table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            National Quota Pool ({currentYear})
            {cardFilter && <span className="ml-2 font-normal text-sm text-muted-foreground">— filtered</span>}
          </CardTitle>
          {cardFilter && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setCardFilter(null)}>
              Clear filter
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : isError ? (
            <p className="text-sm text-destructive text-center py-8">
              Failed to load the national quota pool. Try again shortly.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Drug</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">National Quota</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                      No drugs match this filter
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => {
                    const isExpanded = expandedDrugId === row.drug_id;
                    const badgeState = alertState(row);
                    const clinicRows = clinicRowsForDrug(row.drug_id);
                    return (
                      <Fragment key={row.drug_id}>
                        <TableRow>
                          <TableCell className="p-0">
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? "Collapse per-clinic breakdown" : "Expand per-clinic breakdown"}
                              className="flex h-full w-full items-center justify-center p-2"
                              onClick={() => setExpandedDrugId(isExpanded ? null : row.drug_id)}
                            >
                              <ChevronDown className={cn("h-4 w-4 transition-transform", !isExpanded && "-rotate-90")} />
                            </button>
                          </TableCell>
                          <TableCell className="font-medium text-sm">{row.drug.drug_name}</TableCell>
                          <TableCell className="text-right text-sm">
                            {row.drug.unit_price != null ? CURRENCY.format(row.drug.unit_price) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm">{row.quota_limit}</TableCell>
                          <TableCell className="text-right text-sm">{row.used}</TableCell>
                          <TableCell className="text-right font-semibold text-sm">{row.remaining}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[10px]", QUOTA_BADGE_CLASS[badgeState])}>
                              {QUOTA_BADGE_LABEL[badgeState](row.used, row.quota_limit)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                setEditTarget({
                                  drugId: row.drug_id,
                                  drugName: row.drug.drug_name,
                                  quotaLimit: row.quota_limit,
                                  alertThresholdPct: row.alert_threshold_pct,
                                })
                              }
                            >
                              <Pencil className="h-3 w-3 mr-1" /> Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={8} className="py-2">
                              {clinicRows.length === 0 ? (
                                <p className="text-xs text-muted-foreground px-2">No usage recorded at any clinic yet.</p>
                              ) : (
                                <div className="px-2 space-y-1">
                                  {clinicRows.map((c) => (
                                    <div key={c.clinic_id} className="flex items-center justify-between text-xs">
                                      <span className="text-muted-foreground">{c.clinic_name}</span>
                                      <span className="font-medium">{c.used} used</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NationalQuotaDialog
        open={!!editTarget}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        drugId={editTarget?.drugId ?? ""}
        drugName={editTarget?.drugName ?? ""}
        year={currentYear}
        currentQuotaLimit={editTarget?.quotaLimit ?? null}
        currentAlertThresholdPct={editTarget?.alertThresholdPct ?? null}
      />
    </div>
  );
}
