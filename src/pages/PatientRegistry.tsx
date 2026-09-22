import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Search, UserPlus, Share2, Link2, FileSpreadsheet, ShieldCheck, RotateCcw, MapPin, Stethoscope, Clock3,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useDrugQuotaUsage } from "@/hooks/useDrugQuotaUsage";
import { QuotaBenchmarkCard } from "@/components/QuotaBenchmarkCard";
import { QuotaPatientTable, type QuotaPatientRow } from "@/components/QuotaPatientTable";
import { type QuotaStatus } from "@/lib/quotaStatus";
import { PatientHistorySheet } from "@/components/PatientHistorySheet";
import { RefillWalkinDialog } from "@/components/RefillWalkinDialog";
import { formatIC } from "@/lib/ic";

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

// What the two source queries actually return: the owning clinic as an id.
// clinic_name is resolved against the clinics lookup once, below, rather than
// inside the query — so a clinic rename does not need the patient list refetched
// and the query key does not have to carry the clinic list.
type QuotaRow = Omit<QuotaPatientRow, "clinic_name"> & {
  clinic_id: string | null;
  patient_registry: SheetPatient;
};

/** A QuotaRow with its clinic resolved to a name — what the table renders. */
type NamedRow = QuotaRow & { clinic_name: string | null };

export default function PatientRegistry() {
  // logistic_pharmacist reaches this page HQ-wide (cross-clinic SELECT per
  // 20260819000400_logistic_access.sql) but has no write policy on
  // patient_registry/transactions/patient_drug_history — Isi Semula (Walk-in)
  // and the history sheet's refill button are hidden rather than shown and
  // left to fail RLS.
  const { role, profile } = useAuth();
  const canRefill = role !== "logistic_pharmacist";
  const queryClient = useQueryClient();

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

  // Which clinic each row came from. Only super_admin and logistic_pharmacist
  // see rows from more than one, and QuotaPatientTable hides the column when
  // they don't — but the lookup is a handful of rows, so it is unconditional
  // rather than gated on role (clinics is readable by anon, per
  // 20260723000200_tenancy_3_rls.sql).
  const { data: clinics = [] } = useQuery({
    queryKey: ["clinics-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("id, name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const clinicNamesById = useMemo(
    () => new Map(clinics.map(c => [c.id, c.name])),
    [clinics],
  );

  const { data: quotaPatients = [], isLoading: patientsLoading } = useQuery({
    queryKey: ["quota-patients", effectiveDrugId, year],
    enabled: !!effectiveDrugId,
    queryFn: async () => {
      const { data: enrolled, error: enrolledError } = await supabase
        .from("drug_quota_patients")
        .select("id, source_bil, tarikh_mula_rawatan, status, dosing, fms_name, clinic_id, catatan, kuota, patient_id, patient_registry!inner(id, patient_name, no_ic, created_at)")
        .eq("drug_id", effectiveDrugId)
        .eq("year", year)
        .order("source_bil", { ascending: true, nullsFirst: false });
      if (enrolledError) throw enrolledError;
      const enrolledRowsRaw = enrolled as unknown as QuotaRow[];

      // A patient can carry more than one drug_quota_patients row for the same
      // drug/year — re-enrolled under a different FMS, a data-entry repeat,
      // etc. (seen in prod: 12 duplicate ICs for Amlodipine Valsartan alone).
      // drug_quota_used() already collapses these to one slot per normalized
      // IC (kuota = max across the group) before computing "used" — this list
      // has to apply the exact same collapse, or the row count and the quota
      // card's number diverge by exactly the duplicate count.
      const enrolledGroups = new Map<string, QuotaRow[]>();
      for (const row of enrolledRowsRaw) {
        const ic = row.patient_registry.no_ic.replace(/\D/g, "");
        const group = enrolledGroups.get(ic);
        if (group) group.push(row); else enrolledGroups.set(ic, [row]);
      }
      const enrolledRows = Array.from(enrolledGroups.values()).map(group =>
        group.length === 1 ? group[0] : { ...group[0], kuota: Math.max(...group.map(r => r.kuota)) }
      );

      // "Baki Kebangsaan" (get_drug_quota_usage -> drug_quota_used) counts a
      // patient toward national usage the moment their dispensing request is
      // approved, not only once someone enrols them here in
      // drug_quota_patients. Most controlled drugs are never manually
      // enrolled at all (that table was only ever backfilled for Novomix and
      // Levemir at KK Kempas — see 20260727000100_seed_kk_kempas_2026_quota_patients.sql),
      // so this list used to show far fewer patients than the quota card's
      // "used" figure. Union in the same not-already-enrolled dispensing
      // requests drug_quota_used() adds, deduped by digits-only IC the same
      // way, so the two numbers tally.
      const { data: dispensed, error: dispensedError } = await supabase
        .from("dispensing_requests")
        .select("id, no_ic, patient_name, status, created_at, clinic_id")
        .eq("drug_id", effectiveDrugId)
        .eq("is_pesara", false)
        .neq("status", "rejected")
        .gte("created_at", `${year}-01-01`)
        .lt("created_at", `${year + 1}-01-01`)
        .order("created_at", { ascending: true });
      if (dispensedError) throw dispensedError;

      const enrolledIcs = new Set(enrolledRows.map(r => r.patient_registry.no_ic.replace(/\D/g, "")));
      const seenIcs = new Set<string>();
      const dispensedRows: QuotaRow[] = [];
      for (const dr of dispensed ?? []) {
        const ic = dr.no_ic.replace(/\D/g, "");
        if (enrolledIcs.has(ic) || seenIcs.has(ic)) continue;
        seenIcs.add(ic);
        dispensedRows.push({
          id: dr.id,
          source_bil: null,
          tarikh_mula_rawatan: null,
          status: dr.status,
          dosing: null,
          fms_name: null,
          clinic_id: dr.clinic_id,
          catatan: "Dari permintaan pendispensan (belum didaftar kuota)",
          kuota: 1,
          patient_id: `dr:${dr.id}`,
          patient_registry: { id: `dr:${dr.id}`, patient_name: dr.patient_name, no_ic: dr.no_ic, created_at: dr.created_at },
        });
      }
      return [...enrolledRows, ...dispensedRows];
    },
  });

  // Every patient in the clinic (not just this drug) — feeds the walk-in
  // dialog's "search existing patient" step. Skipped entirely for
  // logistic_pharmacist, who can't reach that dialog (canRefill above).
  const { data: allPatients = [] } = useQuery({
    queryKey: ["patients"],
    enabled: canRefill,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_registry")
        .select("id, patient_name, no_ic")
        .order("patient_name");
      if (error) throw error;
      return data;
    },
  });

  const namedRows = useMemo(
    () => quotaPatients.map((row): NamedRow => ({
      ...row,
      clinic_name: row.clinic_id ? clinicNamesById.get(row.clinic_id) ?? null : null,
    })),
    [quotaPatients, clinicNamesById],
  );

  // Releasing a national quota slot is an allocation decision, not a dispensing
  // one, so it is admin-only — enforced by the trigger in
  // 20260827000000_quota_patient_status.sql. Hiding the dropdown for everyone
  // else keeps a pharmacist from meeting that refusal as an error toast.
  const canEditStatus = role === "admin" || role === "super_admin";

  const statusMutation = useMutation({
    mutationFn: async ({ row, status }: { row: NamedRow; status: QuotaStatus }) => {
      // A "dr:" patient_id means this row is a dispensing request that consumed
      // a slot without anyone enrolling the patient (see the quota-patients
      // query). There is no status to update — the enrolment has to be created
      // first, which is also what makes the slot releasable at all.
      if (!row.patient_id.startsWith("dr:")) {
        const { error } = await supabase
          .from("drug_quota_patients")
          .update({ status })
          .eq("id", row.id);
        if (error) throw error;
        return;
      }

      // The row's own clinic, not the editor's: a super_admin has no clinic of
      // their own, and stamp_clinic_id() would leave the insert with a null.
      const clinicId = row.clinic_id ?? profile?.clinic_id ?? null;
      if (!clinicId) throw new Error("Klinik pesakit tidak diketahui — status tidak dapat ditetapkan.");

      const ic = row.patient_registry.no_ic.replace(/\D/g, "");
      // Scoped by clinic: patient_registry is unique on (clinic_id, no_ic), so
      // an IC-only lookup would hand a super_admin another clinic's patient and
      // enrol that row instead.
      const { data: existing, error: findErr } = await supabase
        .from("patient_registry")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("no_ic", ic)
        .maybeSingle();
      if (findErr) throw findErr;

      let patientId = existing?.id;
      if (!patientId) {
        const { data: created, error: insertErr } = await supabase
          .from("patient_registry")
          .insert({ patient_name: row.patient_registry.patient_name, no_ic: ic, clinic_id: clinicId })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        patientId = created.id;
      }

      const { error: enrolErr } = await supabase.from("drug_quota_patients").insert({
        patient_id: patientId,
        drug_id: effectiveDrugId,
        year,
        clinic_id: clinicId,
        status,
        kuota: 1,
        catatan: "Didaftar daripada permintaan pendispensan",
      });
      if (enrolErr) throw enrolErr;
    },
    onSuccess: () => {
      // Both, and in this order of importance: the usage RPC is what the quota
      // card reads, so without it the row says TIDAK AKTIF while the card still
      // counts the slot.
      queryClient.invalidateQueries({ queryKey: ["quota-patients"] });
      queryClient.invalidateQueries({ queryKey: ["drug-quota-usage"] });
      toast.success("Status pesakit dikemas kini");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // "Semua ..." filters below are client-side over the rows already loaded for
  // the selected drug/year — there is no separate query per filter, so a
  // dropdown option only ever lists a value that actually appears on screen.
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [fmsFilter, setFmsFilter] = useState<string>("ALL");
  const [dosingFilter, setDosingFilter] = useState<string>("ALL");
  const [clinicFilter, setClinicFilter] = useState<string>("ALL");

  const statusOptions = useMemo(
    () => Array.from(new Set(namedRows.map(r => r.status).filter(Boolean))).sort(),
    [namedRows],
  );
  const fmsOptions = useMemo(
    () => Array.from(new Set(namedRows.map(r => r.fms_name).filter((v): v is string => !!v))).sort(),
    [namedRows],
  );
  const dosingOptions = useMemo(
    () => Array.from(new Set(namedRows.map(r => r.dosing).filter((v): v is string => !!v))).sort(),
    [namedRows],
  );
  const clinicOptions = useMemo(
    () => Array.from(new Set(namedRows.map(r => r.clinic_name).filter((v): v is string => !!v))).sort(),
    [namedRows],
  );
  const showClinicFilter = clinicOptions.length > 1;

  const hasActiveFilters = !!searchQ || statusFilter !== "ALL" || fmsFilter !== "ALL" || dosingFilter !== "ALL" || clinicFilter !== "ALL";
  const resetFilters = () => {
    setSearchQ("");
    setStatusFilter("ALL");
    setFmsFilter("ALL");
    setDosingFilter("ALL");
    setClinicFilter("ALL");
  };

  const filteredRows = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return namedRows.filter(row => {
      if (q && !(row.patient_registry.patient_name.toLowerCase().includes(q) || (qDigits && row.patient_registry.no_ic.includes(qDigits)))) return false;
      if (statusFilter !== "ALL" && row.status !== statusFilter) return false;
      if (fmsFilter !== "ALL" && row.fms_name !== fmsFilter) return false;
      if (dosingFilter !== "ALL" && row.dosing !== dosingFilter) return false;
      if (clinicFilter !== "ALL" && row.clinic_name !== clinicFilter) return false;
      return true;
    });
  }, [namedRows, searchQ, statusFilter, fmsFilter, dosingFilter, clinicFilter]);

  const selectedDrugName = quotaDrugs.find(d => d.drug_id === effectiveDrugId)?.drugs.drug_name;
  const shareUrl = effectiveDrugId ? `${window.location.origin}/pesakit?drug=${effectiveDrugId}` : window.location.origin;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Pautan disalin");
    } catch {
      toast.error("Gagal menyalin pautan");
    }
  };

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: selectedDrugName ?? "Daftar Pesakit Kuota", url: shareUrl });
      } catch {
        // user cancelled the share sheet — no toast needed
      }
    } else {
      await copyLink();
    }
  };

  // Client-side CSV of exactly what's on screen (post-search, post-filter) —
  // no server round-trip, since filteredRows already holds everything needed.
  const exportCsv = () => {
    const header = ["BIL", "NAMA PESAKIT", "NO IC", "TARIKH MULA RAWATAN", "STATUS", "DOSING", "FMS", "KLINIK", "CATATAN"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = filteredRows.map((row, i) => [
      String(i + 1),
      row.patient_registry.patient_name,
      formatIC(row.patient_registry.no_ic),
      row.tarikh_mula_rawatan ?? "",
      row.status,
      row.dosing ?? "",
      row.fms_name ?? "",
      row.clinic_name ?? "",
      row.catatan ?? "",
    ].map(escape).join(","));
    const csv = [header.map(escape).join(","), ...lines].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daftar-pesakit-kuota-${(selectedDrugName ?? "ubat").toLowerCase().replace(/\s+/g, "-")}-${year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openWalkin = () => {
    setRefillInitial(null);
    setRefillOpen(true);
  };

  const openRefillForPatient = (patient: SheetPatient) => {
    // "dr:..." ids are synthetic — from a dispensing request that consumed a
    // quota slot but has no patient_registry row yet (see the quota-patients
    // query above). Passing that fake id through would hit RefillWalkinDialog's
    // `if (refillPatient?.id)` fast path and insert it as a real patient_id
    // FK. Omit it so the dialog falls back to its search/create-by-IC path,
    // same as a walk-in patient it's never seen before.
    const isRealPatient = !patient.id.startsWith("dr:");
    setRefillInitial({ id: isRealPatient ? patient.id : undefined, name: patient.patient_name, ic: patient.no_ic });
    setSheetPatient(null);
    setRefillOpen(true);
  };

  return (
    <div className="space-y-space-xl">
      {/* Header */}
      <div className="flex flex-col gap-space-base pb-space-xs md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Clinical Registry · Restricted Formulary Protocol
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Daftar Pesakit Kuota</h1>
            <span className="text-base font-medium text-muted-foreground">Patient Quota Registry</span>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Senarai pesakit mengikut ubat kawalan khusus, tahun rujukan {year}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={shareLink}>
            <Share2 className="mr-1 h-4 w-4" /> Kongsi
          </Button>
          <Button variant="outline" size="sm" onClick={copyLink}>
            <Link2 className="mr-1 h-4 w-4" /> Salin Pautan
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filteredRows.length === 0}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Export (CSV)
          </Button>
          {canRefill && (
            <Button onClick={openWalkin} style={{ backgroundColor: "#059669" }}>
              <UserPlus className="mr-1 h-4 w-4" /> Isi Semula (Walk-in)
            </Button>
          )}
        </div>
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
          {/* Formulary drug selector strip */}
          <Card className="shadow-sm">
            <CardContent className="flex flex-col gap-space-base p-space-base sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-2">
                <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
                <span className="shrink-0 text-sm font-medium text-muted-foreground">Pilihan Ubat Berkuota:</span>
                <Select value={effectiveDrugId} onValueChange={setSelectedDrugId}>
                  <SelectTrigger aria-label="Pilih ubat" className="max-w-xl">
                    <SelectValue placeholder="Pilih ubat...">{selectedDrugName}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {quotaDrugs.map(d => (
                      <SelectItem key={d.drug_id} value={d.drug_id}>{d.drugs.drug_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

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

          {/* Filters & quick search */}
          <Card className="shadow-sm">
            <CardContent className="flex flex-col gap-space-md p-space-base lg:flex-row lg:items-center lg:justify-between">
              <div className="relative max-w-md flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Cari nama pesakit atau no. IC…"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  className="pl-9 text-base"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {showClinicFilter && (
                  <div className="flex items-center gap-1.5 rounded bg-muted px-2 py-1">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    <Select value={clinicFilter} onValueChange={setClinicFilter}>
                      <SelectTrigger aria-label="Tapis klinik" className="h-7 w-auto border-0 bg-transparent px-1 text-xs shadow-none focus:ring-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">Semua Klinik</SelectItem>
                        {clinicOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex items-center gap-1.5 rounded bg-muted px-2 py-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger aria-label="Tapis status" className="h-7 w-auto border-0 bg-transparent px-1 text-xs shadow-none focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Semua Status</SelectItem>
                      {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1.5 rounded bg-muted px-2 py-1">
                  <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={fmsFilter} onValueChange={setFmsFilter}>
                    <SelectTrigger aria-label="Tapis FMS" className="h-7 w-auto border-0 bg-transparent px-1 text-xs shadow-none focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Semua FMS Pakar</SelectItem>
                      {fmsOptions.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1.5 rounded bg-muted px-2 py-1">
                  <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select value={dosingFilter} onValueChange={setDosingFilter}>
                    <SelectTrigger aria-label="Tapis dos" className="h-7 w-auto border-0 bg-transparent px-1 text-xs shadow-none focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Semua Dos</SelectItem>
                      {dosingOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {hasActiveFilters && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Tetap Semula Penapis" onClick={resetFilters}>
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Status ribbon */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{filteredRows.length} Pesakit Dipaparkan</span>
              {usage && (
                <>
                  <span className="text-border">•</span>
                  <span className="font-medium text-emerald-600">{Math.max(0, usage.remaining)} Baki Kuota Tersedia</span>
                </>
              )}
            </div>
          </div>

          <QuotaPatientTable
            rows={filteredRows}
            selectedPatientId={sheetPatient?.id ?? null}
            onSelect={(patientId) => {
              const row = quotaPatients.find(r => r.patient_id === patientId);
              if (row) setSheetPatient(row.patient_registry);
            }}
            onStatusChange={canEditStatus ? ((row, status) => {
              // The table hands back its own narrower row type; the mutation
              // needs clinic_id and the "dr:" patient_id, so resolve the full
              // row rather than widening the component's interface.
              const full = namedRows.find(r => r.id === row.id);
              if (full) statusMutation.mutate({ row: full, status });
            }) : undefined}
            savingStatusRowId={statusMutation.isPending ? statusMutation.variables?.row.id ?? null : null}
            isLoading={patientsLoading}
            emptyMessage={hasActiveFilters ? "Tiada padanan untuk penapis semasa." : "Tiada pesakit berdaftar untuk ubat ini."}
          />
          {hasActiveFilters && filteredRows.length === 0 && (
            <div className="text-center">
              <Button variant="link" size="sm" onClick={resetFilters}>Kosongkan penapis</Button>
            </div>
          )}
        </>
      )}

      <PatientHistorySheet
        patient={sheetPatient}
        onOpenChange={(open) => { if (!open) setSheetPatient(null); }}
        onRefill={canRefill ? openRefillForPatient : undefined}
      />

      {canRefill && (
        <RefillWalkinDialog
          open={refillOpen}
          onOpenChange={setRefillOpen}
          patients={allPatients}
          initialPatient={refillInitial}
        />
      )}
    </div>
  );
}
