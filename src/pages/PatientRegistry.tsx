import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useDrugQuotaUsage } from "@/hooks/useDrugQuotaUsage";
import { QuotaHeaderStrip } from "@/components/QuotaHeaderStrip";
import { QuotaPatientTable, type QuotaPatientRow } from "@/components/QuotaPatientTable";
import { PatientHistorySheet } from "@/components/PatientHistorySheet";
import { RefillWalkinDialog } from "@/components/RefillWalkinDialog";

const CURRENT_YEAR = new Date().getFullYear();

interface QuotaDrug {
  drug_id: string;
  drugs: { id: string; drug_name: string; unit_pengukuran: string };
}

interface SheetPatient {
  id: string;
  patient_name: string;
  no_ic: string;
  created_at: string;
}

export default function PatientRegistry() {
  const [selectedDrugId, setSelectedDrugId] = useState<string>("");
  const [searchQ, setSearchQ] = useState("");
  const [sheetPatient, setSheetPatient] = useState<SheetPatient | null>(null);
  const [refillOpen, setRefillOpen] = useState(false);
  const [refillInitial, setRefillInitial] = useState<{ id?: string; name: string; ic: string } | null>(null);

  // Drugs that carry an annual quota this year — drives the selector.
  const { data: quotaDrugs = [], isLoading: drugsLoading } = useQuery({
    queryKey: ["quota-drugs", CURRENT_YEAR],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drug_quotas")
        .select("drug_id, drugs!inner(id, drug_name, unit_pengukuran)")
        .eq("year", CURRENT_YEAR);
      if (error) throw error;
      return (data as unknown as QuotaDrug[]).sort((a, b) => a.drugs.drug_name.localeCompare(b.drugs.drug_name));
    },
  });

  // Auto-select the first drug once the list loads.
  const effectiveDrugId = selectedDrugId || quotaDrugs[0]?.drug_id || "";

  // Server-computed usage, shared with every other quota-badge page in the app.
  const { byDrugId: quotaUsageByDrug, isLoading: usageLoading } = useDrugQuotaUsage(CURRENT_YEAR);
  const usage = quotaUsageByDrug.get(effectiveDrugId);

  const { data: quotaPatients = [], isLoading: patientsLoading } = useQuery({
    queryKey: ["quota-patients", effectiveDrugId, CURRENT_YEAR],
    enabled: !!effectiveDrugId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drug_quota_patients")
        .select("id, source_bil, tarikh_mula_rawatan, status, dosing, fms_name, catatan, kuota, patient_id, patient_registry!inner(id, patient_name, no_ic, created_at)")
        .eq("drug_id", effectiveDrugId)
        .eq("year", CURRENT_YEAR)
        .order("source_bil", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as unknown as (QuotaPatientRow & { patient_registry: SheetPatient })[];
    },
  });

  // Every patient in the clinic (not just this drug) — feeds the walk-in
  // dialog's "search existing patient" step.
  const { data: allPatients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_registry")
        .select("id, patient_name, no_ic")
        .order("patient_name");
      if (error) throw error;
      return data;
    },
  });

  const filteredRows = useMemo(() => {
    if (!searchQ) return quotaPatients;
    const q = searchQ.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return quotaPatients.filter(row =>
      row.patient_registry.patient_name.toLowerCase().includes(q)
      || (qDigits && row.patient_registry.no_ic.includes(qDigits)));
  }, [quotaPatients, searchQ]);

  const selectedDrugName = quotaDrugs.find(d => d.drug_id === effectiveDrugId)?.drugs.drug_name;

  const openWalkin = () => {
    setRefillInitial(null);
    setRefillOpen(true);
  };

  const openRefillForPatient = (patient: SheetPatient) => {
    setRefillInitial({ id: patient.id, name: patient.patient_name, ic: patient.no_ic });
    setSheetPatient(null);
    setRefillOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Daftar Pesakit Kuota</h1>
          <p className="text-sm text-muted-foreground">
            Senarai pesakit mengikut ubat kawalan khusus, tahun {CURRENT_YEAR}
          </p>
        </div>
        <Button onClick={openWalkin} style={{ backgroundColor: "#059669" }}>
          <UserPlus className="mr-1 h-4 w-4" /> Isi Semula (Walk-in)
        </Button>
      </div>

      {!drugsLoading && quotaDrugs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground space-y-2">
            <p>Tiada ubat berkuota untuk tahun {CURRENT_YEAR}.</p>
            <Button variant="link" asChild>
              <a href="/drugs">Tetapkan kuota di Senarai Ubat</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="max-w-xs">
            <Select value={effectiveDrugId} onValueChange={setSelectedDrugId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih ubat...">{selectedDrugName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {quotaDrugs.map(d => (
                  <SelectItem key={d.drug_id} value={d.drug_id}>{d.drugs.drug_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <QuotaHeaderStrip
            quotaLimit={usage?.quota_limit ?? 0}
            used={usage?.used ?? 0}
            remaining={usage?.remaining ?? 0}
            alertThresholdPct={usage?.alert_threshold_pct ?? 20}
            isLoading={usageLoading}
          />

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari nama pesakit atau no. IC…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="pl-9 text-base"
            />
          </div>

          <QuotaPatientTable
            rows={filteredRows}
            selectedPatientId={sheetPatient?.id ?? null}
            onSelect={(patientId) => {
              const row = quotaPatients.find(r => r.patient_id === patientId);
              if (row) setSheetPatient(row.patient_registry);
            }}
            isLoading={patientsLoading}
            emptyMessage={searchQ ? `Tiada padanan untuk "${searchQ}".` : "Tiada pesakit berdaftar untuk ubat ini."}
          />
          {searchQ && filteredRows.length === 0 && (
            <div className="text-center">
              <Button variant="link" size="sm" onClick={() => setSearchQ("")}>Kosongkan carian</Button>
            </div>
          )}
        </>
      )}

      <PatientHistorySheet
        patient={sheetPatient}
        onOpenChange={(open) => { if (!open) setSheetPatient(null); }}
        onRefill={openRefillForPatient}
      />

      <RefillWalkinDialog
        open={refillOpen}
        onOpenChange={setRefillOpen}
        patients={allPatients}
        initialPatient={refillInitial}
      />
    </div>
  );
}
