import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, ChevronsUpDown, AlertCircle, CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatIC, formatICInput } from "@/lib/ic";
import { computeStockByDrug } from "@/lib/stock";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface Patient {
  id: string;
  patient_name: string;
  no_ic: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: Patient[];
  /** Pre-selected patient when opened from a patient row; null opens the walk-in search. */
  initialPatient?: { id?: string; name: string; ic: string } | null;
}

// Moved verbatim out of PatientRegistry.tsx — same upsert-patient -> deduct-stock
// -> log-history behaviour. Does NOT touch drug_quota_patients: a walk-in
// refill still only consumes physical stock, not the annual patient quota.
export function RefillWalkinDialog({ open, onOpenChange, patients, initialPatient = null }: Props) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const [refillPatient, setRefillPatient] = useState<{ id?: string; name: string; ic: string } | null>(initialPatient);
  const [refillDrugId, setRefillDrugId] = useState("");
  const [refillQty, setRefillQty] = useState(0);
  const [refillDate, setRefillDate] = useState<Date>(new Date());
  const [drugPopoverOpen, setDrugPopoverOpen] = useState(false);
  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientIC, setNewPatientIC] = useState("");
  const [isNewPatient, setIsNewPatient] = useState(false);

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
        .select("drug_id, jenis, kuantiti, tarikh, created_at");
      if (error) throw error;
      return data;
    },
  });

  const stockMap = useMemo(() => computeStockByDrug(allTx), [allTx]);

  const selectedDrug = drugs.find(d => d.id === refillDrugId);
  const currentStock = refillDrugId ? (stockMap.get(refillDrugId) ?? 0) : 0;
  const afterStock = currentStock - refillQty;
  const stockExceeded = refillQty > currentStock;
  const belowMin = afterStock < (selectedDrug?.stok_min ?? 0);

  // Radix's onOpenChange only fires for *internal* close events (Escape,
  // overlay click) — the parent flips `open` directly to launch the dialog,
  // so the reset has to key off the `open` prop itself, not that callback.
  useEffect(() => {
    if (open) {
      setRefillPatient(initialPatient);
      setIsNewPatient(false);
      setNewPatientName("");
      setNewPatientIC("");
      setRefillDrugId("");
      setRefillQty(0);
      setRefillDate(new Date());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refillMutation = useMutation({
    mutationFn: async () => {
      let patientId: string;
      const patientName = refillPatient?.name || newPatientName;
      const patientIC = refillPatient?.ic || newPatientIC;

      if (refillPatient?.id) {
        patientId = refillPatient.id;
      } else {
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
      toast.success(`Isi semula berjaya — stok ${result?.drugName} berkurang ${refillQty}. Baki: ${result?.afterStock} ${result?.unit}`);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      queryClient.invalidateQueries({ queryKey: ["patient-history"] });
      queryClient.invalidateQueries({ queryKey: ["all-tx-stock"] });
      queryClient.invalidateQueries({ queryKey: ["quota-patients"] });
      queryClient.invalidateQueries({ queryKey: ["drug-quota-usage"] });
    },
    onError: () => toast.error("Gagal menyimpan isi semula"),
  });

  const refillPatientSearch = useMemo(() => {
    if (!newPatientName && !newPatientIC) return [];
    const q = (newPatientName || newPatientIC).toLowerCase();
    return patients.filter(p => p.patient_name.toLowerCase().includes(q) || p.no_ic.includes(q)).slice(0, 5);
  }, [patients, newPatientName, newPatientIC]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Isi Semula (Walk-in)</DialogTitle>
          <DialogDescription>Rekod pengeluaran ubat tanpa proses temujanji</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!refillPatient ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Cari pesakit (nama atau IC)</Label>
                <Input
                  placeholder="Nama atau IC"
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
                      onClick={() => setRefillPatient({ id: p.id, name: p.patient_name, ic: p.no_ic })}
                    >
                      <span className="font-medium">{p.patient_name}</span>
                      <span className="text-muted-foreground ml-2">{formatIC(p.no_ic)}</span>
                    </button>
                  ))}
                </div>
              )}
              {!isNewPatient && (
                <Button variant="link" size="sm" onClick={() => setIsNewPatient(true)}>Daftar pesakit baharu</Button>
              )}
              {isNewPatient && (
                <div className="space-y-2 border rounded p-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nama Pesakit</Label>
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
                    Sahkan Pesakit
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-muted rounded p-3 text-sm">
              <p><span className="text-muted-foreground">Pesakit:</span> <strong>{refillPatient.name}</strong></p>
              <p><span className="text-muted-foreground">IC:</span> {formatIC(refillPatient.ic)}</p>
              {!refillPatient.id && (
                <Button variant="link" size="sm" className="px-0" onClick={() => setRefillPatient(null)}>Bukan pesakit ini?</Button>
              )}
            </div>
          )}

          {refillPatient && (
            <>
              <div className="space-y-2">
                <Label>Ubat</Label>
                <Popover open={drugPopoverOpen} onOpenChange={setDrugPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-between", !refillDrugId && "text-muted-foreground")}>
                      {refillDrugId ? `${drugs.find(d => d.id === refillDrugId)?.drug_name} — Stok: ${stockMap.get(refillDrugId) ?? 0}` : "Pilih ubat..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Cari ubat..." />
                      <CommandList>
                        <CommandEmpty>Tiada ubat dijumpai.</CommandEmpty>
                        <CommandGroup>
                          {drugs.map(d => (
                            <CommandItem key={d.id} value={d.drug_name} onSelect={() => { setRefillDrugId(d.id); setDrugPopoverOpen(false); }}>
                              <Check className={cn("mr-2 h-4 w-4", refillDrugId === d.id ? "opacity-100" : "opacity-0")} />
                              {d.drug_name} — Stok: {stockMap.get(d.id) ?? 0} {d.unit_pengukuran}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Kuantiti</Label>
                  <Input type="number" min={1} value={refillQty} onChange={e => setRefillQty(parseInt(e.target.value) || 0)} />
                  {refillDrugId && refillQty > 0 && (
                    <p className={cn("text-xs", belowMin ? "text-destructive" : "text-muted-foreground")}>
                      Stok selepas isi semula: {afterStock} {selectedDrug?.unit_pengukuran}
                    </p>
                  )}
                  {stockExceeded && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> Melebihi stok semasa
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Tarikh</Label>
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

              {refillDrugId && refillQty > 0 && !stockExceeded && (
                <div className="bg-muted rounded p-3 text-xs space-y-1">
                  <p>Mengeluarkan: {refillQty} {selectedDrug?.unit_pengukuran} {selectedDrug?.drug_name}</p>
                  <p>Pesakit: {refillPatient.name} ({formatIC(refillPatient.ic)})</p>
                  <p>Tarikh: {format(refillDate, "dd/MM/yyyy")}</p>
                  <p>Stok semasa: {currentStock} → Stok selepas: {afterStock}</p>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            disabled={!refillPatient || !refillDrugId || refillQty < 1 || stockExceeded || refillMutation.isPending}
            onClick={() => refillMutation.mutate()}
          >
            {refillMutation.isPending ? "Menyimpan..." : "Simpan & Tolak Stok"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
