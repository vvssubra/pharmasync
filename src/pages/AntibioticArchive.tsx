import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { Archive, Search, Download, Eye, ChevronDown, CalendarIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AntibioticFormReadOnly } from "@/components/AntibioticFormReadOnly";
import { antibioticFormFilename, downloadMarkdown, formToMarkdown, type AntibioticFormRecord } from "@/lib/antibioticMarkdown";
import { formatIC } from "@/lib/ic";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  resolvePeriodRange, groupByDay, formatDayLabel, type PeriodKey,
} from "@/lib/archivePeriod";

type ArchivedAntibioticForm = AntibioticFormRecord & {
  id: string;
  submitted_by?: string | null;
  acknowledged_by?: string | null;
};

export default function AntibioticArchive() {
  const [period, setPeriod] = useState<PeriodKey | "">("");
  const [customFrom, setCustomFrom] = useState<Date>();
  const [customTo, setCustomTo] = useState<Date>();
  const [search, setSearch] = useState("");
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
      const ids = [...new Set(list.flatMap(f => [f.submitted_by, f.acknowledged_by]).filter(Boolean) as string[])];
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
        submitted_by_name: profileMap[f.submitted_by] ?? "—",
        acknowledged_by_name: profileMap[f.acknowledged_by] ?? "—",
      }));
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter(f =>
      (f.patient_name || "").toLowerCase().includes(q) ||
      (f.patient_ic || "").toLowerCase().includes(q) ||
      (f.diagnosis || "").toLowerCase().includes(q) ||
      (f.assigned_fms || "").toLowerCase().includes(q)
    );
  }, [forms, search]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  const handleDownload = (form: ArchivedAntibioticForm) => {
    const md = formToMarkdown(form);
    downloadMarkdown(antibioticFormFilename(form), md);
  };

  const rangeSummary = range
    ? range.from === range.to
      ? format(parseISO(range.from), "d MMM yyyy")
      : `${format(parseISO(range.from), "d MMM yyyy")} – ${format(parseISO(range.to), "d MMM yyyy")}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Archive className="h-6 w-6" />
          Abx Archive
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approved antibiotic forms acknowledged by pharmacy. Choose a period to load records.
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground block">Period</label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={period}
              onValueChange={handlePeriodChange}
              className="justify-start flex-wrap"
            >
              <ToggleGroupItem value="today" className="text-xs">Today</ToggleGroupItem>
              <ToggleGroupItem value="week" className="text-xs">This Week</ToggleGroupItem>
              <ToggleGroupItem value="month" className="text-xs">This Month</ToggleGroupItem>
              <ToggleGroupItem value="custom" className="text-xs">Custom</ToggleGroupItem>
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

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="text-xs text-muted-foreground mb-1 block">Search</label>
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by patient, IC, diagnosis or FMS"
                  aria-label="Search archived antibiotic forms"
                  disabled={range === null}
                  className="w-full"
                />
              </div>
            </div>
            {(period !== "" || search) && (
              <Button variant="outline" size="sm" className="text-xs" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-6 pt-4">
            <span className="text-sm font-medium">Archived Forms</span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {rangeSummary && <span>{rangeSummary}</span>}
              {range !== null && (
                <Badge variant="secondary">
                  {search.trim() ? `${filtered.length} of ${forms.length}` : forms.length}
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
            <div className="p-4 space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
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
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>IC</TableHead>
                  <TableHead>Diagnosis</TableHead>
                  <TableHead>FMS</TableHead>
                  <TableHead>Acknowledged</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              {groups.map(group => {
                const isCollapsed = collapsedDays.has(group.date);
                const label = formatDayLabel(group.date, new Date());
                return (
                  <TableBody key={group.date}>
                    <TableRow className="bg-muted/50 hover:bg-muted">
                      <TableCell colSpan={7} className="p-0">
                        <button
                          type="button"
                          onClick={() => toggleDay(group.date)}
                          aria-expanded={!isCollapsed}
                          className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
                        >
                          <ChevronDown className={cn("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")} />
                          <span className="text-sm font-medium">{label}</span>
                          <Badge variant="secondary" className="ml-1">
                            {group.forms.length} {group.forms.length === 1 ? "form" : "forms"}
                          </Badge>
                        </button>
                      </TableCell>
                    </TableRow>
                    {!isCollapsed && group.forms.map(f => (
                      <TableRow key={f.id}>
                        <TableCell className="text-xs">{format(parseISO(f.tarikh), "dd/MM/yyyy")}</TableCell>
                        <TableCell className="font-medium text-sm">{f.patient_name}</TableCell>
                        <TableCell className="text-xs">{formatIC(f.patient_ic ?? "")}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{f.diagnosis}</TableCell>
                        <TableCell className="text-xs">{f.assigned_fms || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {f.acknowledged_at ? format(new Date(f.acknowledged_at), "d MMM yyyy, HH:mm") : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap gap-2 justify-end">
                            <Button size="touch" variant="outline" className="text-xs gap-1" onClick={() => setViewTarget(f)}>
                              <Eye className="h-3 w-3" /> View
                            </Button>
                            <Button size="touch" variant="outline" className="text-xs gap-1" onClick={() => handleDownload(f)}>
                              <Download className="h-3 w-3" /> .md
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                );
              })}
            </Table>
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
