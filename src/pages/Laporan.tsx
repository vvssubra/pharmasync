import { useState } from "react";
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

// Mock quarterly data
const mockQuarterlyData = [
  { drug: "Paracetamol 500mg", terimaan: 5000, keluaran: 4200, baki: 800 },
  { drug: "Amoxicillin 250mg", terimaan: 3000, keluaran: 2800, baki: 200 },
  { drug: "Metformin 500mg", terimaan: 4000, keluaran: 3500, baki: 500 },
  { drug: "Amlodipine 5mg", terimaan: 2000, keluaran: 1800, baki: 200 },
  { drug: "Omeprazole 20mg", terimaan: 2500, keluaran: 2100, baki: 400 },
  { drug: "Atorvastatin 20mg", terimaan: 1500, keluaran: 1300, baki: 200 },
];

// Mock movement data
const mockMovementData = [
  { drug: "Paracetamol 500mg", totalQty: 4200, totalRM: 840.00, count: 42, avg: 100, lastDate: "2026-03-10" },
  { drug: "Amoxicillin 250mg", totalQty: 2800, totalRM: 1680.00, count: 28, avg: 100, lastDate: "2026-03-09" },
  { drug: "Metformin 500mg", totalQty: 3500, totalRM: 525.00, count: 35, avg: 100, lastDate: "2026-03-11" },
  { drug: "Amlodipine 5mg", totalQty: 1800, totalRM: 720.00, count: 18, avg: 100, lastDate: "2026-03-08" },
  { drug: "Omeprazole 20mg", totalQty: 2100, totalRM: 1050.00, count: 21, avg: 100, lastDate: "2026-03-07" },
];

// Mock daily dispensing data
const mockDailyDispensing = [
  { drug: "Empagliflozin 25mg", pesakit: "AHMAD BIN HASSAN", ic: "720315-01-5533", qty: 30, pegawai: "Pn. Siti", masa: "10:30" },
  { drug: "Metformin 500mg", pesakit: "MARY LOO AH KENG", ic: "650822-01-6744", qty: 60, pegawai: "En. Ahmad", masa: "10:15" },
  { drug: "Amlodipine 5mg", pesakit: "MUTHU A/L RAJU", ic: "580114-01-4421", qty: 30, pegawai: "Dr. Lee", masa: "09:55" },
  { drug: "Losartan 50mg", pesakit: "NOR AZIZAH BINTI YUSOF", ic: "810607-01-5566", qty: 30, pegawai: "Pn. Siti", masa: "09:40" },
  { drug: "Omeprazole 20mg", pesakit: "TAN AH BENG", ic: "700430-01-3322", qty: 14, pegawai: "En. Ahmad", masa: "09:20" },
  { drug: "Paracetamol 500mg", pesakit: "SITI NURHALIZA BINTI AHMAD", ic: "890215-01-7788", qty: 20, pegawai: "Pn. Siti", masa: "09:00" },
  { drug: "Atorvastatin 20mg", pesakit: "LEE CHONG WEI", ic: "821021-01-5511", qty: 30, pegawai: "Dr. Lee", masa: "08:45" },
  { drug: "Aspirin 100mg", pesakit: "RAJESH A/L KUMAR", ic: "750903-01-4455", qty: 30, pegawai: "En. Ahmad", masa: "08:30" },
];

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
  const [year, setYear] = useState("2026");
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

  const selectedDrugName = drugs.find((d) => d.id === selectedDrug)?.drug_name;

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
            <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
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
                {mockQuarterlyData.map((r) => (
                  <TableRow key={r.drug}>
                    <TableCell className="text-xs font-medium">{r.drug}</TableCell>
                    <TableCell className="text-xs text-right">{r.terimaan.toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-right">{r.keluaran.toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-right font-semibold">{r.baki.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
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
            <div className="grid grid-cols-2 gap-3">
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
                    {mockMovementData.map((r) => (
                      <TableRow key={r.drug}>
                        <TableCell className="text-xs font-medium">{r.drug}</TableCell>
                        <TableCell className="text-xs text-right">{r.totalQty.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right">{r.totalRM.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right">{r.count}</TableCell>
                        <TableCell className="text-xs text-right">{r.avg}</TableCell>
                        <TableCell className="text-xs">{r.lastDate}</TableCell>
                      </TableRow>
                    ))}
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
                  {mockDailyDispensing.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{r.drug}</TableCell>
                      <TableCell className="text-xs">{r.pesakit}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.ic}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{r.qty}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.pegawai}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.masa}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
