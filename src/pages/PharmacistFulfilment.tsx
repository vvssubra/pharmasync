import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatDistanceToNow, startOfDay, format } from "date-fns";
import { AlertTriangle, Check } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function formatIC(ic: string) {
  const d = ic.replace(/\D/g, "");
  if (d.length === 12) return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  return ic;
}

export default function PharmacistFulfilment() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [fulfillTarget, setFulfillTarget] = useState<any>(null);
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [abViewTarget, setAbViewTarget] = useState<any>(null);
  const [abAckTarget, setAbAckTarget] = useState<any>(null);

  // --- Controlled Drug ---
  const { data: requests = [] } = useQuery({
    queryKey: ["fulfilment-requests"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispensing_requests")
        .select("*, drugs(id, drug_name, unit_pengukuran, stok_min, perlu_kelulusan_pakar)")
        .in("status", ["pending_pharmacy", "fulfilled"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: allTx = [] } = useQuery({
    queryKey: ["all-transactions-for-stock"],
    queryFn: async () => {
      const { data, error } = await supabase.from("transactions").select("drug_id, jenis, kuantiti");
      if (error) throw error;
      return data;
    },
  });

  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of allTx) {
      const curr = map.get(tx.drug_id) ?? 0;
      if (tx.jenis === "terimaan" || tx.jenis === "baki_awal") map.set(tx.drug_id, curr + tx.kuantiti);
      else if (tx.jenis === "keluaran") map.set(tx.drug_id, curr - tx.kuantiti);
    }
    return map;
  }, [allTx]);

  const todayStart = startOfDay(new Date()).toISOString();
  const pending = useMemo(() => requests.filter(r => r.status === "pending_pharmacy"), [requests]);
  const fulfilledToday = useMemo(() =>
    requests.filter(r => r.status === "fulfilled" && r.fulfilled_at && r.fulfilled_at >= todayStart),
    [requests, todayStart]);

  // --- Antibiotic Forms ---
  const { data: abForms = [] } = useQuery({
    queryKey: ["fulfilment-antibiotic-forms"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("antibiotic_forms" as any)
        .select("*")
        .in("status", ["approved"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const abPendingAck = useMemo(() => abForms.filter((f: any) => !f.acknowledged_at), [abForms]);
  const abAckedToday = useMemo(() =>
    abForms.filter((f: any) => f.acknowledged_at && f.acknowledged_at >= todayStart),
    [abForms, todayStart]);

  // --- Mutations ---
  const fulfillMutation = useMutation({
    mutationFn: async () => {
      const req = fulfillTarget;
      const drug = req.drugs as any;
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
      queryClient.invalidateQueries({ queryKey: ["all-transactions-for-stock"] });
    },
    onError: () => toast.error("Failed to process request"),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("dispensing_requests").update({ status: "rejected", rejection_reason: rejectReason }).eq("id", rejectTarget.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Request rejected"); setRejectTarget(null); setRejectReason(""); queryClient.invalidateQueries({ queryKey: ["fulfilment-requests"] }); },
    onError: () => toast.error("Failed to reject"),
  });

  const deferMutation = useMutation({
    mutationFn: async (id: string) => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const { error } = await supabase.from("dispensing_requests").update({ deferred_date: format(tomorrow, "yyyy-MM-dd") }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Request deferred to tomorrow"); queryClient.invalidateQueries({ queryKey: ["fulfilment-requests"] }); },
  });

  const abAckMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("antibiotic_forms" as any)
        .update({ acknowledged_by: user?.id, acknowledged_at: new Date().toISOString() } as any)
        .eq("id", abAckTarget.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Form acknowledged. No stock changes made.");
      setAbAckTarget(null);
      queryClient.invalidateQueries({ queryKey: ["fulfilment-antibiotic-forms"] });
    },
    onError: () => toast.error("Failed to acknowledge form"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Requests to Fulfil</h1>
        <p className="text-sm text-muted-foreground">Click Complete to confirm dispensing and deduct stock</p>
      </div>

      <Tabs defaultValue="pending">
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
          {pending.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No pending requests</CardContent></Card>
          ) : pending.map(req => {
            const drug = req.drugs as any;
            const currentStock = stockMap.get(req.drug_id) ?? 0;
            const afterStock = currentStock - req.quantity;
            const belowMin = afterStock < (drug?.stok_min ?? 0);
            const outOfStock = currentStock <= 0;
            const isSpecialistApproved = drug?.perlu_kelulusan_pakar;
            const isDeferred = !!req.deferred_date;

            return (
              <Card key={req.id} className="overflow-hidden" style={{ borderLeft: `4px solid ${outOfStock ? '#dc2626' : belowMin ? '#dc2626' : isSpecialistApproved ? '#16A34A' : '#2E75B6'}` }}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{drug?.drug_name}</CardTitle>
                      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}</span>
                    </div>
                    <div className="flex gap-1">
                      {isSpecialistApproved && <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px] inline-flex items-center gap-1"><Check className="h-3 w-3" /> Specialist Approved</Badge>}
                      {isDeferred && <Badge variant="secondary" className="text-[10px]">Deferred</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mb-4">
                    <div><span className="text-muted-foreground text-xs">Patient</span><p className="font-medium">{req.patient_name}</p></div>
                    <div><span className="text-muted-foreground text-xs">IC</span><p>{formatIC(req.no_ic)}</p></div>
                    <div><span className="text-muted-foreground text-xs">Quantity</span><p>{req.quantity} {drug?.unit_pengukuran}</p></div>
                    <div><span className="text-muted-foreground text-xs">Doctor</span><p>{req.prescriber_name}</p></div>
                    <div>
                      <span className="text-muted-foreground text-xs">Current Stock</span>
                      <p className={belowMin ? "text-destructive font-medium" : ""}>{currentStock} → {afterStock} after completion</p>
                    </div>
                  </div>
                  {belowMin && !outOfStock && (
                    <p className="text-xs text-destructive flex items-center gap-1 mb-3"><AlertTriangle className="h-3 w-3" /> Stock below minimum level</p>
                  )}
                  {outOfStock && <p className="text-xs text-destructive font-medium mb-3">Out of Stock — Add Receipt first</p>}
                  <div className="flex items-center justify-between">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Other Actions</Button></DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => setRejectTarget(req)}>Reject</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => deferMutation.mutate(req.id)}>Defer to tomorrow</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button onClick={() => setFulfillTarget(req)} disabled={outOfStock}>Complete</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Tab 2: Fulfilled today */}
        <TabsContent value="fulfilled" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead><TableHead>Patient</TableHead><TableHead>IC</TableHead><TableHead>Drug</TableHead><TableHead>Quantity</TableHead><TableHead>Balance After</TableHead><TableHead>Officer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fulfilledToday.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No dispensing today</TableCell></TableRow>
                  ) : fulfilledToday.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{r.fulfilled_at ? formatDistanceToNow(new Date(r.fulfilled_at), { addSuffix: true }) : "—"}</TableCell>
                      <TableCell>{r.patient_name}</TableCell>
                      <TableCell className="text-xs">{formatIC(r.no_ic)}</TableCell>
                      <TableCell>{(r.drugs as any)?.drug_name}</TableCell>
                      <TableCell>{r.quantity}</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell className="text-xs">—</TableCell>
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
              ) : abPendingAck.map((f: any) => (
                <Card key={f.id} className="overflow-hidden" style={{ borderLeft: "4px solid #0891B2" }}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{f.patient_name}</CardTitle>
                        <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(f.created_at), { addSuffix: true })}</span>
                      </div>
                      <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px] inline-flex items-center gap-1"><Check className="h-3 w-3" /> Specialist Approved</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
                      <div><span className="text-muted-foreground text-xs">IC</span><p>{formatIC(f.patient_ic)}</p></div>
                      <div><span className="text-muted-foreground text-xs">Diagnosis</span><p className="truncate max-w-[150px]">{f.diagnosis}</p></div>
                      <div><span className="text-muted-foreground text-xs">Unit</span><Badge variant="outline" className="text-[10px]">{f.prescription_unit || "—"}</Badge></div>
                      <div><span className="text-muted-foreground text-xs">Antibiotic</span><p className="truncate max-w-[150px]">{f.antibiotic_regimen || "—"}</p></div>
                    </div>
                    {f.fms_code && <p className="text-xs text-muted-foreground mb-2">FMS Code: {f.fms_code}</p>}
                    <div className="flex items-center justify-between">
                      <Button variant="outline" size="sm" onClick={() => setAbViewTarget(f)}>Review Form</Button>
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setAbAckTarget(f)}>Acknowledge</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="acked-today" className="mt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead><TableHead>Patient</TableHead><TableHead>IC</TableHead><TableHead>Diagnosis</TableHead><TableHead>Antibiotic</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {abAckedToday.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No forms confirmed today</TableCell></TableRow>
                      ) : abAckedToday.map((f: any) => (
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
              Confirm dispensing <strong>{fulfillTarget.quantity} {(fulfillTarget.drugs as any)?.unit_pengukuran}</strong>{" "}
              <strong>{(fulfillTarget.drugs as any)?.drug_name}</strong> for <strong>{fulfillTarget.patient_name}</strong>?
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
          <DialogHeader><DialogTitle>Antibiotic Form — {abViewTarget?.patient_name}</DialogTitle></DialogHeader>
          {abViewTarget && <AntibioticFormReadOnly form={abViewTarget} />}
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
    </div>
  );
}
