import { useState, useMemo } from "react";
import { format } from "date-fns";
import {
  FileDown, FileSpreadsheet, Search, CalendarIcon, ChevronDown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

// A single transaction row (with joined drug name/unit) used to derive every report below.
interface TxRow {
  drug_id: string;
  jenis: "terimaan" | "keluaran" | "baki_awal";
  kuantiti: number;
  tarikh: string | null;
  created_at: string;
  nama_pegawai: string | null;
  nama_pesakit: string | null;
  no_ic: string | null;
  jumlah_rm: number | null;
  drugs?: { drug_name: string | null; unit_pengukuran: string | null } | null;
}

// Normalise a transaction to a "yyyy-MM-dd" string (prefer the recorded tarikh, fall back to created_at).
function txDateStr(tx: TxRow): string {
  if (tx.tarikh) return tx.tarikh.slice(0, 10);
  return format(new Date(tx.created_at), "yyyy-MM-dd");
}

function drugNameOf(tx: TxRow): string {
  return tx.drugs?.drug_name ?? "—";
}

function DatePickerField({ label, date, onSelect }: { label: string; date?: Date; onSelect: (d?: Date) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn("w-full justify-start text-left font-normal text-sm h-9", !date && "text-muted-foreground")}>
            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
            {date ? format(date, "dd/MM/yyyy") : "Select date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={date} onSelect={onSelect} initialFocus className="p-3 pointer-events-auto" />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function comingSoon() {
  toast("Coming soon", { description: "This feature is under development." });
}

export default function Laporan() {
  // Card 1 state
  const [selectedDrug, setSelectedDrug] = useState("");
  const [drugOpen, setDrugOpen] = useState(false);
  const [pdfFrom, setPdfFrom] = useState<Date>();
  const [pdfTo, setPdfTo] = useState<Date>();

  // Card 2 state
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("all");

  // Card 3 state
  const [movFrom, setMovFrom] = useState<Date>();
  const [movTo, setMovTo] = useState<Date>();
  const [showMovement, setShowMovement] = useState(false);

  // Card 4 state
  const [dailyDate, setDailyDate] = useState<Date>(new Date());

  // Fetch drugs for combobox
  const { data: drugs = [] } = useQuery({
    queryKey: ["drugs-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drugs").select("id, drug_name").eq("is_active", true).order("drug_name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch every transaction (with joined drug info) once; all report tables derive from this ledger.
  const { data: allTx = [], isLoading: txLoading } = useQuery({
    queryKey: ["laporan-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("drug_id, jenis, kuantiti, tarikh, created_at, nama_pegawai, nama_pesakit, no_ic, jumlah_rm, drugs(drug_name, unit_pengukuran)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TxRow[];
    },
  });

  const selectedDrugName = drugs.find((d) => d.id === selectedDrug)?.drug_name;

  // CARD 2 — Quarterly Summary: group the ledger by drug for the chosen year/quarter.
  // Received = stock added (terimaan + baki_awal opening balance); Dispensed = keluaran; Balance = Received − Dispensed for the period.
  const quarterlyData = useMemo(() => {
    const yearNum = parseInt(year, 10);
    const map = new Map<string, { drug: string; terimaan: number; keluaran: number }>();
    for (const tx of allTx) {
      const ds = txDateStr(tx);
      const [y, m] = ds.split("-").map(Number);
      if (y !== yearNum) continue;
      const q = Math.floor((m - 1) / 3) + 1; // 1..4
      if (quarter !== "all" && `Q${q}` !== quarter) continue;
      const entry = map.get(tx.drug_id) ?? { drug: drugNameOf(tx), terimaan: 0, keluaran: 0 };
      if (tx.jenis === "terimaan" || tx.jenis === "baki_awal") entry.terimaan += tx.kuantiti;
      else if (tx.jenis === "keluaran") entry.keluaran += tx.kuantiti;
      map.set(tx.drug_id, entry);
    }
    return Array.from(map.values())
      .map((e) => ({ ...e, baki: e.terimaan - e.keluaran }))
      .sort((a, b) => b.keluaran - a.keluaran);
  }, [allTx, year, quarter]);

  // CARD 3 — Drug Movement Summary: dispensing (keluaran) totals per drug within the selected date range.
  const movementData = useMemo(() => {
    if (!showMovement) return [];
    const fromStr = movFrom ? format(movFrom, "yyyy-MM-dd") : null;
    const toStr = movTo ? format(movTo, "yyyy-MM-dd") : null;
    const map = new Map<string, { drug: string; totalQty: number; totalRM: number; count: number; lastDate: string }>();
    for (const tx of allTx) {
      if (tx.jenis !== "keluaran") continue;
      const ds = txDateStr(tx);
      if (fromStr && ds < fromStr) continue;
      if (toStr && ds > toStr) continue;
      const entry = map.get(tx.drug_id) ?? { drug: drugNameOf(tx), totalQty: 0, totalRM: 0, count: 0, lastDate: ds };
      entry.totalQty += tx.kuantiti;
      entry.totalRM += tx.jumlah_rm ?? 0;
      entry.count += 1;
      if (ds > entry.lastDate) entry.lastDate = ds;
      map.set(tx.drug_id, entry);
    }
    return Array.from(map.values())
      .map((e) => ({ ...e, avg: e.count ? Math.round(e.totalQty / e.count) : 0 }))
      .sort((a, b) => b.totalQty - a.totalQty);
  }, [allTx, showMovement, movFrom, movTo]);

  // CARD 4 — Daily Dispensing Report: every keluaran (drug issued to a patient) on the selected day.
  const dailyDispensing = useMemo(() => {
    const target = format(dailyDate, "yyyy-MM-dd");
    return allTx
      .filter((tx) => tx.jenis === "keluaran" && txDateStr(tx) === target)
      .map((tx) => ({
        drug: drugNameOf(tx),
        pesakit: tx.nama_pesakit ?? "—",
        ic: tx.no_ic ?? "—",
        qty: tx.kuantiti,
        pegawai: tx.nama_pegawai ?? "—",
        masa: format(new Date(tx.created_at), "HH:mm"),
      }));
  }, [allTx, dailyDate]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">Generate reports and export data</p>
      </div>

      {/* 4 Report Cards — 2x2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CARD 1 — KEW.PS-3 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Kad Stok Digital (KEW.PS-3)</CardTitle>
            <CardDescription>Generate stock card PDF in KEW.PS-3 format for audit purposes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Drug</Label>
              <Popover open={drugOpen} onOpenChange={setDrugOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between text-sm h-9 font-normal">
                    {selectedDrugName || "Select drug..."}
                    <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 pointer-events-auto" align="start">
                  <Command>
                    <CommandInput placeholder="Search drugs..." />
                    <CommandList>
                      <CommandEmpty>No drugs found.</CommandEmpty>
                      <CommandGroup>
                        {drugs.map((d) => (
                          <CommandItem key={d.id} value={d.drug_name} onSelect={() => { setSelectedDrug(d.id); setDrugOpen(false); }}>
                            {d.drug_name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DatePickerField label="From Date" date={pdfFrom} onSelect={setPdfFrom} />
              <DatePickerField label="To Date" date={pdfTo} onSelect={setPdfTo} />
            </div>
            <Button className="w-full" onClick={comingSoon}>
              <FileDown className="mr-2 h-4 w-4" />
              Generate PDF
            </Button>
            <p className="text-xs text-muted-foreground">PDF will contain Part A and Part B in KEW.PS-3 format</p>
          </CardContent>
        </Card>

        {/* CARD 2 — Quarterly Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quarterly Summary</CardTitle>
            <CardDescription>Aggregate stock receipts and dispensing by quarter</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Year</Label>
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2024">2024</SelectItem>
                    <SelectItem value="2025">2025</SelectItem>
                    <SelectItem value="2026">2026</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Quarter</Label>
                <Select value={quarter} onValueChange={setQuarter}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Quarters</SelectItem>
                    <SelectItem value="Q1">Q1 Jan–Mar</SelectItem>
                    <SelectItem value="Q2">Q2 Apr–Jun</SelectItem>
                    <SelectItem value="Q3">Q3 Jul–Sep</SelectItem>
                    <SelectItem value="Q4">Q4 Oct–Dec</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={comingSoon}>Generate Report</Button>
              <Button variant="secondary" onClick={comingSoon}>
                <FileSpreadsheet className="mr-1 h-4 w-4" />
                Export Excel
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Drug</TableHead>
                  <TableHead className="text-xs text-right">Received</TableHead>
                  <TableHead className="text-xs text-right">Dispensed</TableHead>
                  <TableHead className="text-xs text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-xs text-muted-foreground">Loading…</TableCell>
                  </TableRow>
                ) : quarterlyData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-xs text-muted-foreground">No data for this period yet.</TableCell>
                  </TableRow>
                ) : (
                  quarterlyData.map((r) => (
                    <TableRow key={r.drug}>
                      <TableCell className="text-xs font-medium">{r.drug}</TableCell>
                      <TableCell className="text-xs text-right">{r.terimaan.toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-right">{r.keluaran.toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{r.baki.toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* CARD 3 — Drug Movement Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Drug Movement Summary</CardTitle>
            <CardDescription>Total stock dispensing by selected period</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DatePickerField label="From Date" date={movFrom} onSelect={setMovFrom} />
              <DatePickerField label="To Date" date={movTo} onSelect={setMovTo} />
            </div>
            <Button className="w-full" onClick={() => setShowMovement(true)}>
              <Search className="mr-2 h-4 w-4" />
              Search
            </Button>
            {showMovement && (
              <div className="overflow-auto max-h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Drug</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs text-right">RM</TableHead>
                      <TableHead className="text-xs text-right">Count</TableHead>
                      <TableHead className="text-xs text-right">Avg</TableHead>
                      <TableHead className="text-xs">Last Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">Loading…</TableCell>
                      </TableRow>
                    ) : movementData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">No data for this period yet.</TableCell>
                      </TableRow>
                    ) : (
                      movementData.map((r) => (
                        <TableRow key={r.drug}>
                          <TableCell className="text-xs font-medium">{r.drug}</TableCell>
                          <TableCell className="text-xs text-right">{r.totalQty.toLocaleString()}</TableCell>
                          <TableCell className="text-xs text-right">{r.totalRM.toFixed(2)}</TableCell>
                          <TableCell className="text-xs text-right">{r.count}</TableCell>
                          <TableCell className="text-xs text-right">{r.avg}</TableCell>
                          <TableCell className="text-xs">{r.lastDate}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* CARD 4 — Daily Dispensing Report */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daily Dispensing Report</CardTitle>
            <CardDescription>Daily drug dispensing log across all drugs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <DatePickerField label="Date" date={dailyDate} onSelect={(d) => d && setDailyDate(d)} />
              </div>
              <Button variant="secondary" onClick={comingSoon}>
                <FileSpreadsheet className="mr-1 h-4 w-4" />
                Export Excel
              </Button>
            </div>
            <div className="overflow-auto max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Drug</TableHead>
                    <TableHead className="text-xs">Patient</TableHead>
                    <TableHead className="text-xs">IC</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs">Officer</TableHead>
                    <TableHead className="text-xs">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">Loading…</TableCell>
                    </TableRow>
                  ) : dailyDispensing.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">No dispensing for this day yet.</TableCell>
                    </TableRow>
                  ) : (
                    dailyDispensing.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{r.drug}</TableCell>
                        <TableCell className="text-xs">{r.pesakit}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.ic}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">{r.qty}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.pegawai}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.masa}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
