
import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, isWithinInterval, parseISO } from "date-fns";
import {
  ArrowLeft, CalendarIcon, Search, Download, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { computeStock } from "@/lib/stock";

type LedgerRow = {
  id: string;
  tarikh: string;
  noRujukan: string;
  pihak: string;
  jenis: "terimaan" | "keluaran" | "baki_awal";
  kuantiti: number;
  seunit?: number;
  jumlahRM?: number;
  namaPegawai: string;
  sumber: string;
};

function getBakiLevel(qty: number, min: number, max: number) {
  if (qty <= 0 || qty < min * 0.5) return { label: "CRITICAL", className: "bg-destructive text-destructive-foreground" };
  if (qty < min) return { label: "LOW", className: "bg-orange-500 text-white" };
  if (qty > max) return { label: "EXCESS", className: "bg-blue-500 text-white" };
  return { label: "NORMAL", className: "bg-green-600 text-white" };
}

function sumberBadge(sumber: string) {
  switch (sumber) {
    case "Opening Balance":
      return <Badge className="bg-purple-600 text-white border-transparent text-[10px]">{sumber}</Badge>;
    case "Manual":
      return <Badge className="bg-blue-500 text-white border-transparent text-[10px]">{sumber}</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px]">{sumber}</Badge>;
  }
}

export default function DrugLedger() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [typeFilter, setTypeFilter] = useState("semua");
  const [search, setSearch] = useState("");

  const { data: drug, isLoading: drugLoading } = useQuery({
    queryKey: ["drug", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drugs")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch this drug's transactions, ordered ascending for running-balance calc
  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ["drug-ledger-transactions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("drug_id", id!)
        .order("tarikh", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const isLoading = drugLoading || txLoading;

  // Normalize live transactions into ledger rows with running balance attached.
  // Balance is computed over ALL rows (ledger order), before any filtering.
  const allRowsWithBaki = useMemo(() => {
    const rows = transactions ?? [];
    let runQty = 0;
    let runRM = 0;
    return rows.map((tx) => {
      const t = tx as any;
      const jenis = t.jenis as "terimaan" | "keluaran" | "baki_awal";
      const kuantiti = Number(t.kuantiti) || 0;
      const jumlahRM = t.jumlah_rm != null ? Number(t.jumlah_rm) : undefined;
      const seunit = t.harga_seunit != null ? Number(t.harga_seunit) : undefined;

      if (jenis === "baki_awal" || jenis === "terimaan") {
        runQty += kuantiti;
        runRM += jumlahRM ?? 0;
      } else {
        runQty -= kuantiti;
        runRM -= jumlahRM ?? 0;
      }

      const pihak =
        jenis === "keluaran"
          ? t.nama_pesakit || t.terima_daripada || "-"
          : t.terima_daripada || "-";
      const sumber =
        t.sumber || (jenis === "baki_awal" ? "Opening Balance" : "Manual");

      const row: LedgerRow & { bakiQty: number; bakiRM: number } = {
        id: t.id,
        tarikh: t.tarikh,
        noRujukan: t.no_rujukan || "-",
        pihak,
        jenis,
        kuantiti,
        seunit,
        jumlahRM,
        namaPegawai: t.nama_pegawai || "-",
        sumber,
        bakiQty: runQty,
        bakiRM: Math.max(0, runRM),
      };
      return row;
    });
  }, [transactions]);

  // Apply filters/search over the real rows (balance already attached)
  const rowsWithBaki = useMemo(() => {
    let rows = allRowsWithBaki;
    if (typeFilter === "terimaan") rows = rows.filter((r) => r.jenis === "terimaan");
    else if (typeFilter === "keluaran") rows = rows.filter((r) => r.jenis === "keluaran");

    if (startDate || endDate) {
      rows = rows.filter((r) => {
        const d = parseISO(r.tarikh);
        if (startDate && endDate) return isWithinInterval(d, { start: startDate, end: endDate });
        if (startDate) return d >= startDate;
        if (endDate) return d <= endDate;
        return true;
      });
    }

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.noRujukan.toLowerCase().includes(q) ||
          r.namaPegawai.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [allRowsWithBaki, typeFilter, startDate, endDate, search]);

  // Uses the same SET-semantics helper as every other page's "current balance"
  // figure (not allRowsWithBaki's ADD-folded running trail above, which is a
  // deliberately different per-row ledger narrative) so this page's headline
  // number can never silently disagree with Index/FMS/MO/Terimaan.
  const currentBaki = useMemo(() => {
    if (!id) return 0;
    return computeStock(id, transactions ?? []);
  }, [transactions, id]);

  const hasAnyRows = allRowsWithBaki.length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!drug) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/drugs")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <p className="text-muted-foreground">Drug not found.</p>
      </div>
    );
  }

  const level = getBakiLevel(currentBaki, drug.stok_min ?? 0, drug.stok_max ?? 9999);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" className="mb-2" onClick={() => navigate("/drugs")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Drug Master
        </Button>
        <h1 className="text-2xl font-bold text-foreground">{drug.drug_name}</h1>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>Code No.: <strong className="text-foreground">{drug.no_kod || "-"}</strong></span>
          <span>Unit: <strong className="text-foreground capitalize">{drug.unit_pengukuran}</strong></span>
          <span>Group: <strong className="text-foreground">{drug.kumpulan || "-"}</strong></span>
          <span>Stock Levels: <strong className="text-foreground">{drug.stok_min}/{drug.stok_reorder}/{drug.stok_max}</strong></span>
        </div>
      </div>

      {/* Baki Card */}
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <div>
            <p className="text-sm text-muted-foreground">Current Balance</p>
            <p className="text-3xl font-bold tabular-nums text-foreground">
              {currentBaki} <span className="text-base font-normal text-muted-foreground">{drug.unit_pengukuran}</span>
            </p>
          </div>
          <Badge className={cn("text-xs px-3 py-1", level.className)}>{level.label}</Badge>
        </CardContent>
      </Card>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">From</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full sm:w-[150px] justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-1 h-4 w-4" />
                {startDate ? format(startDate, "dd/MM/yyyy") : "Start"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={startDate} onSelect={setStartDate} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">To</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full sm:w-[150px] justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-1 h-4 w-4" />
                {endDate ? format(endDate, "dd/MM/yyyy") : "End"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={endDate} onSelect={setEndDate} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Type</label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">All</SelectItem>
              <SelectItem value="terimaan">Receipt</SelectItem>
              <SelectItem value="keluaran">Dispensed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="relative">
          <label className="text-xs text-muted-foreground mb-1 block">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="No. rujukan / pegawai"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-full sm:w-[200px]"
            />
          </div>
        </div>
        <div className="ml-auto">
          <label className="text-xs text-muted-foreground mb-1 block invisible">_</label>
          <Button variant="outline">
            <Download className="mr-1 h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      {/* Ledger Table */}
      <Card>
        <CardContent className="p-0">
          {/* KEW.PS-3 is a statutory form: 16 columns in a prescribed order that
              a pharmacist cross-checks against the paper card, so this scrolls
              horizontally rather than reflowing into cards. Pinning the Date
              column keeps the row anchored while scrolling. */}
          <Table className="[&_tbody_td:first-child]:sticky [&_tbody_td:first-child]:left-0 [&_tbody_td:first-child]:z-10 [&_tbody_td:first-child]:bg-background [&_thead_th:first-child]:sticky [&_thead_th:first-child]:left-0 [&_thead_th:first-child]:z-20 [&_thead_th:first-child]:bg-background">
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2} className="align-bottom border-r">Date</TableHead>
                <TableHead rowSpan={2} className="align-bottom border-r">Ref. No.</TableHead>
                <TableHead rowSpan={2} className="align-bottom border-r">Received / Dispensed To</TableHead>
                <TableHead colSpan={3} className="text-center border-b border-r">Receipts</TableHead>
                <TableHead colSpan={2} className="text-center border-b border-r">Dispensed</TableHead>
                <TableHead colSpan={2} className="text-center border-b border-r">Balance</TableHead>
                <TableHead rowSpan={2} className="align-bottom border-r">Officer</TableHead>
                <TableHead rowSpan={2} className="align-bottom">Source</TableHead>
              </TableRow>
              <TableRow>
                <TableHead className="text-center text-xs border-r">Quantity</TableHead>
                <TableHead className="text-center text-xs border-r">Unit Price (RM)</TableHead>
                <TableHead className="text-center text-xs border-r">Total (RM)</TableHead>
                <TableHead className="text-center text-xs border-r">Quantity</TableHead>
                <TableHead className="text-center text-xs border-r">Total (RM)</TableHead>
                <TableHead className="text-center text-xs border-r">Quantity</TableHead>
                <TableHead className="text-center text-xs">Total (RM)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rowsWithBaki.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12}>
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      <FileText className="mb-2 h-8 w-8" />
                      <p className="text-sm font-medium">
                        {hasAnyRows ? "No transactions match your filters" : "No ledger entries yet."}
                      </p>
                      {!hasAnyRows && (
                        <Button variant="link" size="sm" className="mt-1" onClick={() => navigate("/drugs")}>
                          Start by setting an opening balance
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rowsWithBaki.map((row, idx) => {
                  const isTerimaan = row.jenis === "terimaan";
                  const isBakiAwal = row.jenis === "baki_awal";
                  const isKeluaran = row.jenis === "keluaran";
                  const bakiBelowMin = row.bakiQty < (drug.stok_min ?? 0);

                  return (
                    <TableRow
                      key={row.id}
                      className={cn(
                        idx % 2 === 1 && "bg-muted/30",
                        isBakiAwal && "bg-purple-50 dark:bg-purple-950/20",
                        isTerimaan && "border-l-4 border-l-green-500"
                      )}
                    >
                      <TableCell className="text-xs tabular-nums border-r">{format(parseISO(row.tarikh), "dd/MM/yyyy")}</TableCell>
                      <TableCell className="text-xs border-r">{row.noRujukan}</TableCell>
                      <TableCell className="text-xs border-r">{row.pihak}</TableCell>
                      {/* Terimaan cols */}
                      <TableCell className="text-center text-xs tabular-nums border-r">
                        {(isTerimaan || isBakiAwal) ? row.kuantiti : ""}
                      </TableCell>
                      <TableCell className="text-center text-xs tabular-nums border-r">
                        {(isTerimaan || isBakiAwal) && row.seunit ? row.seunit.toFixed(2) : ""}
                      </TableCell>
                      <TableCell className="text-center text-xs tabular-nums border-r">
                        {(isTerimaan || isBakiAwal) && row.jumlahRM ? row.jumlahRM.toFixed(2) : ""}
                      </TableCell>
                      {/* Keluaran cols */}
                      <TableCell className="text-center text-xs tabular-nums border-r">
                        {isKeluaran ? row.kuantiti : ""}
                      </TableCell>
                      <TableCell className="text-center text-xs tabular-nums border-r">
                        {isKeluaran && row.jumlahRM ? row.jumlahRM.toFixed(2) : ""}
                      </TableCell>
                      {/* Baki cols */}
                      <TableCell className={cn("text-center text-xs tabular-nums font-semibold border-r", bakiBelowMin && "text-destructive")}>
                        {row.bakiQty}
                      </TableCell>
                      <TableCell className="text-center text-xs tabular-nums border-r">
                        {row.bakiRM.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs border-r">{row.namaPegawai}</TableCell>
                      <TableCell>{sumberBadge(row.sumber)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination info */}
      {rowsWithBaki.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing 1-{rowsWithBaki.length} of {rowsWithBaki.length} transactions
        </p>
      )}
    </div>
  );
}
