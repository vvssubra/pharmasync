import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import {
  Archive, Search, Download, Eye, ChevronDown, CalendarIcon, ShieldCheck, Timer,
  FlaskConical, FileSpreadsheet, FileDown, Building2, Stethoscope, Layers, RotateCcw,
  Rows3, CalendarDays, ArrowUpDown,
} from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AntibioticFormReadOnly, NagBadge } from "@/components/AntibioticFormReadOnly";
import { antibioticFormFilename, downloadMarkdown, formToMarkdown, type AntibioticFormRecord } from "@/lib/antibioticMarkdown";
import { formatIC, getAgeFromIC, getGenderFromIC } from "@/lib/ic";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  resolvePeriodRange, groupByDay, formatDayLabel, type PeriodKey,
} from "@/lib/archivePeriod";

type ArchivedAntibioticForm = AntibioticFormRecord & {
  id: string;
  clinic_id?: string | null;
  clinic_name?: string | null;
  pathway_check_result?: string | null;
  submitted_by?: string | null;
  acknowledged_by?: string | null;
};

const ALL = "__all__";

// First word after the dosage-form prefix (Tab./Syp./Cap./…) reads as the
// antibiotic name closely enough for a spectrum breakdown, without needing a
// drug-name dictionary.
function extractDrugName(regimen?: string | null): string | null {
  if (!regimen) return null;
  const withoutForm = regimen.replace(/^(tab|syp|cap|susp|inj|iv|supp)\.?\s*/i, "");
  const match = withoutForm.match(/^[A-Za-z][A-Za-z]+/);
  return match ? match[0] : null;
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const SPECTRUM_COLORS = ["bg-primary", "bg-primary/60", "bg-secondary-foreground/40", "bg-muted-foreground/30"];

export default function AntibioticArchive() {
  const [period, setPeriod] = useState<PeriodKey | "">("");
  const [customFrom, setCustomFrom] = useState<Date>();
  const [customTo, setCustomTo] = useState<Date>();
  const [search, setSearch] = useState("");
  const [facility, setFacility] = useState(ALL);
  const [reviewer, setReviewer] = useState(ALL);
  const [indication, setIndication] = useState(ALL);
  const [verdict, setVerdict] = useState(ALL);
  const [grouping, setGrouping] = useState<"date" | "flat">("date");
  const [sortDir, setSortDir] = useState<"newest" | "oldest">("newest");
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [viewTarget, setViewTarget] = useState<ArchivedAntibioticForm | null>(null);

  const range = useMemo(
    () => resolvePeriodRange(period, new Date(), customFrom, customTo),
    [period, customFrom, customTo],
  );

  const handlePeriodChange = (value: string) => {
    setPeriod((value as PeriodKey) ?? "");
    setCollapsedDays(new Set());
  };

  const clearFilters = () => {
    setPeriod("");
    setCustomFrom(undefined);
    setCustomTo(undefined);
    setSearch("");
    setFacility(ALL);
    setReviewer(ALL);
    setIndication(ALL);
    setVerdict(ALL);
    setCollapsedDays(new Set());
  };

  const toggleDay = (date: string) => {
    setCollapsedDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const { data: forms = [], isLoading, isError, error } = useQuery({
    queryKey: ["antibiotic-archive", range?.from ?? null, range?.to ?? null],
    enabled: range !== null,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("antibiotic_forms")
        .select("*")
        .eq("status", "approved")
        .not("acknowledged_at", "is", null)
        .gte("tarikh", range!.from)
        .lte("tarikh", range!.to)
        .order("tarikh", { ascending: false })
        .order("acknowledged_at", { ascending: false });
      if (error) throw error;

      const list = (rows ?? []) as ArchivedAntibioticForm[];

      const profileIds = [...new Set(list.flatMap(f => [f.submitted_by, f.acknowledged_by]).filter(Boolean) as string[])];
      const profileMap: Record<string, string> = {};
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", profileIds);
        for (const p of profiles ?? []) profileMap[p.user_id] = p.full_name;
      }

      const clinicIds = [...new Set(list.map(f => f.clinic_id).filter(Boolean) as string[])];
      const clinicMap: Record<string, string> = {};
      if (clinicIds.length > 0) {
        const { data: clinics } = await supabase
          .from("clinics")
          .select("id, name")
          .in("id", clinicIds);
        for (const c of clinics ?? []) clinicMap[c.id] = c.name;
      }

      return list.map(f => ({
        ...f,
        submitted_by_name: profileMap[f.submitted_by] ?? "—",
        acknowledged_by_name: profileMap[f.acknowledged_by] ?? "—",
        clinic_name: f.clinic_id ? clinicMap[f.clinic_id] ?? null : null,
      }));
    },
  });

  const facilities = useMemo(
    () => [...new Set(forms.map(f => f.clinic_name).filter(Boolean) as string[])].sort(),
    [forms],
  );
  const reviewers = useMemo(
    () => [...new Set(forms.map(f => f.assigned_fms).filter(Boolean) as string[])].sort(),
    [forms],
  );
  const indications = useMemo(
    () => [...new Set(forms.map(f => f.diagnosis).filter(Boolean) as string[])].sort(),
    [forms],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return forms.filter(f => {
      if (facility !== ALL && f.clinic_name !== facility) return false;
      if (reviewer !== ALL && f.assigned_fms !== reviewer) return false;
      if (indication !== ALL && f.diagnosis !== indication) return false;
      if (verdict !== ALL && (f.pathway_check_result ?? "unavailable") !== verdict) return false;
      if (!q) return true;
      return (
        (f.patient_name || "").toLowerCase().includes(q) ||
        (f.patient_ic || "").toLowerCase().includes(q) ||
        (f.diagnosis || "").toLowerCase().includes(q) ||
        (f.assigned_fms || "").toLowerCase().includes(q)
      );
    });
  }, [forms, search, facility, reviewer, indication, verdict]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sortDir === "oldest") copy.reverse();
    return copy;
  }, [filtered, sortDir]);

  const groups = useMemo(() => groupByDay(sorted), [sorted]);

  const filtersActive = period !== "" || !!search || facility !== ALL || reviewer !== ALL || indication !== ALL || verdict !== ALL;

  const handleDownload = (form: ArchivedAntibioticForm) => {
    const md = formToMarkdown(form);
    downloadMarkdown(antibioticFormFilename(form), md);
  };

  const handleDownloadAll = () => {
    for (const f of sorted) handleDownload(f);
  };

  const handleExportCsv = () => {
    const header = ["TARIKH", "NAMA PESAKIT", "NO IC", "DIAGNOSIS", "REGIMEN", "FMS", "KLINIK", "NAG VERDICT", "PHARMACIST", "DICLEARKAN PADA"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = sorted.map(f => [
      f.tarikh,
      f.patient_name,
      formatIC(f.patient_ic ?? ""),
      f.diagnosis,
      f.antibiotic_regimen ?? "",
      f.assigned_fms ?? "",
      f.clinic_name ?? "",
      f.pathway_check_result ?? "",
      f.acknowledged_by_name ?? "",
      f.acknowledged_at ? format(new Date(f.acknowledged_at), "yyyy-MM-dd HH:mm") : "",
    ].map(escape).join(","));
    const csv = [header.map(escape).join(","), ...lines].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `abx-archive-${range?.from ?? "range"}-${range?.to ?? ""}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const rangeSummary = range
    ? range.from === range.to
      ? format(parseISO(range.from), "d MMM yyyy")
      : `${format(parseISO(range.from), "d MMM yyyy")} – ${format(parseISO(range.to), "d MMM yyyy")}`
    : null;

  // Telemetry strip reflects the whole loaded period (not the client-side
  // search/filter selection), matching what the period chips promise.
  const compliancePct = forms.length > 0
    ? Math.round((forms.filter(f => f.pathway_check_result === "supported").length / forms.length) * 100)
    : null;

  const clearanceMinutes = useMemo(() => {
    const samples = forms
      .filter(f => f.specialist_action_at && f.acknowledged_at)
      .map(f => (new Date(f.acknowledged_at!).getTime() - new Date(f.specialist_action_at!).getTime()) / 60000)
      .filter(m => m >= 0);
    if (samples.length === 0) return null;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }, [forms]);

  const spectrum = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of forms) {
      const drug = extractDrugName(f.antibiotic_regimen);
      if (!drug) continue;
      counts.set(drug, (counts.get(drug) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total === 0) return { total: 0, top: [] as { drug: string; pct: number }[] };
    const sortedEntries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sortedEntries.slice(0, 3).map(([drug, n]) => ({ drug, pct: Math.round((n / total) * 100) }));
    const shown = top.reduce((a, t) => a + t.pct, 0);
    if (shown < 100 && sortedEntries.length > 3) top.push({ drug: "Others", pct: 100 - shown });
    return { total, top };
  }, [forms]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Specialized Protocols</span>
            <span>/</span>
            <span className="text-primary font-semibold">Abx Archive</span>
            <Badge variant="secondary" className="ml-1">NAG 2024 Stewardship</Badge>
          </div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2 mt-1">
            <Archive className="h-6 w-6" />
            Antibiotic Stewardship Archive
            {range !== null && <Badge variant="secondary">{forms.length} Verified Forms</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Approved antibiotic justification forms acknowledged by clinical pharmacy. Choose a period to load records.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportCsv} disabled={sorted.length === 0}>
            <FileSpreadsheet className="h-4 w-4" /> Export Summary (CSV)
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadAll} disabled={sorted.length === 0}>
            <FileDown className="h-4 w-4" /> Download All (Markdown)
          </Button>
        </div>
      </div>

      {range !== null && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
          <Card>
            <CardContent className="p-3.5 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Forms Archived</span>
                <span className="text-2xl font-bold text-foreground mt-1">{forms.length}</span>
                <span className="text-xs text-muted-foreground">{rangeSummary}</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-primary shrink-0">
                <Archive className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">NAG 2024 Compliance</span>
                <span className="text-2xl font-bold text-foreground mt-1">{compliancePct !== null ? `${compliancePct}%` : "—"}</span>
                <span className="text-xs text-primary font-medium">Empirically supported</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-primary shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Avg. Pharmacy Clearance</span>
                <span className="text-2xl font-bold text-foreground mt-1">{clearanceMinutes !== null ? formatMinutes(clearanceMinutes) : "—"}</span>
                <span className="text-xs text-muted-foreground">Specialist sign-off → pharmacy ack</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-primary shrink-0">
                <Timer className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3.5 flex flex-col justify-between h-full">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground uppercase tracking-wider">
                <span>Top Prescribed Spectrum</span>
                <FlaskConical className="h-3.5 w-3.5" />
              </div>
              {spectrum.top.length === 0 ? (
                <span className="text-sm text-muted-foreground mt-2">No regimen data yet.</span>
              ) : (
                <>
                  <div className="w-full bg-muted h-2.5 rounded-full overflow-hidden flex my-2">
                    {spectrum.top.map((t, i) => (
                      <div key={t.drug} className={SPECTRUM_COLORS[i % SPECTRUM_COLORS.length]} style={{ width: `${t.pct}%` }} title={`${t.drug} ${t.pct}%`} />
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground flex-wrap gap-x-2">
                    {spectrum.top.map(t => <span key={t.drug}>{t.drug} {t.pct}%</span>)}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
            <div className="relative flex-1">
              <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by patient name, MyKad/IC, diagnosis or FMS reviewer…"
                aria-label="Search archived antibiotic forms"
                disabled={range === null}
                className="pl-9"
              />
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              value={period}
              onValueChange={handlePeriodChange}
              className="justify-start flex-wrap"
            >
              <ToggleGroupItem value="today" className="text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">Today</ToggleGroupItem>
              <ToggleGroupItem value="week" className="text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">This Week</ToggleGroupItem>
              <ToggleGroupItem value="month" className="text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">This Month</ToggleGroupItem>
              <ToggleGroupItem value="custom" className="text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">Custom</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {period === "custom" && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full sm:w-[150px] justify-start text-left font-normal", !customFrom && "text-muted-foreground")}>
                      <CalendarIcon className="mr-1 h-4 w-4" />
                      {customFrom ? format(customFrom, "dd/MM/yyyy") : "Start date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full sm:w-[150px] justify-start text-left font-normal", !customTo && "text-muted-foreground")}>
                      <CalendarIcon className="mr-1 h-4 w-4" />
                      {customTo ? format(customTo, "dd/MM/yyyy") : "End date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customTo} onSelect={setCustomTo} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          {range !== null && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {facilities.length > 1 && (
                  <Select value={facility} onValueChange={setFacility}>
                    <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <SelectValue placeholder="Facility" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All facilities</SelectItem>
                      {facilities.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {reviewers.length > 1 && (
                  <Select value={reviewer} onValueChange={setReviewer}>
                    <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
                      <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />
                      <SelectValue placeholder="FMS Reviewer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All FMS reviewers</SelectItem>
                      {reviewers.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {indications.length > 1 && (
                  <Select value={indication} onValueChange={setIndication}>
                    <SelectTrigger className="h-8 w-auto gap-1.5 text-xs max-w-[220px]">
                      <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <SelectValue placeholder="Indication" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All diagnoses</SelectItem>
                      {indications.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Select value={verdict} onValueChange={setVerdict}>
                  <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
                    <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue placeholder="NAG Verdict" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All NAG verdicts</SelectItem>
                    <SelectItem value="supported">Supported</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="not_supported">Not supported</SelectItem>
                    <SelectItem value="refer_specialist">Refer specialist</SelectItem>
                  </SelectContent>
                </Select>
                {filtersActive && (
                  <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground hover:text-destructive" onClick={clearFilters}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset filters
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <div className="flex items-center bg-muted p-0.5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setGrouping("date")}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                      grouping === "date" ? "bg-background text-primary shadow-xs" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <CalendarDays className="h-3.5 w-3.5" /> By Date
                  </button>
                  <button
                    type="button"
                    onClick={() => setGrouping("flat")}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                      grouping === "flat" ? "bg-background text-primary shadow-xs" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Rows3 className="h-3.5 w-3.5" /> Flat
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setSortDir(d => (d === "newest" ? "oldest" : "newest"))}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors pl-1"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  Acknowledged {sortDir === "newest" ? "(Newest)" : "(Oldest)"}
                </button>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-6 pt-4">
            <span className="text-sm font-medium">Archived Forms</span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {rangeSummary && <span>{rangeSummary}</span>}
              {range !== null && (
                <Badge variant="secondary">
                  {filtersActive ? `${filtered.length} of ${forms.length}` : forms.length}
                </Badge>
              )}
            </div>
          </div>

          {range === null && period !== "custom" ? (
            <div className="text-center py-10 px-6 space-y-1">
              <p className="text-sm font-medium text-foreground">Choose a period to begin</p>
              <p className="text-xs text-muted-foreground">
                Select Today, This Week, This Month, or a custom date range to load archived antibiotic forms.
              </p>
            </div>
          ) : range === null ? (
            <div className="text-center py-10 px-6">
              <p className="text-sm text-muted-foreground">Pick both a start and an end date to load records.</p>
            </div>
          ) : isLoading ? (
            <div className="p-4 space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : isError ? (
            <div className="px-6 py-8 space-y-1">
              <p className="text-sm font-medium text-destructive">Could not load the archive.</p>
              <p className="text-xs text-muted-foreground">{getErrorMessage(error, "Unknown error.")}</p>
            </div>
          ) : forms.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">No antibiotic forms in this period.</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-sm text-muted-foreground">No form matches “{search.trim()}”.</p>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setSearch("")}>
                Clear search
              </Button>
            </div>
          ) : grouping === "flat" ? (
            <div className="px-4 pb-4 space-y-2">
              {sorted.map(f => (
                <ArchiveRecordCard key={f.id} form={f} onView={() => setViewTarget(f)} onDownload={() => handleDownload(f)} showDate />
              ))}
            </div>
          ) : (
            <div className="px-4 pb-4 space-y-4">
              {groups.map(group => {
                const isCollapsed = collapsedDays.has(group.date);
                const label = formatDayLabel(group.date, new Date());
                return (
                  <div key={group.date} className="space-y-2">
                    <button
                      type="button"
                      onClick={() => toggleDay(group.date)}
                      aria-expanded={!isCollapsed}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-lg hover:bg-muted/60 transition-colors"
                    >
                      <ChevronDown className={cn("h-4 w-4 transition-transform text-muted-foreground", isCollapsed && "-rotate-90")} />
                      <span className="text-sm font-semibold">{label}</span>
                      <Badge variant="secondary">
                        {group.forms.length} {group.forms.length === 1 ? "form" : "forms"}
                      </Badge>
                    </button>
                    {!isCollapsed && (
                      <div className="space-y-2">
                        {group.forms.map(f => (
                          <ArchiveRecordCard key={f.id} form={f} onView={() => setViewTarget(f)} onDownload={() => handleDownload(f)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewTarget} onOpenChange={open => { if (!open) setViewTarget(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Antibiotic Form — {viewTarget?.patient_name}</DialogTitle>
          </DialogHeader>
          {viewTarget && <AntibioticFormReadOnly form={viewTarget} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
            {viewTarget && (
              <Button className="gap-1" onClick={() => handleDownload(viewTarget)}>
                <Download className="h-3.5 w-3.5" /> Download .md
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArchiveRecordCard({
  form, onView, onDownload, showDate,
}: {
  form: ArchivedAntibioticForm;
  onView: () => void;
  onDownload: () => void;
  showDate?: boolean;
}) {
  const age = getAgeFromIC(form.patient_ic ?? "");
  const gender = getGenderFromIC(form.patient_ic ?? "");
  const day = format(parseISO(form.tarikh), "d");
  const monthLabel = format(parseISO(form.tarikh), "MMM");

  return (
    <div className="rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div className="flex items-start gap-4 min-w-0 flex-1">
        {showDate && (
          <div className="w-12 h-12 rounded-xl bg-secondary flex flex-col items-center justify-center flex-shrink-0 text-primary">
            <span className="text-sm font-bold leading-tight">{day}</span>
            <span className="text-[10px] uppercase font-bold tracking-wider leading-tight text-muted-foreground">{monthLabel}</span>
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-foreground tracking-tight truncate">{form.patient_name}</span>
            <span className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground font-mono text-[11px] font-semibold">
              {formatIC(form.patient_ic ?? "")}
            </span>
            {(gender || age !== null) && (
              <span className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-[11px] font-semibold">
                {gender ?? "—"}{age !== null ? ` • ${age}y` : ""}
              </span>
            )}
            {form.clinic_name && (
              <span className="px-2 py-0.5 rounded-full bg-secondary text-primary text-[11px] font-semibold flex items-center gap-1">
                <Building2 className="h-3 w-3" /> {form.clinic_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap pt-0.5 text-xs">
            <span className="text-destructive font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive" /> {form.diagnosis}
            </span>
            {form.antibiotic_regimen && (
              <>
                <span className="text-muted-foreground">•</span>
                <span className="text-foreground font-medium">{form.antibiotic_regimen}</span>
              </>
            )}
            <NagBadge result={form.pathway_check_result} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap lg:flex-nowrap items-center gap-6 self-stretch lg:self-auto pt-3 lg:pt-0 lg:border-l lg:border-border lg:pl-6">
        <div className="flex flex-col min-w-[160px]">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">FMS Endorsement</span>
          <span className="text-sm font-bold text-foreground truncate">{form.assigned_fms || "—"}</span>
          <span className="text-xs text-muted-foreground truncate">{form.fms_code ? `Ref #${form.fms_code}` : "—"}</span>
        </div>
        <div className="flex flex-col min-w-[160px]">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Pharmacy Cleared</span>
          <span className="text-sm font-semibold text-foreground">
            {form.acknowledged_at ? format(new Date(form.acknowledged_at), "d MMM yyyy, HH:mm") : "—"}
          </span>
          <span className="text-xs text-muted-foreground truncate">{form.acknowledged_by_name ?? "—"}</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto lg:ml-0">
          <Button size="touch" variant="outline" className="text-xs gap-1" onClick={onView}>
            <Eye className="h-3 w-3" /> View
          </Button>
          <Button size="touch" variant="outline" className="text-xs gap-1" onClick={onDownload}>
            <Download className="h-3 w-3" /> .md
          </Button>
        </div>
      </div>
    </div>
  );
}
