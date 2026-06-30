import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { Search, UserPlus, RefreshCw, Check, ChevronsUpDown, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

function formatIC(ic: string) {
  const d = ic.replace(/\D/g, "");
  if (d.length === 12) return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  return ic;
}

function formatICInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  if (digits.length <= 6) return digits;
  if (digits.length <= 8) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
}

export default function PatientRegistry() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [searchQ, setSearchQ] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [refillOpen, setRefillOpen] = useState(false);
  const [refillPatient, setRefillPatient] = useState<{ id?: string; name: string; ic: string } | null>(null);

  // Refill form state
  const [refillDrugId, setRefillDrugId] = useState("");
  const [refillQty, setRefillQty] = useState(0);
  const [refillDate, setRefillDate] = useState<Date>(new Date());
  const [drugPopoverOpen, setDrugPopoverOpen] = useState(false);
  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientIC, setNewPatientIC] = useState("");
  const [isNewPatient, setIsNewPatient] = useState(false);

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_registry")
        .select("*")
        .order("patient_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["patient-history", selectedPatientId],
    enabled: !!selectedPatientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_drug_history")
        .select("*, drugs(drug_name, unit_pengukuran)")
        .eq("patient_id", selectedPatientId!)
        .order("dispensed_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: drugs = [] } = useQuery({
    queryKey: ["drugs-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drugs")
        .select("id, drug_name, unit_pengukuran, stok_min")
        .eq("is_active", true)
        .order("drug_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: allTx = [] } = useQuery({
    queryKey: ["all-tx-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("drug_id, jenis, kuantiti");
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

  const filteredPatients = useMemo(() => {
    if (!searchQ) return patients;
    const q = searchQ.toLowerCase();
    return patients.filter(p => p.patient_name.toLowerCase().includes(q) || p.no_ic.includes(q));
  }, [patients, searchQ]);

  const selectedPatient = patients.find(p => p.id === selectedPatientId);
  const selectedDrug = drugs.find(d => d.id === refillDrugId);
  const currentStock = refillDrugId ? (stockMap.get(refillDrugId) ?? 0) : 0;
  const afterStock = currentStock - refillQty;
  const stockExceeded = refillQty > currentStock;
  const belowMin = afterStock < (selectedDrug?.stok_min ?? 0);

  const openRefillForPatient = (patient: typeof patients[0]) => {
    setRefillPatient({ id: patient.id, name: patient.patient_name, ic: patient.no_ic });
    setIsNewPatient(false);
    setRefillDrugId("");
    setRefillQty(0);
    setRefillDate(new Date());
    setRefillOpen(true);
  };

  const openRefillWalkin = () => {
    setRefillPatient(null);
    setIsNewPatient(false);
    setNewPatientName("");
    setNewPatientIC("");
    setRefillDrugId("");
    setRefillQty(0);
    setRefillDate(new Date());
    setRefillOpen(true);
  };

  const refillMutation = useMutation({
    mutationFn: async () => {
      let patientId: string;
      const patientName = refillPatient?.name || newPatientName;
      const patientIC = refillPatient?.ic || newPatientIC;

      if (refillPatient?.id) {
        patientId = refillPatient.id;
      } else {
        // Upsert patient
        const { data: existing } = await supabase
          .from("patient_registry")
          .select("id")
          .eq("no_ic", patientIC.replace(/\D/g, ""))
          .maybeSingle();

        if (existing) {
          patientId = existing.id;
          await supabase.from("patient_registry").update({ patient_name: patientName }).eq("id", patientId);
        } else {
          const { data: newP, error } = await supabase
            .from("patient_registry")
            .insert({ patient_name: patientName, no_ic: patientIC.replace(/\D/g, "") })
            .select("id")
            .single();
          if (error) throw error;
          patientId = newP.id;
        }
      }

      // Create keluaran transaction
      const { error: txErr } = await supabase.from("transactions").insert({
        drug_id: refillDrugId,
        jenis: "keluaran",
        kuantiti: refillQty,
        tarikh: format(refillDate, "yyyy-MM-dd"),
        nama_pesakit: patientName,
        no_ic: patientIC.replace(/\D/g, ""),
        nama_pegawai: profile?.full_name || "—",
        sumber: "manual_refill",
        created_by: user?.id,
      });
      if (txErr) throw txErr;

      // Create patient drug history
      const { error: pdhErr } = await supabase.from("patient_drug_history").insert({
        patient_id: patientId,
        drug_id: refillDrugId,
        quantity: refillQty,
        method: "walk_in",
        officer_name: profile?.full_name || "—",
        stock_after: afterStock,
      });
      if (pdhErr) throw pdhErr;

      return { drugName: selectedDrug?.drug_name, afterStock, unit: selectedDrug?.unit_pengukuran };
    },
    onSuccess: (result) => {
      toast.success(`Refill successful — ${result?.drugName} stock reduced by ${refillQty}. Remaining: ${result?.afterStock} ${result?.unit}`);
      setRefillOpen(false);
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      queryClient.invalidateQueries({ queryKey: ["patient-history"] });
      queryClient.invalidateQueries({ queryKey: ["all-tx-stock"] });
    },
    onError: () => toast.error("Failed to save refill"),
  });

  // Patient search for refill dialog
  const refillPatientSearch = useMemo(() => {
    if (!newPatientName && !newPatientIC) return [];
    const q = (newPatientName || newPatientIC).toLowerCase();
    return patients.filter(p => p.patient_name.toLowerCase().includes(q) || p.no_ic.includes(q)).slice(0, 5);
  }, [patients, newPatientName, newPatientIC]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Patient Registry</h1>
          <p className="text-sm text-muted-foreground">Patient list and drug dispensing history</p>
        </div>
        <Button onClick={openRefillWalkin} style={{ backgroundColor: "#1A3C6E" }}>
          <UserPlus className="mr-1 h-4 w-4" /> Refill Walk-in
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search patient name or IC no..."
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          className="pl-9 text-base"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left - Patient list */}
        <ScrollArea className="h-[600px]">
          <div className="space-y-2 pr-2">
            {filteredPatients.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No patients found</p>
                <Button variant="link" size="sm" onClick={openRefillWalkin}>Add as new patient?</Button>
              </div>
            ) : filteredPatients.map(p => (
              <Card
                key={p.id}
                className={cn("cursor-pointer hover:bg-muted/50 transition-colors", selectedPatientId === p.id && "ring-2 ring-primary")}
                onClick={() => setSelectedPatientId(p.id)}
              >
                <CardContent className="p-3">
                  <p className="font-bold text-sm">{p.patient_name}</p>
                  <p className="text-xs text-muted-foreground">{formatIC(p.no_ic)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>

        {/* Right - Detail */}
        <div className="lg:col-span-2">
          {!selectedPatient ? (
            <Card><CardContent className="py-16 text-center text-muted-foreground">Select a patient to view dispensing history</CardContent></Card>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-bold">{selectedPatient.patient_name}</h2>
                      <p className="text-sm text-muted-foreground">{formatIC(selectedPatient.no_ic)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        In system since {format(new Date(selectedPatient.created_at), "dd/MM/yyyy")}
                      </p>
                    </div>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => openRefillForPatient(selectedPatient)}>
                      <RefreshCw className="mr-1 h-3 w-3" /> Refill Drug
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Current Drug", value: history.length > 0 ? (history[0].drugs as any)?.drug_name ?? "—" : "—" },
                  { label: "Total Visits", value: history.length },
                  { label: "Last Visit", value: history.length > 0 ? format(new Date(history[0].dispensed_at), "dd/MM/yyyy") : "—" },
                  { label: "Latest Quantity", value: history.length > 0 ? history[0].quantity : "—" },
                ].map(s => (
                  <Card key={s.label}>
                    <CardContent className="p-3 text-center">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-lg font-bold text-foreground truncate">{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* History Table */}
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Drug</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Officer</TableHead>
                        <TableHead>Stock After</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No history</TableCell></TableRow>
                      ) : history.map(h => (
                        <TableRow key={h.id}>
                          <TableCell className="text-xs">{format(new Date(h.dispensed_at), "dd/MM/yyyy")}</TableCell>
                          <TableCell className="text-sm">{(h.drugs as any)?.drug_name}</TableCell>
                          <TableCell>{h.quantity} {(h.drugs as any)?.unit_pengukuran}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={h.method === "walk_in" ? "bg-green-100 text-green-700 border-green-300" : "bg-blue-100 text-blue-700 border-blue-300"}>
                              {h.method === "walk_in" ? "Walk-in Refill" : "Temujanji"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{h.officer_name}</TableCell>
                          <TableCell>{h.stock_after ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Refill Walk-in Dialog */}
      <Dialog open={refillOpen} onOpenChange={setRefillOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Refill Walk-in</DialogTitle>
            <DialogDescription>Record drug dispensing without appointment process</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Patient Selection */}
            {!refillPatient ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Search patient (name or IC)</Label>
                  <Input
                    placeholder="Name or IC"
                    value={newPatientName}
                    onChange={e => { setNewPatientName(e.target.value); setIsNewPatient(false); }}
                  />
                </div>
                {refillPatientSearch.length > 0 && (
                  <div className="border rounded space-y-1 p-1">
                    {refillPatientSearch.map(p => (
                      <button
                        key={p.id}
                        className="w-full text-left px-3 py-2 rounded hover:bg-muted text-sm"
                        onClick={() => { setRefillPatient({ id: p.id, name: p.patient_name, ic: p.no_ic }); }}
                      >
                        <span className="font-medium">{p.patient_name}</span>
                        <span className="text-muted-foreground ml-2">{formatIC(p.no_ic)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!isNewPatient && (
                  <Button variant="link" size="sm" onClick={() => setIsNewPatient(true)}>Add new patient</Button>
                )}
                {isNewPatient && (
                  <div className="space-y-2 border rounded p-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Patient Name</Label>
                      <Input value={newPatientName} onChange={e => setNewPatientName(e.target.value.toUpperCase())} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">No. IC</Label>
                      <Input value={newPatientIC} onChange={e => setNewPatientIC(formatICInput(e.target.value))} inputMode="numeric" />
                    </div>
                    <Button
                      size="sm"
                      disabled={!newPatientName || newPatientIC.replace(/\D/g, "").length < 12}
                      onClick={() => setRefillPatient({ name: newPatientName, ic: newPatientIC })}
                    >
                      Confirm Patient
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-muted rounded p-3 text-sm">
                <p><span className="text-muted-foreground">Patient:</span> <strong>{refillPatient.name}</strong></p>
                <p><span className="text-muted-foreground">IC:</span> {formatIC(refillPatient.ic)}</p>
                {!refillPatient.id && (
                  <Button variant="link" size="sm" className="px-0" onClick={() => setRefillPatient(null)}>Not this patient?</Button>
                )}
              </div>
            )}

            {/* Drug selection */}
            {refillPatient && (
              <>
                <div className="space-y-2">
                  <Label>Drug</Label>
                  <Popover open={drugPopoverOpen} onOpenChange={setDrugPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-between", !refillDrugId && "text-muted-foreground")}>
                        {refillDrugId ? `${drugs.find(d => d.id === refillDrugId)?.drug_name} — Stock: ${stockMap.get(refillDrugId) ?? 0}` : "Select drug..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search drugs..." />
                        <CommandList>
                          <CommandEmpty>No drugs found.</CommandEmpty>
                          <CommandGroup>
                            {drugs.map(d => (
                              <CommandItem key={d.id} value={d.drug_name} onSelect={() => { setRefillDrugId(d.id); setDrugPopoverOpen(false); }}>
                                <Check className={cn("mr-2 h-4 w-4", refillDrugId === d.id ? "opacity-100" : "opacity-0")} />
                                {d.drug_name} — Stock: {stockMap.get(d.id) ?? 0} {d.unit_pengukuran}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Quantity</Label>
                    <Input type="number" min={1} value={refillQty} onChange={e => setRefillQty(parseInt(e.target.value) || 0)} />
                    {refillDrugId && refillQty > 0 && (
                      <p className={cn("text-xs", belowMin ? "text-destructive" : "text-muted-foreground")}>
                        Stock after refill: {afterStock} {selectedDrug?.unit_pengukuran}
                      </p>
                    )}
                    {stockExceeded && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> Exceeds current stock
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(refillDate, "dd/MM/yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={refillDate} onSelect={d => d && setRefillDate(d)} className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Summary */}
                {refillDrugId && refillQty > 0 && !stockExceeded && (
                  <div className="bg-muted rounded p-3 text-xs space-y-1">
                    <p>Dispensing: {refillQty} {selectedDrug?.unit_pengukuran} {selectedDrug?.drug_name}</p>
                    <p>Patient: {refillPatient.name} ({formatIC(refillPatient.ic)})</p>
                    <p>Date: {format(refillDate, "dd/MM/yyyy")}</p>
                    <p>Current stock: {currentStock} → Stock after: {afterStock}</p>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRefillOpen(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={!refillPatient || !refillDrugId || refillQty < 1 || stockExceeded || refillMutation.isPending}
              onClick={() => refillMutation.mutate()}
            >
              {refillMutation.isPending ? "Saving..." : "Save & Deduct Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
