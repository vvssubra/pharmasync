import { useMemo, useState } from "react";
import { useQuery, useIsFetching } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDrugQuotaUsage } from "@/hooks/useDrugQuotaUsage";
import { useClinicDrugSettings, resolveDrugSettings } from "@/hooks/useClinicDrugSettings";
import { quotaDerivedStatus } from "@/lib/quotaHelpers";
import { computeStock } from "@/lib/stock";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import {
  Stethoscope, ClipboardList, Pill, AlertTriangle, Users, RefreshCw, Search, ShieldCheck, Hourglass,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { FmsPanel, MeterBar } from "@/components/fms/FmsPanel";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface MyRequestRow {
  id: string;
  created_at: string;
  patient_name: string;
  quantity: number;
  status: string;
  drugs: { drug_name: string; unit_pengukuran: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-300",
  low:      "bg-amber-100 text-amber-700 border-amber-300",
  normal:   "bg-green-100 text-green-700 border-green-300",
};

const REQUEST_STATUS_BADGE: Record<string, string> = {
  pending:           "bg-yellow-100 text-yellow-700 border-yellow-300",
  pending_specialist:"bg-blue-100 text-blue-700 border-blue-300",
  pending_pharmacy:  "bg-cyan-100 text-cyan-700 border-cyan-300",
  approved:          "bg-green-100 text-green-700 border-green-300",
  rejected:          "bg-red-100 text-red-700 border-red-300",
  fulfilled:         "bg-gray-100 text-gray-700 border-gray-300",
};

const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending:            "Pending",
  pending_specialist: "Awaiting Approval",
  pending_pharmacy:   "Approved — Awaiting Pharmacist",
  approved:           "Approved",
  rejected:           "Rejected",
  fulfilled:          "Fulfilled",
};

// Antibiotic forms go to the FMS, not the pharmacist, so their statuses read
// differently from drug requests even where the raw values coincide.
const ANTIBIOTIC_STATUS_LABEL: Record<string, string> = {
  pending_specialist: "Awaiting FMS Review",
  approved:           "Approved",
  rejected:           "Returned for correction",
};

interface MyAntibioticRow {
  id: string;
  created_at: string;
  patient_name: string;
  diagnosis: string;
  status: string;
}

// One row of the merged "My Recent Submissions" list: either a drug request
// or an antibiotic form, unified for a single time-sorted table.
interface RecentSubmission {
  id: string;
  created_at: string;
  patient_name: string;
  type: "request" | "antibiotic";
  detail: string;
  statusLabel: string;
  statusBadge: string;
}

interface StatTileProps {
  icon: LucideIcon;
  value: number | string;
  label: string;
  detail?: string;
  active?: boolean;
  onSelect?: () => void;
  className?: string;
  iconClassName?: string;
  valueClassName?: string;
}

/** Summary tile; clickable (filter toggle) only when onSelect is given. */
function StatTile({ icon: Icon, value, label, detail, active, onSelect, className, iconClassName, valueClassName }: StatTileProps) {
  const interactive = !!onSelect;
  return (
    <Card
      {...(interactive && {
        role: "button",
        tabIndex: 0,
        "aria-pressed": !!active,
        onClick: onSelect,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } },
      })}
      className={cn(interactive && "cursor-pointer transition-shadow hover:shadow-md", className, active && "ring-2 ring-primary")}
    >
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-3">
          <Icon className={cn("h-6 w-6 shrink-0", iconClassName)} aria-hidden />
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

export default function MoDashboard() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [stockFilter, setStockFilter] = useState<"critical" | "available" | null>(null);
  const [search, setSearch] = useState("");
  const [approvalOnly, setApprovalOnly] = useState(false);

  // Drug quota
  const { data: rawDrugStock = [], isLoading: stockLoading, dataUpdatedAt: stockUpdatedAt, refetch: refetchStock } = useQuery({
    queryKey: ["mo-drug-quota"],
    refetchInterval: 30000,
    queryFn: async () => {
      const [{ data: drugs }, { data: txns }] = await Promise.all([
        supabase
          .from("drugs")
          .select("id, drug_name, unit_pengukuran, perlu_kelulusan_pakar")
          .eq("is_active", true)
          .order("drug_name"),
        supabase
          .from("transactions")
          .select("drug_id, jenis, kuantiti, tarikh, created_at"),
      ]);
      return (drugs ?? []).map(d => ({ ...d, current_stock: computeStock(d.id, txns ?? []) }));
    },
  });

  const currentYear = new Date().getFullYear();

  // Server-computed usage — also fixes this page's previous status='fulfilled'
  // filter, which under-counted quota use versus every other dashboard
  // (usage is meant to be deducted the moment a request is submitted, not
  // only once the pharmacist fulfils it).
  const { byDrugId: quotaUsageByDrug } = useDrugQuotaUsage(currentYear);
  const { byDrugId: settingsByDrugId } = useClinicDrugSettings();

  // Controlled drugs (insulin under the FMS quota register) aren't tracked by
  // physical stock thresholds — Critical/Low/Normal must come from remaining
  // annual quota instead. Non-controlled drugs keep the physical-stock status.
  const drugStock = useMemo(() => rawDrugStock.map(d => {
    const settings = resolveDrugSettings(settingsByDrugId, d.id);
    let physicalStatus = "normal";
    if (d.current_stock <= settings.stok_min) physicalStatus = "critical";
    else if (d.current_stock <= settings.stok_reorder) physicalStatus = "low";
    return {
      ...d,
      physicalStatus,
      status: quotaDerivedStatus(d.perlu_kelulusan_pakar, quotaUsageByDrug.get(d.id)) ?? physicalStatus,
    };
  }), [rawDrugStock, quotaUsageByDrug, settingsByDrugId]);

  // My recent requests
  const { data: myRequests = [], isLoading: reqLoading, refetch: refetchRequests } = useQuery({
    queryKey: ["mo-my-requests", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("dispensing_requests")
        .select("*, drugs(drug_name, unit_pengukuran)")
        .eq("submitted_by", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      return (data ?? []) as MyRequestRow[];
    },
  });

  // My submitted antibiotic forms. MOs mostly submit these (not drug
  // requests), so the recent list must include them or it sits empty while
  // the MO's actual work is invisible.
  const { data: myForms = [], isLoading: formsLoading, refetch: refetchForms } = useQuery({
    queryKey: ["mo-my-antibiotic-forms", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("antibiotic_forms")
        .select("id, created_at, patient_name, diagnosis, status")
        .eq("submitted_by", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      return (data ?? []) as MyAntibioticRow[];
    },
  });

  // Forms the FMS sent back for correction. 15s poll matches the other queue
  // badges; the push notification is the fast path, this is the reliable one.
  const { data: rejectedForms = [], refetch: refetchRejected } = useQuery({
    queryKey: ["mo-rejected-antibiotic", user?.id],
    enabled: !!user?.id,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase
        .from("antibiotic_forms")
        .select("id, patient_name, diagnosis, specialist_notes, specialist_action_at")
        .eq("submitted_by", user!.id)
        .eq("status", "rejected")
        .order("specialist_action_at", { ascending: false });
      return data ?? [];
    },
  });

  const availableDrugs = drugStock.filter(d => d.status !== "critical");

  const recentSubmissions: RecentSubmission[] = useMemo(() => {
    const reqs: RecentSubmission[] = myRequests.map(r => ({
      id: r.id,
      created_at: r.created_at,
      patient_name: r.patient_name,
      type: "request",
      detail: `${r.drugs?.drug_name ?? ""} — ${r.quantity} ${r.drugs?.unit_pengukuran ?? ""}`,
      statusLabel: REQUEST_STATUS_LABEL[r.status] ?? r.status,
      statusBadge: REQUEST_STATUS_BADGE[r.status] ?? "",
    }));
    const forms: RecentSubmission[] = myForms.map(f => ({
      id: f.id,
      created_at: f.created_at,
      patient_name: f.patient_name,
      type: "antibiotic",
      detail: f.diagnosis,
      statusLabel: ANTIBIOTIC_STATUS_LABEL[f.status] ?? f.status,
      statusBadge: REQUEST_STATUS_BADGE[f.status] ?? "",
    }));
    return [...reqs, ...forms]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 10);
  }, [myRequests, myForms]);

  const pendingReviewCount =
    myRequests.filter(r => r.status === "pending" || r.status === "pending_specialist").length +
    myForms.filter(f => f.status === "pending_specialist").length;

  const visibleDrugs = drugStock.filter(d => {
    if (stockFilter === "critical" && d.status !== "critical") return false;
    if (stockFilter === "available" && d.status === "critical") return false;
    if (approvalOnly && !d.perlu_kelulusan_pakar) return false;
    const q = search.trim().toLowerCase();
    return !q || d.drug_name.toLowerCase().includes(q);
  });
  const criticalCount = drugStock.length - availableDrugs.length;

  const isRefreshing = useIsFetching() > 0;
  const refreshAll = () => {
    refetchStock(); refetchRequests(); refetchForms(); refetchRejected();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-semibold uppercase tracking-wide text-secondary-foreground">
              {profile?.clinic_name ? `Clinic: ${profile.clinic_name}` : "MO Portal"}
            </span>
            {stockUpdatedAt > 0 && (
              <span className="flex items-center gap-1">
                <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin motion-reduce:animate-none")} aria-hidden />
                Last synced {format(stockUpdatedAt, "h:mm a")}
              </span>
            )}
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Stethoscope className="h-6 w-6 text-primary" aria-hidden />
            MO Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}. View available drug quota, track your requests, and submit patient forms.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate("/request/ubat")} className="gap-2">
            <ClipboardList className="h-4 w-4" aria-hidden />
            Drug Request
          </Button>
          <Button variant="outline" onClick={() => navigate("/request/antibiotik")} className="gap-2">
            <Pill className="h-4 w-4" aria-hidden />
            Antibiotic Form
          </Button>
          <Button variant="outline" size="icon" onClick={refreshAll} disabled={isRefreshing} aria-label="Refresh dashboard">
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin motion-reduce:animate-none")} aria-hidden />
          </Button>
        </div>
      </header>

      {/* Antibiotic forms returned by the FMS — the MO's correction queue.
          Rendered above everything else: it is the only item on this page that
          blocks someone else's work. */}
      {rejectedForms.length > 0 && (
        <FmsPanel
          icon={AlertTriangle}
          title={`Returned for correction (${rejectedForms.length})`}
          description="The FMS sent these antibiotic forms back. Correct and resubmit to unblock them."
          className="border-destructive/50"
        >
          <div className="space-y-3">
            {rejectedForms.map((f) => (
              <div
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-destructive/30 bg-destructive/5 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{f.patient_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{f.diagnosis}</p>
                  {f.specialist_notes && (
                    <p className="mt-1 text-xs text-destructive">
                      FMS: {f.specialist_notes}
                    </p>
                  )}
                </div>
                <Button
                  size="touch"
                  variant="destructive"
                  onClick={() => navigate(`/request/antibiotik?edit=${f.id}`)}
                >
                  Correct & resubmit
                </Button>
              </div>
            ))}
          </div>
        </FmsPanel>
      )}

      {/* Summary — first three tiles filter the quota table below */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Pill} iconClassName="text-primary"
          value={stockLoading ? "—" : drugStock.length} label="Active Drugs"
          detail={stockLoading ? undefined : `${drugStock.filter(d => d.perlu_kelulusan_pakar).length} need specialist approval`}
          active={stockFilter === null}
          onSelect={() => setStockFilter(null)}
        />
        <StatTile
          icon={ShieldCheck} iconClassName="text-green-600" valueClassName="text-green-700"
          value={stockLoading ? "—" : availableDrugs.length} label="Available to Request"
          detail="Not critical or depleted"
          active={stockFilter === "available"}
          onSelect={() => setStockFilter((f) => (f === "available" ? null : "available"))}
        />
        <StatTile
          icon={AlertTriangle} iconClassName="text-red-600" valueClassName={criticalCount > 0 ? "text-red-700" : undefined}
          value={stockLoading ? "—" : criticalCount} label="Critical / Out of Stock"
          detail={criticalCount > 0 ? "Requests may be delayed" : "No stockouts"}
          active={stockFilter === "critical"}
          onSelect={() => setStockFilter((f) => (f === "critical" ? null : "critical"))}
        />
        <StatTile
          icon={Hourglass} iconClassName="text-blue-600"
          value={reqLoading || formsLoading ? "—" : pendingReviewCount} label="Pending FMS Review"
          detail="Your latest submissions"
        />
      </div>

      {/* Drug quota table */}
      <FmsPanel
        icon={Pill}
        title="Available Drug Quota"
        description="Live clinic stock and national annual quota per drug"
        flush
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by drug name…"
                aria-label="Filter drugs by name"
                className="h-9 w-48 pl-8 text-sm"
              />
            </div>
            <Button
              variant={approvalOnly ? "secondary" : "outline"}
              size="sm"
              aria-pressed={approvalOnly}
              onClick={() => setApprovalOnly(v => !v)}
              className="gap-1.5"
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Specialist approval only
            </Button>
          </div>
        }
      >
        {stockLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Drug</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Current Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Protocol</TableHead>
                  <TableHead className="min-w-[180px]">National Quota Remaining</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleDrugs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      No drugs match the current filters.
                    </TableCell>
                  </TableRow>
                ) : visibleDrugs.map(d => {
                  const isCritical = d.status === "critical";
                  const quotaRow = d.perlu_kelulusan_pakar ? quotaUsageByDrug.get(d.id) : undefined;
                  const pct = quotaRow && quotaRow.quota_limit > 0 ? (quotaRow.remaining / quotaRow.quota_limit) * 100 : 0;
                  const tone = pct <= 10 ? "bad" : pct <= 25 ? "warn" : "ok";
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                            isCritical ? "bg-red-100 text-red-600" : "bg-secondary text-primary",
                          )}>
                            {isCritical ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Pill className="h-4 w-4" aria-hidden />}
                          </span>
                          <span className="text-sm font-medium">{d.drug_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{d.unit_pengukuran}</TableCell>
                      <TableCell className={cn("text-right font-semibold tabular-nums", isCritical && "text-red-700")}>{d.current_stock}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_BADGE[d.status]}`}>
                          {d.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {d.perlu_kelulusan_pakar ? (
                          <Badge variant="outline" className="gap-1 border-blue-300 bg-blue-50 text-[10px] text-blue-700">
                            <ShieldCheck className="h-3 w-3" aria-hidden /> Specialist Approval
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">Standard</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {!d.perlu_kelulusan_pakar ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : !quotaRow ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">No quota set</Badge>
                        ) : (
                          <div className="space-y-1">
                            <p className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
                              <span className={cn("font-semibold", tone === "bad" && "text-red-700")}>{quotaRow.remaining}</span>
                              <span className="text-xs text-muted-foreground">/ {quotaRow.quota_limit} quota</span>
                            </p>
                            <MeterBar pct={pct} tone={tone} />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs relative after:absolute after:-inset-2 after:content-[''] after:md:hidden" onClick={() => navigate(`/pesakit?drug=${d.id}`)}>
                          <Users className="mr-1 h-3 w-3" aria-hidden /> Patient Registry
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="border-t bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
              Showing {visibleDrugs.length} of {drugStock.length} active drugs.
            </p>
          </>
        )}
      </FmsPanel>

      {/* My recent submissions */}
      <FmsPanel
        icon={ClipboardList}
        title="My Recent Requests"
        description="Drug requests and antibiotic forms you have submitted"
        flush
      >
        {reqLoading || formsLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Time</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentSubmissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No submissions yet. Use the buttons above to submit a drug request or antibiotic form.
                  </TableCell>
                </TableRow>
              ) : recentSubmissions.map(r => (
                <TableRow key={`${r.type}-${r.id}`}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</TableCell>
                  <TableCell className="text-sm font-medium">{r.patient_name}</TableCell>
                  <TableCell className="text-sm">{r.type === "antibiotic" ? "Antibiotic Form" : "Drug Request"}</TableCell>
                  <TableCell className="text-sm">{r.detail}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${r.statusBadge}`}>
                      {r.statusLabel}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </FmsPanel>
    </div>
  );
}
