import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useDrugQuotaUsage } from "@/hooks/useDrugQuotaUsage";
import { quotaDerivedStatus } from "@/lib/quotaHelpers";
import { computeStockByDrug } from "@/lib/stock";
import { Pill, FileCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, TrendingDown, CheckCircle, TrendingUp, X,
  HelpCircle, Users,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

type StockStatus = "CRITICAL" | "LOW" | "NORMAL" | "EXCESS" | "NO LEVEL";

interface DrugStock {
  id: string;
  drug_name: string;
  unit_pengukuran: string;
  stok_min: number;
  stok_reorder: number;
  stok_max: number;
  baki: number;
  balance: number;
  pctMax: number;
  isQuotaBased: boolean;
  status: StockStatus;
  lastUpdated: string | null;
}

function getStatus(baki: number, min: number, reorder: number, max: number): StockStatus {
  if (!min && !max) return "NO LEVEL";
  if (baki < min) return "CRITICAL";
  if (baki < reorder) return "LOW";
  if (baki > max) return "EXCESS";
  return "NORMAL";
}

const STATUS_CONFIG: Record<StockStatus, { color: string; badgeClass: string }> = {
  CRITICAL: { color: "text-destructive", badgeClass: "bg-destructive/15 text-destructive border-destructive/30" },
  LOW: { color: "text-warning", badgeClass: "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700" },
  NORMAL: { color: "text-green-600", badgeClass: "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700" },
  EXCESS: { color: "text-blue-600", badgeClass: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700" },
  "NO LEVEL": { color: "text-muted-foreground", badgeClass: "bg-muted text-muted-foreground border-border" },
};

const STATUS_ORDER: Record<StockStatus, number> = {
  CRITICAL: 0, LOW: 1, NORMAL: 2, EXCESS: 3, "NO LEVEL": 4,
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StockStatus | null>(null);

  const currentYear = new Date().getFullYear();
  const { byDrugId: quotaUsageByDrug } = useDrugQuotaUsage(currentYear);

  // Fetch drugs. The key is namespaced because this projection differs from
  // Terimaan's and DrugMaster's; sharing a bare ["drugs"] key made them serve
  // each other's row shape. invalidateQueries(["drugs"]) still matches by
  // prefix, so every existing invalidator keeps working.
  const { data: drugs } = useQuery({
    queryKey: ["drugs", "dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drugs").select("id, drug_name, unit_pengukuran, stok_min, stok_reorder, stok_max, perlu_kelulusan_pakar").eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  // Fetch all transactions for baki calc
  const { data: transactions } = useQuery({
    queryKey: ["transactions-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("transactions").select("drug_id, jenis, kuantiti, tarikh, created_at");
      if (error) throw error;
      return data;
    },
  });

  // Fetch last 10 transactions with drug info
  const { data: recentTx } = useQuery({
    queryKey: ["recent-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id, jenis, kuantiti, nama_pegawai, created_at, drug_id, drugs(drug_name)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  // Fetch last 5 fulfilled dispensing requests
  const { data: recentDispensing } = useQuery({
    queryKey: ["recent-dispensing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispensing_requests")
        .select("id, patient_name, no_ic, quantity, fulfilled_at, drugs(drug_name)")
        .eq("status", "fulfilled")
        .order("fulfilled_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  // Compute drug stocks
  const drugStocks: DrugStock[] = useMemo(() => {
    if (!drugs || drugs.length === 0 || !transactions) return [];

    const bakiByDrug = computeStockByDrug(transactions);
    const lastDateByDrug = new Map<string, string | null>();
    for (const tx of transactions) {
      const lastDate = lastDateByDrug.get(tx.drug_id) ?? null;
      if (!lastDate || tx.created_at > lastDate) lastDateByDrug.set(tx.drug_id, tx.created_at);
    }

    return drugs.map((d) => {
      const entry = { baki: bakiByDrug.get(d.id) ?? 0, lastDate: lastDateByDrug.get(d.id) ?? null };
      const physicalStatus = getStatus(entry.baki, d.stok_min ?? 0, d.stok_reorder ?? 0, d.stok_max ?? 0);
      // Controlled drugs (insulin under the FMS quota register) aren't
      // tracked by physical stock thresholds — Critical/Low/Normal must come
      // from remaining annual quota instead.
      const quotaUsage = quotaUsageByDrug.get(d.id);
      const quotaStatus = quotaDerivedStatus(d.perlu_kelulusan_pakar, quotaUsage);
      const status: StockStatus = quotaStatus
        ? ({ critical: "CRITICAL", low: "LOW", normal: "NORMAL" } as const)[quotaStatus]
        : physicalStatus;
      // Controlled drugs show remaining annual quota as their "balance" —
      // physical vial count isn't the operative constraint for them.
      const isQuotaBased = !!quotaStatus && !!quotaUsage;
      const balance = isQuotaBased ? quotaUsage!.remaining : entry.baki;
      const pctMax = isQuotaBased
        ? (quotaUsage!.quota_limit > 0 ? Math.max(0, Math.min(100, Math.round((quotaUsage!.remaining / quotaUsage!.quota_limit) * 100))) : 0)
        : (d.stok_max > 0 ? Math.min(Math.round((entry.baki / d.stok_max) * 100), 100) : 0);
      return {
        id: d.id,
        drug_name: d.drug_name,
        unit_pengukuran: d.unit_pengukuran,
        stok_min: d.stok_min ?? 0,
        stok_reorder: d.stok_reorder ?? 0,
        stok_max: d.stok_max ?? 0,
        baki: entry.baki,
        balance,
        pctMax,
        isQuotaBased,
        status,
        lastUpdated: entry.lastDate,
      };
    }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  }, [drugs, transactions, quotaUsageByDrug]);

  // Activity feed
  const activityFeed = useMemo(() => {
    if (!recentTx || recentTx.length === 0) return [];
    return recentTx.map((tx) => ({
      drug_name: tx.drugs?.drug_name ?? "—",
      jenis: tx.jenis,
      kuantiti: tx.kuantiti,
      nama_pegawai: tx.nama_pegawai ?? "—",
      created_at: tx.created_at,
    }));
  }, [recentTx]);

  // Counts
  const counts = useMemo(() => {
    const c = { CRITICAL: 0, LOW: 0, NORMAL: 0, EXCESS: 0, "NO LEVEL": 0 };
    for (const d of drugStocks) {
      if (d.status === "CRITICAL") c.CRITICAL++;
      else if (d.status === "LOW") c.LOW++;
      else if (d.status === "NORMAL") c.NORMAL++;
      else if (d.status === "EXCESS") c.EXCESS++;
      else c["NO LEVEL"]++;
    }
    return c;
  }, [drugStocks]);

  const today = format(new Date(), "d MMMM yyyy");

  const statCards: { label: string; status: StockStatus; count: number; icon: typeof AlertTriangle; color: string; bg: string }[] = [
    { label: "Critical", status: "CRITICAL", count: counts.CRITICAL, icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" },
    { label: "Low", status: "LOW", count: counts.LOW, icon: TrendingDown, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-100 dark:bg-orange-900/20" },
    { label: "Normal", status: "NORMAL", count: counts.NORMAL, icon: CheckCircle, color: "text-green-600 dark:text-green-400", bg: "bg-green-100 dark:bg-green-900/20" },
    { label: "Excess", status: "EXCESS", count: counts.EXCESS, icon: TrendingUp, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/20" },
    { label: "No Level", status: "NO LEVEL", count: counts["NO LEVEL"], icon: HelpCircle, color: "text-muted-foreground", bg: "bg-muted" },
  ];

  // Clicking a stat card filters the table below to that status; clicking the
  // active card again (or Clear filter) shows every drug.
  const toggleStatusFilter = (status: StockStatus) => {
    setStatusFilter((current) => (current === status ? null : status));
  };

  const visibleDrugStocks = statusFilter ? drugStocks.filter((d) => d.status === statusFilter) : drugStocks;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Current stock overview — {today}</p>
      </div>

      {/* Section 2 — Alert Banner */}
      {counts.CRITICAL > 0 && !alertDismissed && (
        <Alert variant="destructive" className="relative">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Critical Stock Alert</AlertTitle>
          <AlertDescription>
            {counts.CRITICAL} drug(s) require immediate attention — stock below minimum level
          </AlertDescription>
          <button type="button" onClick={() => setAlertDismissed(true)} className="absolute right-3 top-3 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer text-destructive hover:text-destructive/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded" aria-label="Dismiss alert">
            <X className="h-4 w-4" />
          </button>
        </Alert>
      )}

      {/* Section 1 — Stat Cards (click to filter the table below) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {statCards.map((s) => (
          <Card
            key={s.label}
            role="button"
            tabIndex={0}
            aria-pressed={statusFilter === s.status}
            onClick={() => toggleStatusFilter(s.status)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleStatusFilter(s.status); } }}
            className={cn(
              "cursor-pointer transition-shadow hover:shadow-md",
              statusFilter === s.status && "ring-2 ring-primary"
            )}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <div className={`rounded-md p-2 ${s.bg}`}>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-foreground">{s.count}</p>
              <p className="text-xs text-muted-foreground mt-1">drug(s)</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pending Requests Card */}
      <PendingRequestsCard navigate={navigate} />

      {/* Section 3 — Drug Stock Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Drug Stock Status
            {statusFilter && <span className="ml-2 font-normal text-sm text-muted-foreground">— filtered to {statusFilter}</span>}
          </CardTitle>
          {statusFilter && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setStatusFilter(null)}>
              Clear filter
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Drug Name</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[120px]">% Max</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleDrugStocks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    {statusFilter
                      ? `No drugs with status ${statusFilter}.`
                      : "No drugs yet. Add drugs in Drug Master to start tracking stock."}
                  </TableCell>
                </TableRow>
              )}
              {visibleDrugStocks.map((d) => {
                const cfg = STATUS_CONFIG[d.status];
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">{d.drug_name}</TableCell>
                    <TableCell className="text-right font-bold">{d.balance}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cfg.badgeClass}>{d.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Progress value={d.pctMax} className="h-2" />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {d.lastUpdated ? formatDistanceToNow(new Date(d.lastUpdated), { addSuffix: true }) : "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs relative after:absolute after:-inset-2 after:content-[''] after:md:hidden" onClick={() => navigate(`/pesakit?drug=${d.id}`)}>
                        <Users className="h-3 w-3 mr-1" /> Patient Registry
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Bottom row: Activity Feed + Import Status */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Section 4 — Recent Activity */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
            <Button variant="link" size="sm" className="text-xs" onClick={() => navigate("/terimaan")}>
              View All
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {activityFeed.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No recent activity</p>
            )}
            {activityFeed.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge
                    variant="outline"
                    className={
                      a.jenis === "terimaan"
                        ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700"
                        : "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700"
                    }
                  >
                    {a.jenis === "terimaan" ? "Receipt" : "Dispensed"}
                  </Badge>
                  <span className="font-medium truncate">{a.drug_name}</span>
                  <span className="text-muted-foreground">×{a.kuantiti}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-muted-foreground text-xs">
                  <span>{a.nama_pegawai}</span>
                  <span>{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Section 5 — Recent Dispensing */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Recent Dispensing</CardTitle>
            <Button variant="link" size="sm" className="text-xs" onClick={() => navigate("/laporan")}>
              View All
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Drug</TableHead>
                  <TableHead className="text-xs">Patient</TableHead>
                  <TableHead className="text-xs">IC</TableHead>
                  <TableHead className="text-xs text-right">Qty</TableHead>
                  <TableHead className="text-xs">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!recentDispensing || recentDispensing.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                      No dispensing records yet
                    </TableCell>
                  </TableRow>
                ) : (
                  recentDispensing.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-medium truncate max-w-[120px]">{r.drugs?.drug_name ?? "—"}</TableCell>
                      <TableCell className="text-xs truncate max-w-[130px]">{r.patient_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.no_ic}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{r.quantity}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {r.fulfilled_at ? formatDistanceToNow(new Date(r.fulfilled_at), { addSuffix: true }) : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PendingRequestsCard({ navigate }: { navigate: (path: string) => void }) {
  const { data: ubatCount = 0 } = useQuery({
    queryKey: ["dashboard-pending-ubat"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("dispensing_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_pharmacy");
      if (error) return 0;
      return count ?? 0;
    },
  });

  const { data: abCount = 0 } = useQuery({
    queryKey: ["dashboard-pending-ab"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("antibiotic_forms")
        .select("id")
        .eq("status", "approved")
        .is("acknowledged_at", null);
      if (error) return 0;
      return data?.length ?? 0;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Pending Requests</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Pill className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Controlled Drug</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{ubatCount} pending</Badge>
            <Button variant="link" size="sm" className="text-xs h-auto p-0 relative after:absolute after:-inset-2 after:content-[''] after:md:hidden" onClick={() => navigate("/fulfilment")}>Process →</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Antibiotic Form</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{abCount} awaiting confirmation</Badge>
            <Button variant="link" size="sm" className="text-xs h-auto p-0 relative after:absolute after:-inset-2 after:content-[''] after:md:hidden" onClick={() => navigate("/fulfilment")}>Review →</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
