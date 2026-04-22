import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatDistanceToNow, startOfDay } from "date-fns";
import { Clock, CheckCircle, XCircle, ChevronDown } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AntibioticFormReadOnly } from "@/components/AntibioticFormReadOnly";
import { ScrollArea } from "@/components/ui/scroll-area";
import { quotaBadgeState, QUOTA_BADGE_CLASS, QUOTA_BADGE_LABEL } from "@/lib/quotaHelpers";

const NAG_BADGE_CONFIG: Record<string, { label: string; cls: string }> = {
  supported:        { label: "✅ Supported",        cls: "bg-green-100 text-green-700 border-green-300" },
  review:           { label: "⚠ Review",            cls: "bg-amber-100 text-amber-700 border-amber-300" },
  not_supported:    { label: "❌ Not supported",    cls: "bg-red-100 text-red-700 border-red-300" },
  refer_specialist: { label: "💬 Refer specialist", cls: "bg-blue-100 text-blue-700 border-blue-300" },
  unavailable:      { label: "— Unavailable",       cls: "bg-gray-100 text-gray-600 border-gray-300" },
};

function renderNagBadge(result: string | null | undefined) {
  if (!result) return <span className="text-xs text-muted-foreground">—</span>;
  const c = NAG_BADGE_CONFIG[result] ?? { label: result, cls: "" };
  return <Badge variant="outline" className={`text-[10px] ${c.cls}`}>{c.label}</Badge>;
}

function formatIC(ic: string) {
  const d = ic.replace(/\D/g, "");
  if (d.length === 12) return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  return ic;
}

export default function SpecialistDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [approveTarget, setApproveTarget] = useState<any>(null);
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [borrowFacility, setBorrowFacility] = useState("");

  // Antibiotic states
  const [abApproveTarget, setAbApproveTarget] = useState<any>(null);
  const [abRejectTarget, setAbRejectTarget] = useState<any>(null);
  const [abNotes, setAbNotes] = useState("");
  const [abRejectReason, setAbRejectReason] = useState("");

  // --- Controlled Drug queries ---
  const { data: requests = [] } = useQuery({
    queryKey: ["specialist-requests"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispensing_requests")
        .select("*, drugs(drug_name, unit_pengukuran)")
        .in("status", ["pending_specialist", "pending_pharmacy", "approved", "rejected"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const currentYear = new Date().getFullYear();

  const { data: drugQuotas = [] } = useQuery({
    queryKey: ["specialist-drug-quotas", currentYear],
    queryFn: async () => {
      const { data } = await supabase.from("drug_quotas").select("drug_id, quota_limit").eq("year", currentYear);
      return (data ?? []) as { drug_id: string; quota_limit: number }[];
    },
  });

  const { data: quotaCounts = { regular: {}, pesara: {} } } = useQuery({
    queryKey: ["specialist-quota-counts", currentYear],
    refetchInterval: 30000,
    queryFn: async () => {
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear + 1}-01-01`;

      const [{ data: regular }, { data: pesara }] = await Promise.all([
        supabase
          .from("dispensing_requests")
          .select("drug_id, no_ic")
          .in("status", ["approved", "fulfilled"])
          .eq("is_pesara", false)
          .gte("created_at", yearStart)
          .lt("created_at", yearEnd),
        supabase
          .from("dispensing_requests")
          .select("drug_id, no_ic")
          .eq("status", "fulfilled")
          .eq("is_pesara", true)
          .gte("created_at", yearStart)
          .lt("created_at", yearEnd),
      ]);

      const regularCounts: Record<string, number> = {};
      const uniqueICs: Record<string, Set<string>> = {};
      for (const r of regular ?? []) {
        if (!uniqueICs[r.drug_id]) uniqueICs[r.drug_id] = new Set();
        uniqueICs[r.drug_id].add(r.no_ic);
      }
      for (const [drugId, s] of Object.entries(uniqueICs)) {
        regularCounts[drugId] = s.size;
      }

      const pesaraCounts: Record<string, number> = {};
      for (const r of pesara ?? []) {
        pesaraCounts[r.drug_id] = (pesaraCounts[r.drug_id] ?? 0) + 1;
      }

      return { regular: regularCounts, pesara: pesaraCounts };
    },
  });

  // --- Antibiotic queries (with submitter name lookup) ---
  const { data: abForms = [] } = useQuery({
    queryKey: ["specialist-antibiotic-forms"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data: forms, error } = await supabase
        .from("antibiotic_forms" as any)
        .select("*")
        .in("status", ["pending_specialist", "approved", "rejected"])
        .order("created_at", { ascending: false });
      if (error) throw error;

      const ids = [...new Set((forms ?? []).map((f: any) => f.submitted_by).filter(Boolean))];
      const profileMap: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", ids);
        for (const p of profiles ?? []) profileMap[p.user_id] = p.full_name;
      }

      return (forms ?? []).map((f: any) => ({
        ...f,
        submitter_name: profileMap[f.submitted_by] ?? "Unknown MO",
      })) as any[];
    },
  });

  const todayStart = startOfDay(new Date()).toISOString();

  // Controlled Drug computed
  const allPending = useMemo(() => requests.filter(r => r.status === "pending_specialist"), [requests]);
  const regularPending = useMemo(() => allPending.filter(r => !(r as any).is_pesara), [allPending]);
  const pesaraPending = useMemo(() => allPending.filter(r => (r as any).is_pesara), [allPending]);
  const processedToday = useMemo(() =>
    requests.filter(r =>
      (r.status === "approved" || r.status === "pending_pharmacy" || r.status === "rejected") &&
      r.specialist_action_at && r.specialist_action_at >= todayStart
    ), [requests, todayStart]);
  const approvedToday = processedToday.filter(r => r.status === "pending_pharmacy" || r.status === "approved").length;
  const rejectedToday = processedToday.filter(r => r.status === "rejected").length;
  const history = useMemo(() => requests.filter(r => r.specialist_action_at).slice(0, 20), [requests]);

  // Antibiotic computed
  const abPending = useMemo(() => abForms.filter((f: any) => f.status === "pending_specialist"), [abForms]);
  const abProcessedToday = useMemo(() =>
    abForms.filter((f: any) =>
      (f.status === "approved" || f.status === "rejected") &&
      f.specialist_action_at && f.specialist_action_at >= todayStart
    ), [abForms, todayStart]);
  const abApprovedToday = abProcessedToday.filter((f: any) => f.status === "approved").length;
  const abRejectedToday = abProcessedToday.filter((f: any) => f.status === "rejected").length;
  const abHistory = useMemo(() => abForms.filter((f: any) => f.specialist_action_at).slice(0, 20), [abForms]);

  // Approve dialog quota computations
  const approveQuotaRow = approveTarget ? drugQuotas.find(q => q.drug_id === approveTarget.drug_id) : null;
  const approveQuotaLimit = approveQuotaRow ? approveQuotaRow.quota_limit : null;
  const approveUsedCount = approveTarget ? (quotaCounts.regular[approveTarget.drug_id] ?? 0) : 0;
  const isApproveTargetPesara = approveTarget ? !!(approveTarget as any).is_pesara : false;
  const isQuotaExhausted = !isApproveTargetPesara && approveQuotaLimit !== null && approveUsedCount >= approveQuotaLimit;

  // --- Mutations ---
  const approveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("dispensing_requests")
        .update({
          status: "pending_pharmacy",
          specialist_id: user?.id,
          specialist_action_at: new Date().toISOString(),
          specialist_notes: notes || null,
          borrowed_from_facility: borrowFacility.trim() || null,
        })
        .eq("id", approveTarget.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request approved");
      setApproveTarget(null);
      setNotes("");
      setBorrowFacility("");
      queryClient.invalidateQueries({ queryKey: ["specialist-requests"] });
      queryClient.invalidateQueries({ queryKey: ["specialist-quota-counts"] });
      queryClient.invalidateQueries({ queryKey: ["specialist-drug-quotas"] });
    },
    onError: () => toast.error("Approval failed. Please try again."),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("dispensing_requests")
        .update({ status: "rejected", specialist_id: user?.id, specialist_action_at: new Date().toISOString(), specialist_notes: rejectReason })
        .eq("id", rejectTarget.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request rejected");
      setRejectTarget(null);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["specialist-requests"] });
    },
    onError: () => toast.error("Failed to reject request"),
  });

  const abApproveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("antibiotic_forms" as any)
        .update({ status: "approved", specialist_id: user?.id, specialist_action_at: new Date().toISOString(), specialist_notes: abNotes || null } as any)
        .eq("id", abApproveTarget.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Antibiotic form approved — pharmacist has been notified"); setAbApproveTarget(null); setAbNotes(""); queryClient.invalidateQueries({ queryKey: ["specialist-antibiotic-forms"] }); },
    onError: () => toast.error("Failed to approve form"),
  });

  const abRejectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("antibiotic_forms" as any)
        .update({ status: "rejected", specialist_id: user?.id, specialist_action_at: new Date().toISOString(), specialist_notes: abRejectReason } as any)
        .eq("id", abRejectTarget.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Antibiotic form rejected"); setAbRejectTarget(null); setAbRejectReason(""); queryClient.invalidateQueries({ queryKey: ["specialist-antibiotic-forms"] }); },
    onError: () => toast.error("Failed to reject form"),
  });

  const stats = [
    { label: "Pending (Drug)", count: allPending.length, icon: Clock, bg: "bg-yellow-100 dark:bg-yellow-900/30", color: "text-yellow-700 dark:text-yellow-400" },
    { label: "Pending (Antibiotic)", count: abPending.length, icon: Clock, bg: "bg-cyan-100 dark:bg-cyan-900/30", color: "text-cyan-700 dark:text-cyan-400" },
    { label: "Approved Today", count: approvedToday + abApprovedToday, icon: CheckCircle, bg: "bg-green-100 dark:bg-green-900/30", color: "text-green-700 dark:text-green-400" },
    { label: "Rejected Today", count: rejectedToday + abRejectedToday, icon: XCircle, bg: "bg-red-100 dark:bg-red-900/30", color: "text-red-700 dark:text-red-400" },
  ];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        {stats.map(s => (
          <Card key={s.label} className={s.bg}>
            <CardContent className="flex items-center gap-3 p-4">
              <s.icon className={`h-6 w-6 ${s.color}`} />
              <div>
                <p className="text-2xl font-bold text-foreground">{s.count}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="ubat">
        <TabsList>
          <TabsTrigger value="ubat">Controlled Drug</TabsTrigger>
          <TabsTrigger value="antibiotik" className="gap-1">
            Antibiotic Form
            {abPending.length > 0 && (
              <Badge variant="destructive" className="h-5 min-w-5 text-[10px] rounded-full px-1.5">{abPending.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Controlled Drug */}
        <TabsContent value="ubat" className="space-y-4 mt-4">
          <Tabs defaultValue="regular">
            <TabsList>
              <TabsTrigger value="regular" className="gap-1">
                Regular
                {regularPending.length > 0 && (
                  <Badge className="bg-amber-500 text-white rounded-full text-xs px-1.5 ml-1">
                    {regularPending.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="pesara" className="gap-1">
                Pesara
                {pesaraPending.length > 0 && (
                  <Badge className="bg-amber-500 text-white rounded-full text-xs px-1.5 ml-1">
                    {pesaraPending.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="regular">
              <Card>
                <CardHeader><CardTitle className="text-base">Pending Approval Requests</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time Submitted</TableHead>
                        <TableHead>Patient Name</TableHead>
                        <TableHead>IC No.</TableHead>
                        <TableHead>Drug</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Doctor</TableHead>
                        <TableHead>Quota</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {regularPending.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                            <p className="font-medium">No pending requests</p>
                            <p className="text-xs mt-1">No controlled drug requests are awaiting specialist approval.</p>
                          </TableCell>
                        </TableRow>
                      ) : regularPending.map(r => {
                        const quotaRow = drugQuotas.find(q => q.drug_id === r.drug_id);
                        const quotaLimit = quotaRow ? quotaRow.quota_limit : null;
                        const usedCount = quotaCounts.regular[r.drug_id] ?? 0;
                        const badgeState = quotaBadgeState(usedCount, quotaLimit);
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</TableCell>
                            <TableCell className="font-medium">{r.patient_name}</TableCell>
                            <TableCell className="text-xs">{formatIC(r.no_ic)}</TableCell>
                            <TableCell>
                              {(r.drugs as any)?.drug_name}
                              <Badge className="ml-1 bg-yellow-100 text-yellow-700 border-yellow-300 text-[10px]">Specialist</Badge>
                            </TableCell>
                            <TableCell>{r.quantity} {(r.drugs as any)?.unit_pengukuran}</TableCell>
                            <TableCell className="text-xs">{r.prescriber_name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-xs ${QUOTA_BADGE_CLASS[badgeState]}`}>
                                {QUOTA_BADGE_LABEL[badgeState](usedCount, quotaLimit)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => setApproveTarget(r)}>Approve</Button>
                                <Button size="sm" variant="destructive" className="h-7" onClick={() => setRejectTarget(r)}>Reject</Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="pesara">
              <Card>
                <CardHeader><CardTitle className="text-base">Pending Pesara Requests</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time Submitted</TableHead>
                        <TableHead>Patient Name</TableHead>
                        <TableHead>IC No.</TableHead>
                        <TableHead>Drug</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Doctor</TableHead>
                        <TableHead>Quota</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pesaraPending.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                            <p className="font-medium">No pending Pesara requests</p>
                            <p className="text-xs mt-1">No Pesara patient requests are awaiting specialist approval.</p>
                          </TableCell>
                        </TableRow>
                      ) : pesaraPending.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</TableCell>
                          <TableCell className="font-medium">{r.patient_name}</TableCell>
                          <TableCell className="text-xs">{formatIC(r.no_ic)}</TableCell>
                          <TableCell>
                            {(r.drugs as any)?.drug_name}
                            <Badge className="ml-1 bg-yellow-100 text-yellow-700 border-yellow-300 text-[10px]">Specialist</Badge>
                          </TableCell>
                          <TableCell>{r.quantity} {(r.drugs as any)?.unit_pengukuran}</TableCell>
                          <TableCell className="text-xs">{r.prescriber_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs bg-blue-100 text-blue-700 border-blue-300">Unlimited</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => setApproveTarget(r)}>Approve</Button>
                              <Button size="sm" variant="destructive" className="h-7" onClick={() => setRejectTarget(r)}>Reject</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Drug Approval History */}
          <Collapsible>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/50">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Approval History (Drug)</CardTitle>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead><TableHead>Patient</TableHead><TableHead>Drug</TableHead><TableHead>Quantity</TableHead><TableHead>Decision</TableHead><TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">{formatDistanceToNow(new Date(r.specialist_action_at), { addSuffix: true })}</TableCell>
                          <TableCell>{r.patient_name}</TableCell>
                          <TableCell>{(r.drugs as any)?.drug_name}</TableCell>
                          <TableCell>{r.quantity}</TableCell>
                          <TableCell>
                            {r.status === "rejected" ? <Badge variant="destructive" className="text-xs">Rejected</Badge> : <Badge className="bg-green-100 text-green-700 border-green-300 text-xs">Approved</Badge>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{r.specialist_notes || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </TabsContent>

        {/* TAB 2: Borang Antibiotik */}
        <TabsContent value="antibiotik" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Antibiotic Forms Pending Approval</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Patient Name</TableHead>
                    <TableHead>IC</TableHead>
                    <TableHead>Diagnosis</TableHead>
                    <TableHead>Submitted By</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>NAG Check</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {abPending.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No antibiotic forms pending</TableCell></TableRow>
                  ) : abPending.map((f: any) => (
                    <TableRow key={f.id}>
                      <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(f.created_at), { addSuffix: true })}</TableCell>
                      <TableCell className="font-medium">{f.patient_name}</TableCell>
                      <TableCell className="text-xs">{formatIC(f.patient_ic)}</TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate">{f.diagnosis}</TableCell>
                      <TableCell className="text-xs font-medium">{f.submitter_name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{f.prescription_unit || "—"}</Badge></TableCell>
                      <TableCell>{renderNagBadge(f.pathway_check_result)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => setAbApproveTarget(f)}>Review & Approve</Button>
                          <Button size="sm" variant="destructive" className="h-7" onClick={() => setAbRejectTarget(f)}>Reject</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Antibiotic History */}
          <Collapsible>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/50">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Approval History (Antibiotic)</CardTitle>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead><TableHead>Patient</TableHead><TableHead>Diagnosis</TableHead><TableHead>Decision</TableHead><TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {abHistory.map((f: any) => (
                        <TableRow key={f.id}>
                          <TableCell className="text-xs">{formatDistanceToNow(new Date(f.specialist_action_at), { addSuffix: true })}</TableCell>
                          <TableCell>{f.patient_name}</TableCell>
                          <TableCell className="text-xs max-w-[150px] truncate">{f.diagnosis}</TableCell>
                          <TableCell>
                            {f.status === "rejected" ? <Badge variant="destructive" className="text-xs">Rejected</Badge> : <Badge className="bg-green-100 text-green-700 border-green-300 text-xs">Approved</Badge>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{f.specialist_notes || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </TabsContent>
      </Tabs>

      {/* Drug Approve Dialog */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => { if (!open) { setApproveTarget(null); setNotes(""); setBorrowFacility(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve Request</DialogTitle></DialogHeader>
          {approveTarget && (
            <div className="space-y-4">
              <div className="rounded border p-3 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Patient:</span> {approveTarget.patient_name}</p>
                <p><span className="text-muted-foreground">IC:</span> {formatIC(approveTarget.no_ic)}</p>
                <p><span className="text-muted-foreground">Drug:</span> {(approveTarget.drugs as any)?.drug_name}</p>
                <p><span className="text-muted-foreground">Quantity:</span> {approveTarget.quantity}</p>
              </div>
              {isQuotaExhausted && (
                <>
                  <Alert variant="destructive">
                    <AlertDescription>
                      Quota exhausted: {approveUsedCount}/{approveQuotaLimit} patients for {(approveTarget?.drugs as any)?.drug_name} this year. Approval will exceed the annual patient quota.
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    <Label htmlFor="borrow-facility">Borrowing quota from facility</Label>
                    <Input
                      id="borrow-facility"
                      placeholder="Enter facility name"
                      value={borrowFacility}
                      onChange={e => setBorrowFacility(e.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label>Approval Notes (optional)</Label>
                <Textarea placeholder="Additional notes" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setApproveTarget(null); setNotes(""); setBorrowFacility(""); }}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending || (isQuotaExhausted && borrowFacility.trim() === "")}
            >
              {approveMutation.isPending ? "Processing..." : "Confirm Approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drug Reject Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Request</DialogTitle></DialogHeader>
          {rejectTarget && (
            <div className="space-y-4">
              <div className="rounded border p-3 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Patient:</span> {rejectTarget.patient_name}</p>
                <p><span className="text-muted-foreground">Drug:</span> {(rejectTarget.drugs as any)?.drug_name}</p>
              </div>
              <div className="space-y-2">
                <Label>Rejection Reason *</Label>
                <Textarea placeholder="Min 10 characters" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending || rejectReason.length < 10}>{rejectMutation.isPending ? "Processing..." : "Confirm Rejection"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Antibiotic Approve Dialog — full form review */}
      <Dialog open={!!abApproveTarget} onOpenChange={(o) => !o && setAbApproveTarget(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Review Antibiotic Form — {abApproveTarget?.patient_name}</DialogTitle></DialogHeader>
          {abApproveTarget && (
            <div className="space-y-4">
              <AntibioticFormReadOnly form={abApproveTarget} />
              <div className="space-y-2">
                <Label>Approval Notes (optional)</Label>
                <Textarea placeholder="Additional notes" value={abNotes} onChange={e => setAbNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbApproveTarget(null)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => abApproveMutation.mutate()} disabled={abApproveMutation.isPending}>{abApproveMutation.isPending ? "Processing..." : "Approve Form"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Antibiotic Reject Dialog */}
      <Dialog open={!!abRejectTarget} onOpenChange={(o) => !o && setAbRejectTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Antibiotic Form</DialogTitle></DialogHeader>
          {abRejectTarget && (
            <div className="space-y-4">
              <div className="rounded border p-3 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Patient:</span> {abRejectTarget.patient_name}</p>
                <p><span className="text-muted-foreground">Diagnosis:</span> {abRejectTarget.diagnosis}</p>
              </div>
              <div className="space-y-2">
                <Label>Rejection Reason *</Label>
                <Textarea placeholder="Min 10 characters" value={abRejectReason} onChange={e => setAbRejectReason(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => abRejectMutation.mutate()} disabled={abRejectMutation.isPending || abRejectReason.length < 10}>{abRejectMutation.isPending ? "Processing..." : "Confirm Rejection"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
