import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { QuotaBenchmarkCard } from "@/components/QuotaBenchmarkCard";
import { QuotaPatientTable, type QuotaPatientRow } from "@/components/QuotaPatientTable";
import { PatientHistorySheet } from "@/components/PatientHistorySheet";
import { RefillWalkinDialog } from "@/components/RefillWalkinDialog";

const THIS_YEAR = new Date().getFullYear();

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
  // Deep-linked from other pages via /pesakit?drug=<drug_id> (e.g. the
  // dashboard's per-drug "Patient Registry" action) — takes priority over
  // auto-selecting the first drug.
  const [searchParams] = useSearchParams();
  const [selectedDrugId, setSelectedDrugId] = useState<string>(() => searchParams.get("drug") ?? "");
  const [year, setYear] = useState(THIS_YEAR);
  const [searchQ, setSearchQ] = useState("");
  const [sheetPatient, setSheetPatient] = useState<SheetPatient | null>(null);
  const [refillOpen, setRefillOpen] = useState(false);
  const [refillInitial, setRefillInitial] = useState<{ id?: string; name: string; ic: string } | null>(null);

  // Server-computed usage, shared with every other quota-badge page in the app.
  // Since 20260819000300_national_quota_pool.sql this RPC returns the NATIONAL
  // rows (the HQ clinic's), one per drug, not this clinic's own.
  const { byDrugId: quotaUsageByDrug, isLoading: usageLoading } = useDrugQuotaUsage(year);
  const { byDrugId: prevYearUsageByDrug } = useDrugQuotaUsage(year - 1);

  // Drugs that carry an annual quota in the selected year — drives the selector.
  //
  // Sourced from the national rows above rather than from a direct drug_quotas
  // read. A direct read returns whatever RLS lets this clinic see, which is its
  // own legacy per-clinic rows — dead data since the pool went national. Two
  // failures followed from that: a drug PKD Logistik adds to the pool never
  // appeared here (this clinic has no legacy row for it), and drugs whose only
  // row is a stale per-clinic one appeared with no usage figures at all.
  const nationalQuotaDrugIds = useMemo(
    () => Array.from(quotaUsageByDrug.keys()).sort(),
    [quotaUsageByDrug],
  );

  const { data: quotaDrugs = [], isLoading: drugsLoading } = useQuery({
    queryKey: ["quota-drugs", year, nationalQuotaDrugIds],
    enabled: nationalQuotaDrugIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drugs")
        .select("id, drug_name, unit_pengukuran")
        .in("id", nationalQuotaDrugIds);
      if (error) throw error;
      return (data ?? [])
        .map((d): QuotaDrug => ({ drug_id: d.id, drugs: d }))
        .sort((a, b) => a.drugs.drug_name.localeCompare(b.drugs.drug_name));
    },
  });

  // Auto-select the first drug once the list loads.
  const effectiveDrugId = selectedDrugId || quotaDrugs[0]?.drug_id || "";
  const drugNamesById = useMemo(
    () => new Map(quotaDrugs.map((d) => [d.drug_id, d.drugs.drug_name])),
    [quotaDrugs]
  );
  const usage = quotaUsageByDrug.get(effectiveDrugId);
  const prevUsage = prevYearUsageByDrug.get(effectiveDrugId);

  const { data: quotaPatients = [], isLoading: patientsLoading } = useQuery({
    queryKey: ["quota-patients", effectiveDrugId, year],
    enabled: !!effectiveDrugId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drug_quota_patients")
        .select("id, source_bil, tarikh_mula_rawatan, status, dosing, fms_name, catatan, kuota, patient_id, patient_registry!inner(id, patient_name, no_ic, created_at)")
        .eq("drug_id", effectiveDrugId)
        .eq("year", year)
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
            Senarai pesakit mengikut ubat kawalan khusus, tahun {year}
          </p>
        </div>
        <Button onClick={openWalkin} style={{ backgroundColor: "#059669" }}>
          <UserPlus className="mr-1 h-4 w-4" /> Isi Semula (Walk-in)
        </Button>
      </div>

      {/* usageLoading too: the drug list is derived from the usage RPC now, so
          it is legitimately empty while that first call is in flight. */}
      {!drugsLoading && !usageLoading && quotaDrugs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground space-y-2">
            <p>Tiada ubat berkuota kebangsaan untuk tahun {year}.</p>
            {/* No link to /drugs any more: the national pool is set only by PKD
                Logistik through the Logistik HQ dashboard, so pointing a clinic
                admin at Senarai Ubat would send them to a field they cannot
                edit for controlled drugs. */}
            <p className="text-xs">
              Kuota kebangsaan ditetapkan oleh PKD Logistik.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="w-full sm:max-w-xs">
            <Select value={effectiveDrugId} onValueChange={setSelectedDrugId}>
              <SelectTrigger aria-label="Pilih ubat">
                <SelectValue placeholder="Pilih ubat...">{selectedDrugName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {quotaDrugs.map(d => (
                  <SelectItem key={d.drug_id} value={d.drug_id}>{d.drugs.drug_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <QuotaBenchmarkCard
            drugId={effectiveDrugId}
            drugName={selectedDrugName ?? ""}
            year={year}
            availableYears={[THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2]}
            onYearChange={setYear}
            usage={usage}
            allUsage={quotaUsageByDrug}
            prevUsage={prevUsage}
            drugNamesById={drugNamesById}
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
