// src/pages/LogistikDashboard.tsx
//
// logistic_pharmacist HQ dashboard: the national controlled-drug quota pool
// (one row per drug, pooled across every clinic — see useHqQuotaUsage and
// supabase/migrations/20260819000300_national_quota_pool.sql), with a
// per-clinic breakdown of who consumed it and an edit action that opens
// NationalQuotaDialog. Quota-status thresholds and badge styling all come
// from src/lib/quotaHelpers.ts — none of it is reimplemented here.
import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Warehouse, Package, AlertTriangle, CheckCircle2, Bell, ChevronDown, Pencil, Download,
} from "lucide-react";
import {
  quotaStatus, quotaBadgeState, formatKuotaLabel, QUOTA_BADGE_CLASS, QUOTA_BADGE_LABEL,
} from "@/lib/quotaHelpers";
import { useHqQuotaUsage } from "@/hooks/useHqQuotaUsage";
import { exportQuotaExcel } from "@/lib/exportQuotaExcel";
import { toast } from "sonner";
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

// Common unit_pengukuran values seen across the formulary — offered as
// <datalist> suggestions on the inline SKU editor below, but any free text
// is accepted (many drugs use compound values like "BOX OF 28'S").
const SKU_SUGGESTIONS = ["Tablet", "Box", "Botol", "Sachet", "Unit", "Vial", "Ampoule", "Strip", "Pack", "EACH"];

// Sticky-header cell classes shared by every <TableHead> in the National
// Quota Pool table below, so the header row stays pinned while the body
// scrolls inside its fixed-height, Excel-like scroll container. Grey fill +
// a right-hand rule on every header/body cell (GRID_CELL) is what gives the
// table its spreadsheet-gridline look — TableRow already carries a bottom
// border, so border-r here is the only thing needed to complete the grid.
const STICKY_HEAD = "sticky top-0 z-10 bg-muted text-xs h-9 border-r border-border last:border-r-0";
const GRID_CELL = "border-r border-border last:border-r-0 py-1.5";

type CardFilter = "critical" | "available" | "alerts" | null;

type DrugLookup = { drug_name: string; unit_price: number | null; unit_pengukuran: string };

type EditTarget = {
  drugId: string;
  drugName: string;
  quotaLimit: number;
  fmsCount: number | null;
  quotaPerFms: number | null;
  alertThresholdPct: number;
};

export default function LogistikDashboard() {
  const currentYear = new Date().getFullYear();
  const [cardFilter, setCardFilter] = useState<CardFilter>(null);
  const [expandedDrugId, setExpandedDrugId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const [editingSkuId, setEditingSkuId] = useState<string | null>(null);
  const [skuDraft, setSkuDraft] = useState("");
  const queryClient = useQueryClient();

  // Inline SKU editor — drugs.unit_pengukuran is otherwise editable nowhere
  // in the app. Both roles that can reach this page (super_admin,
  // logistic_pharmacist) already have UPDATE on drugs per
  // supabase/migrations/20260819000200_drugs_unit_price.sql.
  const updateSkuMutation = useMutation({
    mutationFn: async ({ id, unit_pengukuran }: { id: string; unit_pengukuran: string }) => {
      const { error } = await supabase.from("drugs").update({ unit_pengukuran }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logistik-drugs"] });
      toast.success("SKU updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

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
        .select("id, drug_name, unit_price, unit_pengukuran")
        .eq("is_active", true);
      if (error) throw error;
      const map = new Map<string, DrugLookup>();
      for (const d of data ?? [])
        map.set(d.id, { drug_name: d.drug_name, unit_price: d.unit_price, unit_pengukuran: d.unit_pengukuran });
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

  const commitSkuEdit = (drugId: string, currentValue: string) => {
    const trimmed = skuDraft.trim();
    setEditingSkuId(null);
    if (!trimmed || trimmed === currentValue) return;
    updateSkuMutation.mutate({ id: drugId, unit_pengukuran: trimmed });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportQuotaExcel(
        filteredRows.map((r) => ({
          drug_name: r.drug.drug_name,
          unit_pengukuran: r.drug.unit_pengukuran,
          unit_price: r.drug.unit_price,
          quota_per_fms: r.quota_per_fms,
          fms_count: r.fms_count,
          quota_limit: r.quota_limit,
          used: r.used,
        })),
        currentYear,
      );
    } catch {
      toast.error("Failed to generate the Excel file. Try again shortly.");
    } finally {
      setExporting(false);
    }
  };

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
          <div className="flex items-center gap-2">
            {cardFilter && (
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setCardFilter(null)}>
                Clear filter
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={exporting || isLoading || filteredRows.length === 0}
              onClick={handleExport}
            >
              <Download className="h-3 w-3 mr-1" /> {exporting ? "Exporting…" : "Export to Excel"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : isError ? (
            <p className="text-sm text-destructive text-center py-8">
              Failed to load the national quota pool. Try again shortly.
            </p>
          ) : (
            // Fixed window: a set height regardless of row count (not just a
            // cap), scrollable both ways, with a pinned grey header row and
            // cell gridlines throughout — Excel's freeze-top-row view, not
            // just a resemblance to it. 12 columns wide, can run to dozens
            // of drug rows.
            <div className="h-[65vh] overflow-auto border-t">
              <datalist id="sku-suggestions">
                {SKU_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
              </datalist>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={cn("w-8", STICKY_HEAD)} />
                    <TableHead className={cn("text-right", STICKY_HEAD)}>BIL</TableHead>
                    <TableHead className={STICKY_HEAD}>ITEM</TableHead>
                    <TableHead className={STICKY_HEAD}>SKU</TableHead>
                    <TableHead className={cn("text-right", STICKY_HEAD)}>HARGA SEUNIT (RM)</TableHead>
                    <TableHead className={cn("text-right", STICKY_HEAD)}>JUMLAH HARGA (usage)</TableHead>
                    <TableHead className={STICKY_HEAD}>KUOTA</TableHead>
                    <TableHead className={cn("text-right", STICKY_HEAD)}>JUMLAH KUOTA PESAKIT</TableHead>
                    <TableHead className={cn("text-right", STICKY_HEAD)}>JUMLAH PESAKIT AKTIF (usage)</TableHead>
                    <TableHead className={cn("text-right", STICKY_HEAD)}>%KUOTA YANG TELAH DIGUNAKAN</TableHead>
                    <TableHead className={STICKY_HEAD}>Status</TableHead>
                    <TableHead className={cn("text-right", STICKY_HEAD)}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-6 text-muted-foreground">
                      No drugs match this filter
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row, index) => {
                    const isExpanded = expandedDrugId === row.drug_id;
                    const badgeState = alertState(row);
                    const clinicRows = clinicRowsForDrug(row.drug_id);
                    const pctUsed = row.quota_limit > 0 ? (row.used / row.quota_limit) * 100 : null;
                    const totalHarga = row.drug.unit_price != null ? row.drug.unit_price * row.used : null;
                    return (
                      <Fragment key={row.drug_id}>
                        <TableRow>
                          <TableCell className={cn("p-0", GRID_CELL)}>
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
                          <TableCell className={cn("text-right text-sm", GRID_CELL)}>{index + 1}</TableCell>
                          <TableCell className={cn("font-medium text-sm", GRID_CELL)}>{row.drug.drug_name}</TableCell>
                          <TableCell className={cn("text-sm", GRID_CELL)}>
                            {editingSkuId === row.drug_id ? (
                              <input
                                autoFocus
                                list="sku-suggestions"
                                value={skuDraft}
                                onChange={(e) => setSkuDraft(e.target.value)}
                                onBlur={() => commitSkuEdit(row.drug_id, row.drug.unit_pengukuran)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                  if (e.key === "Escape") setEditingSkuId(null);
                                }}
                                className="h-7 w-28 rounded border border-input bg-background px-2 text-xs"
                                aria-label={`Edit SKU for ${row.drug.drug_name}`}
                              />
                            ) : (
                              <button
                                type="button"
                                className="text-left hover:text-primary hover:underline underline-offset-2"
                                aria-label={`Edit SKU for ${row.drug.drug_name}`}
                                onClick={() => {
                                  setSkuDraft(row.drug.unit_pengukuran);
                                  setEditingSkuId(row.drug_id);
                                }}
                              >
                                {row.drug.unit_pengukuran}
                              </button>
                            )}
                          </TableCell>
                          <TableCell className={cn("text-right text-sm", GRID_CELL)}>
                            {row.drug.unit_price != null ? CURRENCY.format(row.drug.unit_price) : "—"}
                          </TableCell>
                          <TableCell className={cn("text-right text-sm", GRID_CELL)}>
                            {totalHarga != null ? CURRENCY.format(totalHarga) : "—"}
                          </TableCell>
                          <TableCell className={cn("text-sm whitespace-nowrap", GRID_CELL)}>
                            {formatKuotaLabel(row.quota_per_fms, row.fms_count)}
                          </TableCell>
                          <TableCell className={cn("text-right text-sm", GRID_CELL)}>{row.quota_limit}</TableCell>
                          <TableCell className={cn("text-right text-sm", GRID_CELL)}>{row.used}</TableCell>
                          <TableCell className={cn("text-right text-sm", GRID_CELL)}>
                            {pctUsed != null ? `${pctUsed.toFixed(1)}%` : "—"}
                          </TableCell>
                          <TableCell className={GRID_CELL}>
                            <Badge variant="outline" className={cn("text-[10px]", QUOTA_BADGE_CLASS[badgeState])}>
                              {QUOTA_BADGE_LABEL[badgeState](row.used, row.quota_limit)}
                            </Badge>
                          </TableCell>
                          <TableCell className={cn("text-right", GRID_CELL)}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                setEditTarget({
                                  drugId: row.drug_id,
                                  drugName: row.drug.drug_name,
                                  quotaLimit: row.quota_limit,
                                  fmsCount: row.fms_count,
                                  quotaPerFms: row.quota_per_fms,
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
                            <TableCell colSpan={12} className="py-2">
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
            </div>
          )}
        </CardContent>
      </Card>

      <NationalQuotaDialog
        open={!!editTarget}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        drugId={editTarget?.drugId ?? ""}
        drugName={editTarget?.drugName ?? ""}
        year={currentYear}
        currentFmsCount={editTarget?.fmsCount ?? null}
        currentQuotaPerFms={editTarget?.quotaPerFms ?? null}
        currentQuotaLimit={editTarget?.quotaLimit ?? null}
        currentAlertThresholdPct={editTarget?.alertThresholdPct ?? null}
      />
    </div>
  );
}
