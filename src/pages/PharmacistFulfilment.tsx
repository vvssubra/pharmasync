import { memo, useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatDistanceToNow, startOfDay, format } from "date-fns";
import { AlertTriangle, Check, PackageX, ClipboardList, ShieldCheck, CheckCircle2, Pill, Stethoscope } from "lucide-react";
import { computeStockByDrug } from "@/lib/stock";
import { useClinicDrugSettings, resolveDrugSettings } from "@/hooks/useClinicDrugSettings";
import { cn, initials } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableStatCard } from "@/components/ui/expandable-stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AntibioticFormReadOnly } from "@/components/AntibioticFormReadOnly";
import { formatIC } from "@/lib/ic";

// Rows as this page queries them: dispensing requests join the drug columns the
// fulfilment flow needs; antibiotic forms come straight off the table.
type FulfilmentRow = Tables<"dispensing_requests"> & {
  drugs: {
    id: string;
    drug_name: string;
    unit_pengukuran: string;
    perlu_kelulusan_pakar: boolean;
  } | null;
};
// submitted_by_name is decorated onto each row from profiles by the query
// below — antibiotic_forms has no FK to profiles for PostgREST to embed.
type AbFormRow = Tables<"antibiotic_forms"> & { submitted_by_name: string };

type TopTab = "pending" | "fulfilled" | "antibiotik";

// A request is blocked when the ledger cannot cover it. This is the single
// definition behind the "Stock Blocked" KPI, the queue filter and the Complete
// button, so the three can never disagree.
function isStockBlocked(stock: number, quantity: number) {
  return stock < quantity;
}

// Row-level components are memoized so typing in a dialog or ticking one
// checkbox re-renders only the row that changed, not every card in the queue.

interface PendingRequestCardProps {
  req: FulfilmentRow;
  currentStock: number;
  stokMin: number;
  onFulfil: (req: FulfilmentRow) => void;
  onReject: (req: FulfilmentRow) => void;
  onDefer: (id: string) => void;
}

const PendingRequestCard = memo(function PendingRequestCard({
  req, currentStock, stokMin, onFulfil, onReject, onDefer,
}: PendingRequestCardProps) {
  const drug = req.drugs;
  const afterStock = currentStock - req.quantity;
  const blocked = isStockBlocked(currentStock, req.quantity);
  const outOfStock = currentStock <= 0;
  const belowMin = afterStock < stokMin;
  const isSpecialistApproved = !!drug?.perlu_kelulusan_pakar;
  const isDeferred = !!req.deferred_date;

  return (
    <Card
      noGlow
      className={cn(
        "border-l-4",
        blocked || belowMin ? "border-l-destructive" : isSpecialistApproved ? "border-l-green-600" : "border-l-primary",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
              {initials(req.patient_name)}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{req.patient_name}</CardTitle>
                <Badge variant="outline" className="text-[10px] font-mono">{formatIC(req.no_ic)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {isSpecialistApproved && <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px] inline-flex items-center gap-1"><Check className="h-3 w-3" /> Specialist Approved</Badge>}
            {isDeferred && <Badge variant="secondary" className="text-[10px]">Deferred</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-3">
          <div>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Pill className="h-3 w-3" aria-hidden />Drug &amp; Quantity</span>
            <p className="font-medium text-primary">{drug?.drug_name}</p>
            <p className="font-mono text-xs text-foreground">{req.quantity} {drug?.unit_pengukuran}</p>
          </div>
          <div>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Stethoscope className="h-3 w-3" aria-hidden />Prescriber</span>
            <p className="font-medium">{req.prescriber_name}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Current Stock</span>
            <p className={cn("font-medium", (blocked || belowMin) && "text-destructive")}>{currentStock} → {afterStock} after completion</p>
            {blocked ? (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive">
                <PackageX className="h-3 w-3" aria-hidden />
                {outOfStock ? "Out of Stock" : "Insufficient stock"} — Add Receipt first
              </p>
            ) : belowMin && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive"><AlertTriangle className="h-3 w-3" aria-hidden /> Below minimum level</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Other Actions</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => onReject(req)}>Reject</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDefer(req.id)}>Defer to tomorrow</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="gap-1.5" onClick={() => onFulfil(req)} disabled={blocked}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Complete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

interface AntibioticFormCardProps {
  form: AbFormRow;
  selected: boolean;
  onToggle: (id: string) => void;
  onView: (form: AbFormRow) => void;
  onAcknowledge: (form: AbFormRow) => void;
}

const AntibioticFormCard = memo(function AntibioticFormCard({
  form: f, selected, onToggle, onView, onAcknowledge,
}: AntibioticFormCardProps) {
  return (
    <Card noGlow className="border-l-4 border-l-teal-500">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={selected}
              aria-label={`Select form for ${f.patient_name}`}
              onCheckedChange={() => onToggle(f.id)}
            />
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
              {initials(f.patient_name)}
            </span>
            <div>
              <CardTitle className="text-base">{f.patient_name}</CardTitle>
              <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(f.created_at), { addSuffix: true })}</span>
            </div>
          </div>
          <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px] inline-flex items-center gap-1"><Check className="h-3 w-3" /> Specialist Approved</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-2 md:grid-cols-4">
          <div><span className="text-muted-foreground text-xs">IC</span><p className="font-mono">{formatIC(f.patient_ic)}</p></div>
          <div><span className="text-muted-foreground text-xs">Diagnosis</span><p className="truncate max-w-[150px]">{f.diagnosis}</p></div>
          <div><span className="text-muted-foreground text-xs">Unit</span><Badge variant="outline" className="text-[10px]">{f.prescription_unit || "—"}</Badge></div>
          <div>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Pill className="h-3 w-3" aria-hidden />Antibiotic</span>
            <p className="truncate max-w-[150px] font-medium text-primary">{f.antibiotic_regimen || "—"}</p>
          </div>
        </div>
        {f.fms_code && <p className="text-xs text-muted-foreground mb-2">FMS Code: {f.fms_code}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => onView(f)}>Review Form</Button>
          <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={() => onAcknowledge(f)}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Acknowledge
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

export default function PharmacistFulfilment() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const { byDrugId: settingsByDrugId } = useClinicDrugSettings();
  const [tab, setTab] = useState<TopTab>("pending");
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [fulfillTarget, setFulfillTarget] = useState<FulfilmentRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<FulfilmentRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [abViewTarget, setAbViewTarget] = useState<AbFormRow | null>(null);
  const [abAckTarget, setAbAckTarget] = useState<AbFormRow | null>(null);
  const [abAckSelected, setAbAckSelected] = useState<Set<string>>(new Set());
  const [abBulkAckOpen, setAbBulkAckOpen] = useState(false);

  // --- Controlled Drug ---
  const { data: requests = [] } = useQuery({
    queryKey: ["fulfilment-requests"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispensing_requests")
        .select("*, drugs(id, drug_name, unit_pengukuran, perlu_kelulusan_pakar)")
        .in("status", ["pending_pharmacy", "fulfilled"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as FulfilmentRow[];
    },
  });

  const todayStart = startOfDay(new Date()).toISOString();
  const pending = useMemo(() => requests.filter(r => r.status === "pending_pharmacy"), [requests]);
  const fulfilledToday = useMemo(() =>
    requests.filter(r => r.status === "fulfilled" && r.fulfilled_at && r.fulfilled_at >= todayStart),
    [requests, todayStart]);

  // Stock is only ever read for drugs sitting in the queue, so the ledger
  // fetch is scoped to those ids instead of pulling every transaction in the
  // clinic. The sorted id list is part of the key: the 15s request refetch
  // leaves it unchanged, so it does not trigger a ledger refetch on its own.
  const pendingDrugIds = useMemo(
    () => [...new Set(pending.map(r => r.drug_id))].sort(),
    [pending],
  );
  const { data: queueTx = [] } = useQuery({
    queryKey: ["fulfilment-stock-tx", pendingDrugIds],
    enabled: pendingDrugIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("drug_id, jenis, kuantiti, tarikh, created_at")
        .in("drug_id", pendingDrugIds);
      if (error) throw error;
      return data;
    },
  });
  const stockMap = useMemo(() => computeStockByDrug(queueTx), [queueTx]);

  // --- Antibiotic Forms ---
  const { data: abForms = [] } = useQuery({
    queryKey: ["fulfilment-antibiotic-forms"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("antibiotic_forms")
        .select("*")
        .in("status", ["approved"])
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Resolve the submitting MO's name for the view dialog. Separate query
      // rather than a PostgREST embed: antibiotic_forms.submitted_by has no FK
      // to profiles, so there is no relationship for it to traverse. Same
      // two-step pattern as AntibioticArchive and FmsDashboard.
      const list = data ?? [];
      const ids = [...new Set(list.map(f => f.submitted_by).filter(Boolean) as string[])];
      const profileMap: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", ids);
        for (const p of profiles ?? []) profileMap[p.user_id] = p.full_name;
      }
      return list.map(f => ({
        ...f,
        submitted_by_name: (f.submitted_by && profileMap[f.submitted_by]) || "—",
      }));
    },
  });

  const abPendingAck = useMemo(() => abForms.filter((f) => !f.acknowledged_at), [abForms]);

  // Selection is held by id, but the list refetches every 15s — a form another
  // pharmacist acknowledges meanwhile drops out of abPendingAck and leaves a
  // stale id behind. Intersect with what's actually on screen so a stale id can
  // never reach the mutation or inflate the count.
  const abSelectedIds = useMemo(
    () => abPendingAck.filter((f) => abAckSelected.has(f.id)).map((f) => f.id),
    [abPendingAck, abAckSelected],
  );
  const abAllPendingSelected = abPendingAck.length > 0 && abSelectedIds.length === abPendingAck.length;

  const toggleAbAckSelected = useCallback((id: string) => setAbAckSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const abAckedToday = useMemo(() =>
    abForms.filter((f) => f.acknowledged_at && f.acknowledged_at >= todayStart),
    [abForms, todayStart]);

  const blockedPending = useMemo(
    () => pending.filter(r => isStockBlocked(stockMap.get(r.drug_id) ?? 0, r.quantity)),
    [pending, stockMap],
  );
  const visiblePending = blockedOnly ? blockedPending : pending;

  // --- Mutations ---
  const fulfillMutation = useMutation({
    mutationFn: async () => {
      const req = fulfillTarget!;
      const drug = req.drugs;
      const { error: reqErr } = await supabase
        .from("dispensing_requests")
        .update({ status: "fulfilled", fulfilled_by: user?.id, fulfilled_at: new Date().toISOString() })
        .eq("id", req.id);
      if (reqErr) throw reqErr;

      const { error: txErr } = await supabase.from("transactions").insert({
        drug_id: req.drug_id, jenis: "keluaran", kuantiti: req.quantity,
        tarikh: format(new Date(), "yyyy-MM-dd"), nama_pesakit: req.patient_name,
        no_ic: req.no_ic, nama_pegawai: profile?.full_name || "—",
        sumber: req.is_pesara ? "request_pesara" : "request_non_pesara",
        catatan: req.is_pesara ? "Dispensing - Pesara" : "Dispensing - Non-Pesara",
        created_by: user?.id,
      });
      if (txErr) throw txErr;

      const { data: existingPatient } = await supabase.from("patient_registry").select("id").eq("no_ic", req.no_ic).maybeSingle();
      let patientId: string;
      if (existingPatient) {
        patientId = existingPatient.id;
        await supabase.from("patient_registry").update({ patient_name: req.patient_name }).eq("id", patientId);
      } else {
        const { data: newPatient, error: pErr } = await supabase.from("patient_registry").insert({ patient_name: req.patient_name, no_ic: req.no_ic }).select("id").single();
        if (pErr) throw pErr;
        patientId = newPatient.id;
      }

      const currentStock = stockMap.get(req.drug_id) ?? 0;
      const stockAfter = currentStock - req.quantity;
      await supabase.from("patient_drug_history").insert({
        patient_id: patientId, drug_id: req.drug_id, quantity: req.quantity,
        method: "appointment", officer_name: profile?.full_name || "—", stock_after: stockAfter,
      });
      return { drugName: drug.drug_name, stockAfter, unit: drug.unit_pengukuran };
    },
    onSuccess: (result) => {
      toast.success(`Complete. New balance of ${result.drugName}: ${result.stockAfter} ${result.unit}`);
      setFulfillTarget(null);
      queryClient.invalidateQueries({ queryKey: ["fulfilment-requests"] });
      queryClient.invalidateQueries({ queryKey: ["fulfilment-stock-tx"] });
    },
    onError: () => toast.error("Failed to process request"),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("dispensing_requests").update({ status: "rejected", rejection_reason: rejectReason }).eq("id", rejectTarget!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Request rejected"); setRejectTarget(null); setRejectReason(""); queryClient.invalidateQueries({ queryKey: ["fulfilment-requests"] }); },
    onError: () => toast.error("Failed to reject"),
  });

  const deferMutation = useMutation({
    mutationFn: async (id: string) => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const { error } = await supabase.from("dispensing_requests").update({ status: "deferred", deferred_date: format(tomorrow, "yyyy-MM-dd") }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Request deferred to tomorrow"); queryClient.invalidateQueries({ queryKey: ["fulfilment-requests"] }); },
    onError: () => toast.error("Failed to defer request"),
  });

  const abAckMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("antibiotic_forms")
        .update({ acknowledged_by: user?.id, acknowledged_at: new Date().toISOString() })
        .eq("id", abAckTarget!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Form acknowledged. No stock changes made.");
      setAbAckTarget(null);
      queryClient.invalidateQueries({ queryKey: ["fulfilment-antibiotic-forms"] });
    },
    onError: () => toast.error("Failed to acknowledge form"),
  });

  const abBulkAckMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // `acknowledged_at is null` is load-bearing, not just tidiness. The
      // trg_zz_enforce_antibiotic_form_lock trigger (20260725010000) raises on
      // any update to an already-acknowledged row, and one raise aborts the
      // whole statement — so without this filter a single form acknowledged by
      // someone else since page load would fail the entire batch. Excluding
      // those rows from the UPDATE means the trigger never fires for them.
      const { data, error } = await supabase
        .from("antibiotic_forms")
        .update({ acknowledged_by: user?.id, acknowledged_at: new Date().toISOString() })
        .in("id", ids)
        .is("acknowledged_at", null)
        .select("id");
      if (error) throw error;
      return { acknowledged: data?.length ?? 0, requested: ids.length };
    },
    onSuccess: ({ acknowledged, requested }) => {
      const skipped = requested - acknowledged;
      toast.success(
        skipped > 0
          ? `${acknowledged} form(s) acknowledged. ${skipped} were already acknowledged elsewhere. No stock changes made.`
          : `${acknowledged} form(s) acknowledged. No stock changes made.`,
      );
      setAbBulkAckOpen(false);
      setAbAckSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["fulfilment-antibiotic-forms"] });
    },
    onError: () => toast.error("Failed to acknowledge the selected forms"),
  });

  // Stable handlers so the memoized row cards skip re-rendering on unrelated
  // parent state changes (dialog text, selection, tab).
  const deferRequest = deferMutation.mutate;
  const showAllPending = useCallback(() => { setBlockedOnly(false); setTab("pending"); }, []);
  const toggleBlockedOnly = useCallback(() => { setBlockedOnly(v => !v); setTab("pending"); }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
            {profile?.clinic_name ? `Dispensary: ${profile.clinic_name}` : "Clinical Dispensary"}
          </span>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Pill className="h-6 w-6 text-primary" aria-hidden />
            Requests to Fulfil
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Verify prescriptions, review specialist-approved antibiotic forms, and confirm dispensation to deduct inventory stock.
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ExpandableStatCard
          icon={ClipboardList}
          count={pending.length}
          label="Awaiting Confirmation"
          bgClassName="bg-blue-100 dark:bg-blue-900/30"
          colorClassName="text-blue-700 dark:text-blue-400"
          active={tab === "pending" && !blockedOnly}
          onClick={showAllPending}
        />
        <ExpandableStatCard
          icon={ShieldCheck}
          count={abPendingAck.length}
          label="Antibiotic Forms (Restricted)"
          bgClassName="bg-teal-100 dark:bg-teal-900/30"
          colorClassName="text-teal-700 dark:text-teal-400"
          active={tab === "antibiotik"}
          onClick={() => setTab("antibiotik")}
        />
        <ExpandableStatCard
          icon={CheckCircle2}
          count={fulfilledToday.length + abAckedToday.length}
          label="Completed Today"
          bgClassName="bg-green-100 dark:bg-green-900/30"
          colorClassName="text-green-700 dark:text-green-400"
          breakdown={[
            { label: "Drug requests", value: fulfilledToday.length },
            { label: "Antibiotic forms", value: abAckedToday.length },
          ]}
          active={tab === "fulfilled"}
          onClick={() => setTab("fulfilled")}
        />
        <ExpandableStatCard
          icon={PackageX}
          count={blockedPending.length}
          label="Stock Blocked"
          bgClassName="bg-red-100 dark:bg-red-900/30"
          colorClassName="text-red-700 dark:text-red-400"
          active={tab === "pending" && blockedOnly}
          onClick={toggleBlockedOnly}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TopTab)}>
        <TabsList>
          <TabsTrigger value="pending">Awaiting Confirmation ({pending.length})</TabsTrigger>
          <TabsTrigger value="fulfilled">Completed Today ({fulfilledToday.length})</TabsTrigger>
          <TabsTrigger value="antibiotik" className="gap-1">
            Antibiotic Forms
            {abPendingAck.length > 0 && (
              <Badge variant="destructive" className="h-5 min-w-5 text-[10px] rounded-full px-1.5">{abPendingAck.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Pending ubat kawalan */}
        <TabsContent value="pending" className="space-y-4 mt-4">
          {blockedOnly && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <span className="flex items-center gap-1.5 text-destructive">
                <PackageX className="h-4 w-4" aria-hidden />
                Showing {blockedPending.length} stock-blocked request(s)
              </span>
              <Button variant="ghost" size="sm" onClick={showAllPending}>Show all</Button>
            </div>
          )}
          {visiblePending.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              {blockedOnly ? "No stock-blocked requests" : "No pending requests"}
            </CardContent></Card>
          ) : visiblePending.map(req => (
            <PendingRequestCard
              key={req.id}
              req={req}
              currentStock={stockMap.get(req.drug_id) ?? 0}
              stokMin={resolveDrugSettings(settingsByDrugId, req.drug_id).stok_min}
              onFulfil={setFulfillTarget}
              onReject={setRejectTarget}
              onDefer={deferRequest}
            />
          ))}
        </TabsContent>

        {/* Tab 2: Fulfilled today */}
        <TabsContent value="fulfilled" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="[&>th]:text-[11px] [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground">
                    <TableHead>Time</TableHead><TableHead>Patient</TableHead><TableHead>IC</TableHead><TableHead>Drug</TableHead><TableHead>Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fulfilledToday.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No dispensing today</TableCell></TableRow>
                  ) : fulfilledToday.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{r.fulfilled_at ? formatDistanceToNow(new Date(r.fulfilled_at), { addSuffix: true }) : "—"}</TableCell>
                      <TableCell>{r.patient_name}</TableCell>
                      <TableCell className="text-xs">{formatIC(r.no_ic)}</TableCell>
                      <TableCell>{r.drugs?.drug_name}</TableCell>
                      <TableCell>{r.quantity} {r.drugs?.unit_pengukuran}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Antibiotic Forms */}
        <TabsContent value="antibiotik" className="mt-4">
          <Tabs defaultValue="pending-ack">
            <TabsList>
              <TabsTrigger value="pending-ack">Needs Confirmation ({abPendingAck.length})</TabsTrigger>
              <TabsTrigger value="acked-today">Confirmed Today ({abAckedToday.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="pending-ack" className="space-y-4 mt-4">
              {abPendingAck.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No antibiotic forms awaiting confirmation</CardContent></Card>
              ) : (<>
              <Card noGlow className="bg-muted/40">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={abAllPendingSelected}
                      aria-label="Select all forms awaiting confirmation"
                      onCheckedChange={(checked) =>
                        setAbAckSelected(checked ? new Set(abPendingAck.map((f) => f.id)) : new Set())}
                    />
                    <span>Select all ({abPendingAck.length})</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">{abSelectedIds.length} selected</span>
                    <Button
                      size="sm"
                      className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                      disabled={abSelectedIds.length === 0}
                      onClick={() => setAbBulkAckOpen(true)}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      Acknowledge Selected
                    </Button>
                  </div>
                </CardContent>
              </Card>
              {abPendingAck.map((f) => (
                <AntibioticFormCard
                  key={f.id}
                  form={f}
                  selected={abAckSelected.has(f.id)}
                  onToggle={toggleAbAckSelected}
                  onView={setAbViewTarget}
                  onAcknowledge={setAbAckTarget}
                />
              ))}
              </>)}
            </TabsContent>

            <TabsContent value="acked-today" className="mt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="[&>th]:text-[11px] [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground">
                        <TableHead>Time</TableHead><TableHead>Patient</TableHead><TableHead>IC</TableHead><TableHead>Diagnosis</TableHead><TableHead>Antibiotic</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {abAckedToday.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No forms confirmed today</TableCell></TableRow>
                      ) : abAckedToday.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="text-xs">{f.acknowledged_at ? formatDistanceToNow(new Date(f.acknowledged_at), { addSuffix: true }) : "—"}</TableCell>
                          <TableCell>{f.patient_name}</TableCell>
                          <TableCell className="text-xs">{formatIC(f.patient_ic)}</TableCell>
                          <TableCell className="text-xs truncate max-w-[150px]">{f.diagnosis}</TableCell>
                          <TableCell className="text-xs truncate max-w-[150px]">{f.antibiotic_regimen || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

      {/* Fulfill Dialog */}
      <Dialog open={!!fulfillTarget} onOpenChange={(o) => !o && setFulfillTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Dispensing</DialogTitle></DialogHeader>
          {fulfillTarget && (
            <p className="text-sm">
              Confirm dispensing <strong>{fulfillTarget.quantity} {fulfillTarget.drugs?.unit_pengukuran}</strong>{" "}
              <strong>{fulfillTarget.drugs?.drug_name}</strong> for <strong>{fulfillTarget.patient_name}</strong>?
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFulfillTarget(null)}>Cancel</Button>
            <Button onClick={() => fulfillMutation.mutate()} disabled={fulfillMutation.isPending}>{fulfillMutation.isPending ? "Processing..." : "Confirm & Complete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Request</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Rejection Reason *</Label>
            <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Min 10 characters" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending || rejectReason.length < 10}>Confirm Rejection</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Antibiotic View Dialog */}
      <Dialog open={!!abViewTarget} onOpenChange={(o) => !o && setAbViewTarget(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 text-left">
                <DialogTitle>Antibiotic Form — {abViewTarget?.patient_name}</DialogTitle>
                <p className="text-xs text-muted-foreground">Specialist-endorsed clinical record</p>
              </div>
            </div>
          </DialogHeader>
          {abViewTarget && <AntibioticFormReadOnly form={abViewTarget} />}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Verify patient identity and weight-based dosage against this record before dispensing.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbViewTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Antibiotic Acknowledge Dialog */}
      <Dialog open={!!abAckTarget} onOpenChange={(o) => !o && setAbAckTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Acknowledge Antibiotic Form</DialogTitle></DialogHeader>
          {abAckTarget && (
            <p className="text-sm">Confirm receipt of antibiotic form for <strong>{abAckTarget.patient_name}</strong>?</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbAckTarget(null)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => abAckMutation.mutate()} disabled={abAckMutation.isPending}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Antibiotic Bulk Acknowledge Dialog */}
      <Dialog open={abBulkAckOpen} onOpenChange={setAbBulkAckOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Acknowledge {abSelectedIds.length} Antibiotic Form(s)</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>Confirm receipt of <strong>{abSelectedIds.length}</strong> antibiotic form(s)?</p>
            <p className="text-muted-foreground">
              Acknowledging locks each form permanently — it cannot be edited afterwards.
              No stock changes are made.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbBulkAckOpen(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => abBulkAckMutation.mutate(abSelectedIds)}
              disabled={abBulkAckMutation.isPending || abSelectedIds.length === 0}
            >
              {abBulkAckMutation.isPending ? "Acknowledging…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
