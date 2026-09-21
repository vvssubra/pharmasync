import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, useIsFetching } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useDrugQuotaUsage } from "@/hooks/useDrugQuotaUsage";
import { useClinicDrugSettings, resolveDrugSettings } from "@/hooks/useClinicDrugSettings";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import {
  Package, Clock, AlertTriangle, ShieldCheck, Users, ClipboardCheck, RefreshCw, TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { quotaStatus, forecastStatus, daysRemaining, projectedExhaustion, quotaDerivedStatus } from "@/lib/quotaHelpers";
import { computeStock, stockStatus } from "@/lib/stock";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { FmsPanel, MeterBar } from "@/components/fms/FmsPanel";
import { ExpandableStatCard } from "@/components/ui/expandable-stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { AntibioticFormReadOnly } from "@/components/AntibioticFormReadOnly";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Antibiotic forms as this page queries them, decorated with the submitting
// MO's profile name.
type FmsAbFormRow = Tables<"antibiotic_forms"> & { mo_name: string };

type FmsPendingRequest = {
  id: string;
  patient_name: string;
  no_ic: string;
  is_pesara: boolean;
  prescriber_name: string;
  quantity: number;
  mo_name?: string;
  drugs?: {
    drug_name?: string;
    unit_pengukuran?: string;
  } | null;
};

/** Malaysian IC begins with YYMMDD; convert to age with fallback for invalid values. */
function ageFromIC(ic: string): string {
  const digits = (ic || "").replace(/\D/g, "");
  if (digits.length < 6) return "—";
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd) || mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return "—";
  }
  const now = new Date();
  const currentYY = now.getFullYear() % 100;
  const fullYear = yy <= currentYY ? 2000 + yy : 1900 + yy;
  const birth = new Date(fullYear, mm - 1, dd);
  if (Number.isNaN(birth.getTime())) return "—";
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  const dayDiff = now.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  if (age < 0 || age > 130) return "—";
  return String(age);
}

const ALREADY_ACTIONED = "already-actioned";

const isAlreadyActioned = (err: unknown) => err instanceof Error && err.message === ALREADY_ACTIONED;

/** User-facing text for a failed approve/reject write. */
function decisionErrorMessage(err: unknown, verb: string, noun: string): string {
  if (isAlreadyActioned(err)) {
    return `This ${noun} was already actioned by another reviewer. The list has been refreshed.`;
  }
  const reason = (err as { message?: string } | null)?.message;
  return `Couldn't ${verb} this ${noun}${reason ? `: ${reason}` : ""}. Check the queue, then try again.`;
}

// Both decision writes are guarded on status = pending_specialist and must
// touch exactly one row. Without the guard, a second reviewer's stale dialog
// could flip an already-decided request; without the row check, RLS filtering
// the write to zero rows would still report success.
async function decideDispensingRequest(id: string, patch: TablesUpdate<"dispensing_requests">) {
  const { data, error } = await supabase
    .from("dispensing_requests")
    .update(patch)
    .eq("id", id)
    .eq("status", "pending_specialist")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(ALREADY_ACTIONED);
}

async function decideAntibioticForm(id: string, patch: TablesUpdate<"antibiotic_forms">) {
  const { data, error } = await supabase
    .from("antibiotic_forms")
    .update(patch)
    .eq("id", id)
    .eq("status", "pending_specialist")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(ALREADY_ACTIONED);
}

/** A query that failed with nothing cached has no data to show at all. */
const failedEmpty = (isError: boolean, updatedAt: number) => isError && updatedAt === 0;

function QueryError({ what, onRetry, staleAt }: { what: string; onRetry: () => void; staleAt?: number }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 border-b bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {staleAt
          ? `Couldn't refresh ${what}. Showing data from ${format(staleAt, "h:mm a")}.`
          : `Couldn't load ${what}.`}
      </span>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRetry}>Retry</Button>
    </div>
  );
}

const FORECAST_STATUS_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-300",
  warning:  "bg-amber-100 text-amber-700 border-amber-300",
  healthy:  "bg-green-100 text-green-700 border-green-300",
  "no-data": "",
};

const STATUS_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-300",
  low:      "bg-amber-100 text-amber-700 border-amber-300",
  normal:   "bg-green-100 text-green-700 border-green-300",
};

interface StatTileProps {
  icon: LucideIcon;
  value: number | string;
  label: string;
  /** One line under the label: which drugs, or that everything is fine. */
  detail?: string;
  active: boolean;
  onSelect: () => void;
  className?: string;
  iconClassName?: string;
  valueClassName?: string;
}

/** Clickable summary card that toggles a table filter. */
function StatTile({ icon: Icon, value, label, detail, active, onSelect, className, iconClassName, valueClassName }: StatTileProps) {
  return (
    <Card
      role="button" tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className={cn("cursor-pointer transition-shadow hover:shadow-md", className, active && "ring-2 ring-primary")}
    >
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-3">
          <Icon className={cn("h-6 w-6 shrink-0", iconClassName)} />
          <div>
            <p className={cn("text-2xl font-bold tabular-nums", valueClassName)}>{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
        {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
}

export default function FmsDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedDrugId, setSelectedDrugId] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<"critical" | "low" | null>(null);
  const pendingApprovalsRef = useRef<HTMLDivElement>(null);
  const [approveTarget, setApproveTarget] = useState<FmsPendingRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<FmsPendingRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [abApproveTarget, setAbApproveTarget] = useState<FmsAbFormRow | null>(null);
  const [abNotes, setAbNotes] = useState("");
  const [abRejectTarget, setAbRejectTarget] = useState<FmsAbFormRow | null>(null);
  const [abRejectReason, setAbRejectReason] = useState("");

  const approveMutation = useMutation({
    mutationFn: async () => {
      const id = approveTarget?.id;
      if (!id) throw new Error("No approval target selected");
      await decideDispensingRequest(id, {
        status: "pending_pharmacy",
        specialist_id: user?.id,
        specialist_action_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      setApproveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["fms-pending-requests"] });
      toast.success("Request approved — sent to pharmacist");
    },
    onError: (err) => {
      if (isAlreadyActioned(err)) {
        setApproveTarget(null);
        queryClient.invalidateQueries({ queryKey: ["fms-pending-requests"] });
      }
      toast.error(decisionErrorMessage(err, "approve", "request"));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await decideDispensingRequest(id, {
        status: "rejected",
        specialist_id: user?.id,
        specialist_action_at: new Date().toISOString(),
        specialist_notes: reason,
      });
    },
    onSuccess: () => {
      setRejectTarget(null);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["fms-pending-requests"] });
      toast.success("Request rejected");
    },
    onError: (err) => {
      if (isAlreadyActioned(err)) {
        setRejectTarget(null);
        setRejectReason("");
        queryClient.invalidateQueries({ queryKey: ["fms-pending-requests"] });
      }
      toast.error(decisionErrorMessage(err, "reject", "request"));
    },
  });

  const abApproveMutation = useMutation({
    mutationFn: async () => {
      const id = abApproveTarget?.id;
      if (!id) throw new Error("No approval target");
      await decideAntibioticForm(id, {
        status: "approved",
        specialist_id: user?.id,
        specialist_action_at: new Date().toISOString(),
        specialist_notes: abNotes || null,
      });
    },
    onSuccess: () => {
      setAbApproveTarget(null);
      setAbNotes("");
      queryClient.invalidateQueries({ queryKey: ["fms-pending-antibiotic"] });
      toast.success("Antibiotic form approved");
    },
    onError: (err) => {
      if (isAlreadyActioned(err)) {
        setAbApproveTarget(null);
        setAbNotes("");
        queryClient.invalidateQueries({ queryKey: ["fms-pending-antibiotic"] });
      }
      toast.error(decisionErrorMessage(err, "approve", "antibiotic form"));
    },
  });

  const abRejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await decideAntibioticForm(id, {
        status: "rejected",
        specialist_id: user?.id,
        specialist_action_at: new Date().toISOString(),
        specialist_notes: reason,
      });
    },
    onSuccess: () => {
      setAbRejectTarget(null);
      setAbRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["fms-pending-antibiotic"] });
      toast.success("Antibiotic form rejected");
    },
    onError: (err) => {
      if (isAlreadyActioned(err)) {
        setAbRejectTarget(null);
        setAbRejectReason("");
        queryClient.invalidateQueries({ queryKey: ["fms-pending-antibiotic"] });
      }
      toast.error(decisionErrorMessage(err, "reject", "antibiotic form"));
    },
  });

  // Drug stock quota
  const {
    data: drugStock = [], isLoading: stockLoading, isError: stockError,
    dataUpdatedAt: stockUpdatedAt, refetch: refetchStock,
  } = useQuery({
    queryKey: ["fms-drug-stock"],
    refetchInterval: 30000,
    queryFn: async () => {
      const [drugsRes, txnsRes] = await Promise.all([
        supabase
          .from("drugs")
          .select("id, drug_name, unit_pengukuran, perlu_kelulusan_pakar")
          .eq("is_active", true)
          .order("drug_name"),
        supabase
          .from("transactions")
          .select("drug_id, jenis, kuantiti, tarikh, created_at"),
      ]);
      // A failed ledger fetch must not fall through to []: every drug would
      // compute to 0 stock and read as "critical".
      if (drugsRes.error) throw drugsRes.error;
      if (txnsRes.error) throw txnsRes.error;
      return (drugsRes.data ?? []).map(d => ({
        ...d,
        current_stock: computeStock(d.id, txnsRes.data ?? []),
      }));
    },
  });

  // Pending controlled drug requests from MO
  const {
    data: pendingRequests = [], isLoading: reqLoading, isError: reqError,
    dataUpdatedAt: reqUpdatedAt, refetch: refetchReq,
  } = useQuery({
    queryKey: ["fms-pending-requests"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data: reqs, error: reqsError } = await supabase
        .from("dispensing_requests")
        .select("*, drugs(drug_name, unit_pengukuran)")
        .eq("status", "pending_specialist")
        .order("created_at", { ascending: false });
      if (reqsError) throw reqsError;

      const ids = [...new Set((reqs ?? []).map(r => r.submitted_by).filter(Boolean))];
      const profileMap: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", ids);
        for (const p of profiles ?? []) profileMap[p.user_id] = p.full_name;
      }

      return (reqs ?? []).map(r => ({
        ...r,
        mo_name: profileMap[r.submitted_by] ?? "Unknown MO",
      }));
    },
  });

  // Pending antibiotic forms from MO
  const {
    data: pendingAntibiotic = [], isLoading: abLoading, isError: abError,
    dataUpdatedAt: abUpdatedAt, refetch: refetchAb,
  } = useQuery({
    queryKey: ["fms-pending-antibiotic"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data: forms, error: formsError } = await supabase
        .from("antibiotic_forms")
        .select("*")
        .eq("status", "pending_specialist")
        .order("created_at", { ascending: false });
      if (formsError) throw formsError;

      const ids = [...new Set((forms ?? []).map((f) => f.submitted_by).filter(Boolean))];
      const profileMap: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", ids);
        for (const p of profiles ?? []) profileMap[p.user_id] = p.full_name;
      }

      return (forms ?? []).map((f): FmsAbFormRow => ({
        ...f,
        mo_name: (f.submitted_by && profileMap[f.submitted_by]) || "Unknown MO",
      }));
    },
  });

  const currentYear = new Date().getFullYear();

  // Server-computed usage — dedupes by IC and includes enrolments, so it
  // agrees with DoctorRequest/MoDashboard/SpecialistDashboard/DrugMaster.
  const {
    byDrugId: quotaUsageByDrug, isLoading: quotaLoading, isError: quotaError,
    dataUpdatedAt: quotaUpdatedAt, refetch: refetchQuota,
  } = useDrugQuotaUsage(currentYear);
  const {
    byDrugId: settingsByDrugId, isLoading: settingsLoading, isError: settingsError,
    dataUpdatedAt: settingsUpdatedAt, refetch: refetchSettings,
  } = useClinicDrugSettings();

  // Pesara patients are exempt from quota entirely — kept as its own query,
  // not part of drug_quota_used()/get_drug_quota_usage().
  const {
    data: pesaraCounts = {}, isLoading: pesaraLoading, isError: pesaraError,
    dataUpdatedAt: pesaraUpdatedAt, refetch: refetchPesara,
  } = useQuery({
    queryKey: ["fms-pesara-counts", currentYear],
    refetchInterval: 30000,
    queryFn: async () => {
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear + 1}-01-01`;
      const { data, error } = await supabase
        .from("dispensing_requests")
        .select("drug_id, no_ic")
        .eq("status", "fulfilled")
        .eq("is_pesara", true)
        .gte("created_at", yearStart)
        .lt("created_at", yearEnd);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of data ?? []) {
        counts[r.drug_id] = (counts[r.drug_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  const {
    data: usage30 = {}, isLoading: usage30Loading, isError: usage30Error,
    dataUpdatedAt: usage30UpdatedAt, refetch: refetchUsage30,
  } = useQuery({
    queryKey: ["fms-usage-30"],
    refetchInterval: 30000,
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 30);
      const { data, error } = await supabase.from("transactions").select("drug_id, kuantiti").eq("jenis", "keluaran").gte("created_at", since.toISOString());
      if (error) throw error;
      const totals: Record<string, number> = {};
      for (const t of data ?? []) totals[t.drug_id] = (totals[t.drug_id] ?? 0) + t.kuantiti;
      return totals;
    },
  });

  // Usage graph data
  const {
    data: usageData = [], isLoading: usageLoading, isError: usageError,
    dataUpdatedAt: usageUpdatedAt, refetch: refetchUsage,
  } = useQuery({
    queryKey: ["fms-usage", selectedDrugId],
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("drug_id, kuantiti, created_at")
        .eq("jenis", "keluaran")
        .order("created_at", { ascending: true });
      if (selectedDrugId !== "all") {
        query = query.eq("drug_id", selectedDrugId);
      }
      const { data, error } = await query;
      if (error) throw error;
      const byMonth: Record<string, number> = {};
      for (const t of data ?? []) {
        const month = (t.created_at as string).slice(0, 7);
        byMonth[month] = (byMonth[month] ?? 0) + t.kuantiti;
      }
      return Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, qty]) => ({ month, qty }));
    },
  });

  // Controlled drugs (insulin under the FMS quota register) aren't tracked by
  // physical stock thresholds — Critical/Low/Normal must come from remaining
  // annual quota instead. Non-controlled drugs keep the physical-stock status.
  const effectiveStatus = (d: typeof drugStock[number]) => {
    const settings = resolveDrugSettings(settingsByDrugId, d.id);
    return quotaDerivedStatus(d.perlu_kelulusan_pakar, quotaUsageByDrug.get(d.id))
      ?? stockStatus(d.current_stock, settings.stok_min, settings.stok_reorder);
  };

  // Drug Stock Quota table shows remaining annual quota for controlled
  // drugs instead of physical vial count — physical stock isn't the
  // operative constraint for them.
  const displayStock = (d: typeof drugStock[number]) => {
    const quota = quotaUsageByDrug.get(d.id);
    return d.perlu_kelulusan_pakar && quota ? quota.remaining : d.current_stock;
  };

  // Loading / failure gates. A count or status computed from half-loaded or
  // failed data is worse than no number: 0 pending reads as "all clear", and
  // an empty ledger reads as every drug being critical.
  const stockUnavailable = failedEmpty(stockError, stockUpdatedAt);
  const stockReady = !stockLoading && !stockUnavailable;

  // Stock status also needs the quota usage (controlled drugs) and this
  // clinic's thresholds; all three must have landed.
  const statusLoading = stockLoading || quotaLoading || settingsLoading;
  const statusFailed = !statusLoading && (
    stockUnavailable || failedEmpty(quotaError, quotaUpdatedAt) || failedEmpty(settingsError, settingsUpdatedAt)
  );
  const statusReady = !statusLoading && !statusFailed;
  const statusStale = statusReady && (stockError || quotaError || settingsError);
  const statusStaleAt = Math.min(
    ...[stockUpdatedAt, quotaUpdatedAt, settingsUpdatedAt].filter(t => t > 0),
  );
  const retryStatus = () => { refetchStock(); refetchQuota(); refetchSettings(); };

  const quotaTableLoading = stockLoading || quotaLoading || pesaraLoading;
  const quotaTableFailed = !quotaTableLoading && (
    stockUnavailable || failedEmpty(quotaError, quotaUpdatedAt) || failedEmpty(pesaraError, pesaraUpdatedAt)
  );
  const quotaTableStale = quotaTableFailed ? false : (stockError || quotaError || pesaraError);
  const retryQuotaTable = () => { refetchStock(); refetchQuota(); refetchPesara(); };

  const forecastLoading = stockLoading || usage30Loading;
  const forecastFailed = !forecastLoading && (stockUnavailable || failedEmpty(usage30Error, usage30UpdatedAt));
  const forecastStale = forecastFailed ? false : (stockError || usage30Error);
  const retryForecast = () => { refetchStock(); refetchUsage30(); };

  const reqFailed = failedEmpty(reqError, reqUpdatedAt);
  const abFailed = failedEmpty(abError, abUpdatedAt);
  const pendingLoading = reqLoading || abLoading;
  const pendingReady = !pendingLoading && !reqFailed && !abFailed;

  const criticalDrugs = drugStock.filter(d => effectiveStatus(d) === "critical");
  const lowDrugs = drugStock.filter(d => effectiveStatus(d) === "low");
  const criticalCount = criticalDrugs.length;
  const lowCount = lowDrugs.length;
  const visibleStock = drugStock.filter(d => !stockFilter || effectiveStatus(d) === stockFilter);
  const controlledDrugs = drugStock.filter(d => d.perlu_kelulusan_pakar);
  const nonControlledDrugs = drugStock.filter(d => !d.perlu_kelulusan_pakar);

  // "Last synced" is the oldest of the core feeds, so it never claims to be
  // fresher than the stalest number on screen.
  const syncedTimes = [stockUpdatedAt, reqUpdatedAt, abUpdatedAt, quotaUpdatedAt].filter(t => t > 0);
  const lastSynced = syncedTimes.length === 4 ? Math.min(...syncedTimes) : 0;
  const isRefreshing = useIsFetching() > 0;
  const refreshAll = () => {
    refetchStock(); refetchReq(); refetchAb(); refetchQuota(); refetchSettings();
    refetchPesara(); refetchUsage30(); refetchUsage();
  };

  const listNames = (rows: typeof drugStock) =>
    rows.length <= 2
      ? rows.map(d => d.drug_name).join(", ")
      : `${rows.slice(0, 2).map(d => d.drug_name).join(", ")} +${rows.length - 2} more`;

  // Usage summary for the side panel, derived from the same monthly series the chart plots.
  const usageTotal = usageData.reduce((sum, m) => sum + m.qty, 0);
  const usagePeak = usageData.reduce<{ month: string; qty: number } | null>(
    (best, m) => (!best || m.qty > best.qty ? m : best), null,
  );
  const usageMonthlyAvg = usageData.length > 0 ? usageTotal / usageData.length : 0;
  const monthLabel = (ym: string) => format(new Date(`${ym}-01T00:00:00`), "MMM yy");

  const tabBadge = (n: number) => n > 0 && (
    <Badge variant="destructive" className="ml-1.5 h-5 min-w-5 rounded-full px-1.5 text-[10px]">{n}</Badge>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-semibold uppercase tracking-wide text-secondary-foreground">
              FMS Protocol Portal
            </span>
            {lastSynced > 0 && (
              <span className="flex items-center gap-1">
                <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin motion-reduce:animate-none")} aria-hidden />
                Last synced {format(lastSynced, "h:mm a")}
              </span>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">FMS Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drug stock overview, pending MO approvals, and usage trends.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={isRefreshing}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isRefreshing && "animate-spin motion-reduce:animate-none")} aria-hidden />
          Refresh
        </Button>
      </header>

      {/* Summary cards — click Critical/Low to filter the stock table below;
          click Active Drugs to clear the filter; click Pending Approvals to
          jump to the queue. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Package} iconClassName="text-emerald-600"
          value={stockReady ? drugStock.length : "—"} label="Active Drugs"
          detail={statusReady
            ? `${drugStock.length - criticalCount - lowCount} of ${drugStock.length} in normal range`
            : undefined}
          active={stockFilter === null}
          onSelect={() => setStockFilter(null)}
        />
        <StatTile
          icon={AlertTriangle} iconClassName="text-red-600"
          className="bg-red-50" valueClassName="text-red-700"
          value={statusReady ? criticalCount : "—"} label="Critical Stock"
          detail={statusReady ? (criticalCount > 0 ? listNames(criticalDrugs) : "All clear") : undefined}
          active={stockFilter === "critical"}
          onSelect={() => setStockFilter((f) => (f === "critical" ? null : "critical"))}
        />
        <StatTile
          icon={AlertTriangle} iconClassName="text-amber-600"
          className="bg-amber-50" valueClassName="text-amber-700"
          value={statusReady ? lowCount : "—"} label="Low Stock"
          detail={statusReady ? (lowCount > 0 ? listNames(lowDrugs) : "None running low") : undefined}
          active={stockFilter === "low"}
          onSelect={() => setStockFilter((f) => (f === "low" ? null : "low"))}
        />
        {pendingReady ? (
          <ExpandableStatCard
            icon={Clock}
            count={pendingRequests.length + pendingAntibiotic.length}
            label="Pending Approvals"
            bgClassName="bg-yellow-50"
            colorClassName="text-yellow-700"
            breakdown={[
              { label: "Drug requests", value: pendingRequests.length },
              { label: "Antibiotic forms", value: pendingAntibiotic.length },
            ]}
            onClick={() => pendingApprovalsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          />
        ) : (
          // Not a 0: while loading, or after a failed fetch, "0 pending" would
          // read as "nothing to approve".
          <Card className="bg-yellow-50" data-testid="stat-card-Pending Approvals-unavailable">
            <CardContent className="flex items-center gap-3 p-4">
              <Clock className="h-6 w-6 text-yellow-700" />
              <div>
                {pendingLoading
                  ? <Skeleton className="h-8 w-10" />
                  : <p className="text-2xl font-bold text-yellow-700" aria-label="Pending approvals unavailable">—</p>}
                <p className="text-xs text-muted-foreground">Pending Approvals</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Clinical request queue — first content section: it is the only place
          on this page the FMS has to act. */}
      <div ref={pendingApprovalsRef} id="pending-queue" className="scroll-mt-4">
        <Tabs defaultValue="controlled">
          <FmsPanel
            icon={ClipboardCheck}
            title="Clinical Request Queue"
            description="Awaiting FMS sign-off. Newest first."
            flush
            action={
              <TabsList>
                <TabsTrigger value="controlled">
                  Controlled Drug Requests
                  {tabBadge(pendingRequests.length)}
                </TabsTrigger>
                <TabsTrigger value="antibiotic">
                  Antibiotic Forms
                  {tabBadge(pendingAntibiotic.length)}
                </TabsTrigger>
              </TabsList>
            }
          >
            <TabsContent value="controlled" className="mt-0">
              {reqLoading ? (
                <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
              ) : reqFailed ? (
                <QueryError what="pending drug requests" onRetry={() => refetchReq()} />
              ) : (
                <>
                  {reqError && <QueryError what="pending drug requests" onRetry={() => refetchReq()} staleAt={reqUpdatedAt} />}
                  {pendingRequests.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No pending drug requests</p>
                  ) : (
                    <ul className="divide-y">
                      {pendingRequests.map(r => {
                        const quotaRow = quotaUsageByDrug.get(r.drug_id);
                        const age = ageFromIC(r.no_ic);
                        return (
                          <li key={r.id} className="space-y-3 p-4 sm:px-5">
                            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground">{r.drugs?.drug_name}</p>
                                <p className="text-xs text-muted-foreground tabular-nums">
                                  {r.quantity} {r.drugs?.unit_pengukuran}
                                </p>
                              </div>
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" aria-hidden />
                                {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                              </p>
                            </div>
                            <dl className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-3">
                              <div>
                                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Patient</dt>
                                <dd className="mt-0.5 font-medium">{r.patient_name}</dd>
                                <dd className="text-xs text-muted-foreground">
                                  {age === "—" ? "Age unknown" : `${age} tahun`} · {r.is_pesara ? "Pesara" : "Non-Pesara"}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Prescriber</dt>
                                <dd className="mt-0.5 font-medium">{r.prescriber_name || r.mo_name || "—"}</dd>
                                <dd className="text-xs text-muted-foreground">Submitted by {r.mo_name}</dd>
                              </div>
                              <div>
                                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">National quota</dt>
                                {r.is_pesara ? (
                                  <dd className="mt-0.5 font-medium">Exempt</dd>
                                ) : quotaRow ? (
                                  <dd className="mt-0.5 font-medium tabular-nums">
                                    {quotaRow.remaining} <span className="font-normal text-muted-foreground">of {quotaRow.quota_limit} remaining</span>
                                  </dd>
                                ) : (
                                  <dd className="mt-0.5 font-medium text-muted-foreground">{quotaLoading ? "…" : "No quota set"}</dd>
                                )}
                                {r.is_pesara && <dd className="text-xs text-muted-foreground">Pesara are not counted</dd>}
                              </div>
                            </dl>
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                size="touch"
                                variant="destructive"
                                className="text-xs"
                                onClick={() => { setRejectTarget(r); setRejectReason(""); }}
                              >
                                Reject
                              </Button>
                              <Button
                                size="touch"
                                className="bg-green-600 text-xs text-white hover:bg-green-700"
                                onClick={() => setApproveTarget(r)}
                                disabled={approveMutation.isPending}
                              >
                                Approve
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="antibiotic" className="mt-0">
              {abLoading ? (
                <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
              ) : abFailed ? (
                <QueryError what="pending antibiotic forms" onRetry={() => refetchAb()} />
              ) : (
                <>
                  {abError && <QueryError what="pending antibiotic forms" onRetry={() => refetchAb()} staleAt={abUpdatedAt} />}
                  {pendingAntibiotic.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No antibiotic forms pending</p>
                  ) : (
                    <ul className="divide-y">
                      {pendingAntibiotic.map((f) => (
                        <li key={f.id} className="space-y-3 p-4 sm:px-5">
                          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">{f.patient_name}</p>
                              <p className="text-xs text-muted-foreground">Submitted by {f.mo_name}</p>
                            </div>
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" aria-hidden />
                              {formatDistanceToNow(new Date(f.created_at), { addSuffix: true })}
                            </p>
                          </div>
                          <dl className="rounded-md bg-muted/50 p-3 text-sm">
                            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Diagnosis</dt>
                            <dd className="mt-0.5 font-medium">{f.diagnosis}</dd>
                          </dl>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              size="touch"
                              variant="destructive"
                              className="text-xs"
                              onClick={() => { setAbRejectTarget(f); setAbRejectReason(""); }}
                            >
                              Reject
                            </Button>
                            <Button
                              size="touch"
                              className="bg-green-600 text-xs text-white hover:bg-green-700"
                              onClick={() => setAbApproveTarget(f)}
                              disabled={abApproveMutation.isPending}
                            >
                              Review & Approve
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </TabsContent>
          </FmsPanel>
        </Tabs>
      </div>

      {/* Stock table — driven by the summary-card filters */}
      <FmsPanel
        icon={Package}
        title="Drug Stock Quota"
        description={stockFilter ? `Filtered to ${stockFilter}` : "Current stock against this clinic's thresholds"}
        flush
        action={stockFilter && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setStockFilter(null)}>
            Clear filter
          </Button>
        )}
      >
        {statusLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : statusFailed ? (
          <QueryError what="stock levels" onRetry={retryStatus} />
        ) : (
          <>
            {statusStale && <QueryError what="stock levels" onRetry={retryStatus} staleAt={statusStaleAt} />}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Drug Name</TableHead>
                  <TableHead className="text-right">Current Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleStock.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">{stockFilter ? `No ${stockFilter} drugs.` : "No active drugs."}</TableCell></TableRow>
                ) : visibleStock.map(d => {
                  const status = effectiveStatus(d);
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.drug_name}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{displayStock(d)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_BADGE[status]}`}>
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="relative h-7 px-2 text-xs after:absolute after:-inset-2 after:content-[''] after:md:hidden" onClick={() => navigate(`/pesakit?drug=${d.id}`)}>
                          <Users className="mr-1 h-3 w-3" /> Patient Registry
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </FmsPanel>

      {/* Usage trend */}
      <FmsPanel
        icon={TrendingUp}
        title="Drug Usage Trend (Dispensed)"
        description="Units dispensed per month, all recorded months"
        action={
          <Select value={selectedDrugId} onValueChange={setSelectedDrugId}>
            <SelectTrigger className="h-8 w-full text-xs sm:w-52" aria-label="Filter usage by drug">
              <SelectValue placeholder="All drugs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All drugs</SelectItem>
              {drugStock.map(d => (
                <SelectItem key={d.id} value={d.id} className="text-xs">{d.drug_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {usageLoading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : failedEmpty(usageError, usageUpdatedAt) ? (
          <QueryError what="the usage trend" onRetry={() => refetchUsage()} />
        ) : usageData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No dispensing records found.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="rounded-md bg-muted/40 p-3 lg:col-span-9">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={usageData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="fms-usage-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  {/* Theme tokens rather than hardcoded hex, so the chart follows
                      the palette like everything else. */}
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  {/* At ~300px wide the month labels collided; thin them out and
                      keep the first and last so the range stays readable. */}
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={monthLabel} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} width={36} />
                  <Tooltip
                    labelFormatter={monthLabel}
                    contentStyle={{
                      background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
                      borderRadius: 6, fontSize: 12,
                    }}
                  />
                  {/* No Legend: one series, and on a phone it was pure vertical
                      cost — the panel description already says what it is. */}
                  <Area type="monotone" dataKey="qty" name="Units dispensed" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#fms-usage-fill)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <dl className="grid gap-3 sm:grid-cols-3 lg:col-span-3 lg:grid-cols-1">
              <div className="rounded-md bg-muted/40 p-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total dispensed</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{usageTotal.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">units</span></dd>
              </div>
              <div className="rounded-md bg-muted/40 p-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Monthly average</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{Math.round(usageMonthlyAvg).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">units / month</span></dd>
              </div>
              {usagePeak && (
                <div className="rounded-md bg-muted/40 p-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Peak month</dt>
                  <dd className="mt-0.5 text-lg font-semibold">{monthLabel(usagePeak.month)}</dd>
                  <dd className="text-xs text-muted-foreground tabular-nums">{usagePeak.qty.toLocaleString()} units</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </FmsPanel>

      {/* Controlled drug annual quota */}
      <FmsPanel
        icon={ShieldCheck}
        title="Controlled Drug Annual Quota (National)"
        description={`Shared national pool for ${currentYear}, not this clinic's own balance`}
        flush
      >
        {quotaTableLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : quotaTableFailed ? (
          <QueryError what="quota figures" onRetry={retryQuotaTable} />
        ) : (
          <>
            {quotaTableStale && <QueryError what="quota figures" onRetry={retryQuotaTable} staleAt={Math.min(...[stockUpdatedAt, quotaUpdatedAt, pesaraUpdatedAt].filter(t => t > 0))} />}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Drug Name</TableHead>
                  <TableHead className="text-right">National Annual Quota</TableHead>
                  <TableHead className="text-right">Patients Served YTD (National)</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Projected Exhaustion</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Pesara</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {controlledDrugs.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No controlled drugs found</TableCell></TableRow>
                ) : controlledDrugs.map(d => {
                  const quotaRow = quotaUsageByDrug.get(d.id);
                  const quota = quotaRow ? quotaRow.quota_limit : null;
                  const served = quotaRow?.used ?? 0;
                  const remaining = quotaRow ? quotaRow.remaining : null;
                  const monthsElapsed = new Date().getMonth() + 1;
                  const avgPerMonth = monthsElapsed > 0 ? served / monthsElapsed : 0;
                  const status = quotaStatus(remaining, quota);
                  const badgeClass: Record<string, string> = {
                    critical: "bg-red-100 text-red-700 border-red-300",
                    warning: "bg-amber-100 text-amber-700 border-amber-300",
                    healthy: "bg-green-100 text-green-700 border-green-300",
                    "no-quota": "bg-gray-100 text-gray-600 border-gray-300",
                  };
                  const meterTone = status === "critical" ? "bad" : status === "warning" ? "warn" : "ok";
                  const pesaraCount = (pesaraCounts as Record<string, number>)[d.id] ?? 0;
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="text-sm font-medium">{d.drug_name}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{quota ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{served}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-sm font-semibold tabular-nums">{remaining !== null ? remaining : "—"}</span>
                          {quota ? <MeterBar pct={((remaining ?? 0) / quota) * 100} tone={meterTone} className="w-24" /> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {quota === null ? "No quota set" : projectedExhaustion(remaining!, avgPerMonth)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] capitalize ${badgeClass[status]}`}>
                          {status === "no-quota" ? "No quota" : status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <span className={pesaraCount > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}>
                          {pesaraCount} (Unlimited)
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </FmsPanel>

      {/* Approve dialog */}
      <Dialog open={!!approveTarget} onOpenChange={open => { if (!open) setApproveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Drug Request</DialogTitle>
          </DialogHeader>
          {approveTarget && (
            <div className="space-y-3 text-sm">
              <div className="rounded border p-3 space-y-1">
                <p><span className="text-muted-foreground">Patient:</span> <span className="font-medium">{approveTarget.patient_name}</span></p>
                <p><span className="text-muted-foreground">Age:</span> {ageFromIC(approveTarget.no_ic) === "—" ? "—" : `${ageFromIC(approveTarget.no_ic)} tahun`}</p>
                <p><span className="text-muted-foreground">Category:</span> {approveTarget.is_pesara ? "Pesara" : "Non-Pesara"}</p>
                <p><span className="text-muted-foreground">Prescribed by (MO):</span> {approveTarget.prescriber_name || approveTarget.mo_name || "—"}</p>
                <p><span className="text-muted-foreground">Drug:</span> {approveTarget.drugs?.drug_name || "—"}</p>
                <p><span className="text-muted-foreground">Quantity:</span> {approveTarget.quantity} {approveTarget.drugs?.unit_pengukuran || ""}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? "Processing..." : "Confirm Approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={open => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Drug Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {rejectTarget && (
              <p className="text-sm text-muted-foreground">
                Patient: <span className="font-medium text-foreground">{rejectTarget.patient_name}</span> —{" "}
                {rejectTarget.drugs?.drug_name} × {rejectTarget.quantity}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">Reason for rejection</Label>
              <Textarea
                id="reject-reason"
                placeholder="Enter rejection reason..."
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectTarget || !rejectReason.trim() || rejectMutation.isPending}
              onClick={() => rejectTarget && rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason })}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Antibiotic Approve Dialog — full form review, matching SpecialistDashboard */}
      <Dialog open={!!abApproveTarget} onOpenChange={open => { if (!open) { setAbApproveTarget(null); setAbNotes(""); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review Antibiotic Form — {abApproveTarget?.patient_name}</DialogTitle>
          </DialogHeader>
          {abApproveTarget && (
            <div className="space-y-4">
              {/* mo_name is this page's own label for the resolved submitted_by
                  profile (see the query above); the viewer reads it as
                  submitted_by_name, the name the archive uses. */}
              <AntibioticFormReadOnly form={{ ...abApproveTarget, submitted_by_name: abApproveTarget.mo_name }} />
              <div className="space-y-2">
                <Label>Approval Notes (optional)</Label>
                <Textarea placeholder="Additional notes" value={abNotes} onChange={e => setAbNotes(e.target.value)} />
              </div>
            </div>
          )}
          {/* Pinned: this is the tallest overlay on this page (a full
              read-only form plus a notes field), so on a phone the
              approve/cancel pair would otherwise sit far below the fold. */}
          <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 bg-background px-6 pb-6 pt-3">
            <Button variant="outline" onClick={() => { setAbApproveTarget(null); setAbNotes(""); }}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={abApproveMutation.isPending}
              onClick={() => abApproveMutation.mutate()}
            >
              {abApproveMutation.isPending ? "Processing..." : "Approve Form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Antibiotic Reject Dialog */}
      <Dialog open={!!abRejectTarget} onOpenChange={open => { if (!open) { setAbRejectTarget(null); setAbRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Antibiotic Form</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {abRejectTarget && (
              <p className="text-muted-foreground">
                Patient: <span className="font-medium text-foreground">{abRejectTarget.patient_name}</span> — {abRejectTarget.diagnosis}
              </p>
            )}
            <div>
              <Label htmlFor="ab-reject-reason">Reason for rejection</Label>
              <Textarea
                id="ab-reject-reason"
                className="mt-1.5 h-24 text-sm"
                placeholder="Enter reason..."
                value={abRejectReason}
                onChange={e => setAbRejectReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAbRejectTarget(null); setAbRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!abRejectTarget || !abRejectReason.trim() || abRejectMutation.isPending}
              onClick={() => abRejectTarget && abRejectMutation.mutate({ id: abRejectTarget.id, reason: abRejectReason })}
            >
              {abRejectMutation.isPending ? "Rejecting..." : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Non-controlled stock forecast */}
      <FmsPanel
        icon={Package}
        title="Non-Controlled Stock Forecast"
        description="Days of stock left at the last 30 days' average usage"
        flush
      >
        {forecastLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : forecastFailed ? (
          <QueryError what="the stock forecast" onRetry={retryForecast} />
        ) : (
          <>
            {forecastStale && <QueryError what="the stock forecast" onRetry={retryForecast} staleAt={Math.min(...[stockUpdatedAt, usage30UpdatedAt].filter(t => t > 0))} />}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Drug Name</TableHead>
                  <TableHead className="text-right">Current Stock</TableHead>
                  <TableHead className="text-right">Avg Daily Usage (30d)</TableHead>
                  <TableHead className="text-right">Days Left</TableHead>
                  <TableHead>Reorder By</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nonControlledDrugs.map(d => {
                  const avgDaily = ((usage30 as Record<string, number>)[d.id] ?? 0) / 30;
                  const days = daysRemaining(d.current_stock, avgDaily);
                  const fStatus = forecastStatus(days);
                  const reorderDate = days !== null && days > 0
                    ? (() => { const dt = new Date(); dt.setDate(dt.getDate() + days - 7); return dt.toLocaleDateString("en-MY", { day: "numeric", month: "short" }); })()
                    : "—";
                  const meterTone = fStatus === "critical" ? "bad" : fStatus === "warning" ? "warn" : "ok";
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="text-sm font-medium">{d.drug_name}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{d.current_stock} <span className="text-xs text-muted-foreground">{d.unit_pengukuran}</span></TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{avgDaily > 0 ? avgDaily.toFixed(1) : "—"}</TableCell>
                      <TableCell className="text-right">
                        {days !== null ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-sm font-semibold tabular-nums">{days}</span>
                            {/* Scale is 30 days: anything beyond a month reads as full. */}
                            <MeterBar pct={(days / 30) * 100} tone={meterTone} className="w-24" />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No usage data</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{reorderDate}</TableCell>
                      <TableCell>
                        {fStatus === "no-data" ? (
                          <span className="text-xs text-muted-foreground">No usage data</span>
                        ) : (
                          <Badge variant="outline" className={`text-[10px] capitalize ${FORECAST_STATUS_BADGE[fStatus]}`}>{fStatus}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </FmsPanel>
    </div>
  );
}
