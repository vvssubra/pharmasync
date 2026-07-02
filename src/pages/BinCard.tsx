import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";
import { ArrowLeft, FileDown, PackagePlus, Search, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Drug = {
  id: string;
  drug_name: string;
  no_kod: string;
  unit_pengukuran: string;
  kumpulan: string;
  pergerakan: string;
  gudang_seksyen: string;
  baris: string;
  rak: string;
  tingkat: string;
  petak: string;
  kod_lokasi_penuh: string;
  stok_min: number;
  stok_reorder: number;
  stok_max: number;
};

// Raw transaction row fetched from Supabase for this drug.
type Tx = {
  id: string;
  tarikh: string;
  jenis: "baki_awal" | "terimaan" | "keluaran";
  kuantiti: number;
  created_at: string;
  nama_pegawai: string | null;
  no_rujukan: string | null;
  terima_daripada: string | null;
  nama_pesakit: string | null;
  no_ic: string | null;
  harga_seunit: number | null;
  jumlah_rm: number | null;
};

// Computed bin-card display row with running balance.
type BinRow = {
  id: string;
  tarikh: string;
  jenis: "baki_awal" | "terimaan" | "keluaran";
  no_rujukan: string;
  nama: string;
  subtext: string;
  terimaan_qty: number | null;
  terimaan_seunit: number | null;
  terimaan_jumlah: number | null;
  keluaran_qty: number | null;
  keluaran_jumlah: number | null;
  baki_qty: number;
  baki_jumlah: number;
  nama_pegawai: string;
};

const PAGE_SIZE = 50;

export default function BinCard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [jenisFilter, setJenisFilter] = useState("semua");
  const [searchQ, setSearchQ] = useState("");
  const [page, setPage] = useState(1);

  const { data: drug, isLoading } = useQuery({
    queryKey: ["drug", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("drugs").select("*").eq("id", id!).single();
      if (error) throw error;
      return data as Drug;
    },
    enabled: !!id,
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ["bincard-transactions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "id, tarikh, jenis, kuantiti, created_at, nama_pegawai, no_rujukan, terima_daripada, nama_pesakit, no_ic, harga_seunit, jumlah_rm"
        )
        .eq("drug_id", id!)
        .order("tarikh", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Tx[];
    },
    enabled: !!id,
  });

  // Compute the running balance across ALL transactions in chronological order,
  // then filtering/pagination operates over the precomputed rows.
  const allRows = useMemo<BinRow[]>(() => {
    if (!transactions) return [];
    let baki = 0;
    let lastPrice = 0;
    return transactions.map((t) => {
      const isBaki = t.jenis === "baki_awal";
      const isTerimaan = t.jenis === "terimaan";
      const isKeluaran = t.jenis === "keluaran";

      if (isTerimaan || isBaki) baki += t.kuantiti;
      else if (isKeluaran) baki -= t.kuantiti;
      if (t.harga_seunit != null) lastPrice = t.harga_seunit;

      const nama = isBaki
        ? "BALANCE BROUGHT FORWARD"
        : isTerimaan
        ? t.terima_daripada || "—"
        : t.nama_pesakit || "—";
      const subtext = isKeluaran ? t.no_ic || "" : "";

      return {
        id: t.id,
        tarikh: t.tarikh,
        jenis: t.jenis,
        no_rujukan: t.no_rujukan || "",
        nama,
        subtext,
        terimaan_qty: isTerimaan ? t.kuantiti : null,
        terimaan_seunit: isTerimaan ? t.harga_seunit : null,
        terimaan_jumlah: isTerimaan ? t.jumlah_rm : null,
        keluaran_qty: isKeluaran ? t.kuantiti : null,
        keluaran_jumlah: isKeluaran ? t.jumlah_rm : null,
        baki_qty: baki,
        baki_jumlah: baki * lastPrice,
        nama_pegawai: t.nama_pegawai || "",
      };
    });
  }, [transactions]);

  const filtered = useMemo(() => {
    let rows = [...allRows];
    if (dateFrom) rows = rows.filter((r) => r.tarikh >= format(dateFrom, "yyyy-MM-dd"));
    if (dateTo) rows = rows.filter((r) => r.tarikh <= format(dateTo, "yyyy-MM-dd"));
    if (jenisFilter !== "semua") rows = rows.filter((r) => r.jenis === jenisFilter || r.jenis === "baki_awal");
    if (searchQ) {
      const q = searchQ.toLowerCase();
      rows = rows.filter((r) => r.nama.toLowerCase().includes(q) || r.no_rujukan.toLowerCase().includes(q) || r.subtext.toLowerCase().includes(q));
    }
    return rows;
  }, [allRows, dateFrom, dateTo, jenisFilter, searchQ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const sumTerimaan = filtered.filter((r) => r.jenis === "terimaan").reduce((s, r) => s + (r.terimaan_qty ?? 0), 0);
  const sumKeluaran = filtered.filter((r) => r.jenis === "keluaran").reduce((s, r) => s + (r.keluaran_qty ?? 0), 0);
  const finalBaki = filtered.length > 0 ? filtered[filtered.length - 1].baki_qty : 0;

  const resetFilters = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
    setJenisFilter("semua");
    setSearchQ("");
    setPage(1);
  };

  const currentBaki = allRows.length > 0 ? allRows[allRows.length - 1].baki_qty : 0;

  const getBakiStatus = () => {
    if (!drug) return { label: "—", color: "bg-muted text-muted-foreground" };
    if (currentBaki < (drug.stok_min ?? 0)) return { label: "CRITICAL", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" };
    if (currentBaki <= (drug.stok_reorder ?? 0)) return { label: "LOW", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" };
    if (currentBaki > (drug.stok_max ?? Infinity)) return { label: "EXCESS", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" };
    return { label: "NORMAL", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" };
  };

  const status = getBakiStatus();

  if (isLoading || txLoading) {
    return <div className="flex items-center justify-center py-24 text-muted-foreground">Loading...</div>;
  }

  if (!drug) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/drugs")}><ArrowLeft className="mr-1 h-4 w-4" /> Drug List</Button>
        <p className="text-muted-foreground">Drug not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/drugs")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Drug List
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => toast.info("Coming soon")}>
            <FileDown className="mr-1 h-4 w-4" /> Generate PDF
          </Button>
          <Button onClick={() => navigate("/terimaan")}>
            <PackagePlus className="mr-1 h-4 w-4" /> Add Receipt
          </Button>
        </div>
      </div>

      {/* BAHAGIAN A */}
      <Card className="overflow-hidden">
        {/* Navy header */}
        <div className="flex items-center justify-between px-6 py-3" style={{ backgroundColor: "#0b3b28" }}>
          <span className="text-sm font-bold tracking-wide text-white">KEW.PS-3 &nbsp;|&nbsp; DAFTAR STOK</span>
          <span className="text-sm text-white/80">Klinik Kesihatan Kempas</span>
        </div>

        <CardContent className="space-y-5 p-6">
          {/* Drug info grid */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <div className="col-span-2 md:col-span-2">
              <p className="text-xs text-muted-foreground">Stock Description</p>
              <p className="mt-1 rounded bg-emerald-50 px-3 py-2 text-lg font-bold text-foreground dark:bg-emerald-900/20">{drug.drug_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Code No.</p>
              <p className="mt-1 font-medium">{drug.no_kod || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Unit of Measure</p>
              <p className="mt-1 font-medium capitalize">{drug.unit_pengukuran}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Group</p>
              <p className="mt-1 font-medium">{drug.kumpulan || "—"}</p>
            </div>
          </div>

          {/* Lokasi */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock Storage Location</p>
            <div className="overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Warehouse / Section</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Row</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Shelf</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Level</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Compartment</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Full Location Code</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-3 py-2">{drug.gudang_seksyen || "—"}</td>
                    <td className="px-3 py-2">{drug.baris || "—"}</td>
                    <td className="px-3 py-2">{drug.rak || "—"}</td>
                    <td className="px-3 py-2">{drug.tingkat || "—"}</td>
                    <td className="px-3 py-2">{drug.petak || "—"}</td>
                    <td className="px-3 py-2 font-mono">{drug.kod_lokasi_penuh || "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Paras Stok */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock Levels</p>
            <div className="overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Year</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Maximum (Quantity)</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Reorder (Quantity)</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Minimum (Quantity)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-3 py-2">{new Date().getFullYear()}</td>
                    <td className="px-3 py-2 tabular-nums">{drug.stok_max ?? 0}</td>
                    <td className="px-3 py-2 tabular-nums">{drug.stok_reorder ?? 0}</td>
                    <td className="px-3 py-2 tabular-nums">{drug.stok_min ?? 0}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Current Balance strip */}
          <div className={cn("flex items-center gap-3 rounded-lg px-4 py-3", status.color)}>
            <span className="text-sm font-semibold">Current Balance: {currentBaki} {drug.unit_pengukuran}</span>
            <Badge variant="outline" className={cn("border-current text-xs font-bold", status.color)}>
              {status.label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* FILTER BAR */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">From</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[150px] justify-start text-left text-sm", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="mr-1 h-3.5 w-3.5" />
                {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "Select date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">To</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[150px] justify-start text-left text-sm", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="mr-1 h-3.5 w-3.5" />
                {dateTo ? format(dateTo, "dd/MM/yyyy") : "Select date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={setDateTo} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Type</label>
          <Select value={jenisFilter} onValueChange={(v) => { setJenisFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">All</SelectItem>
              <SelectItem value="terimaan">Receipt</SelectItem>
              <SelectItem value="keluaran">Dispensed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="relative">
          <label className="mb-1 block text-xs text-muted-foreground">Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search patient name or ref. no..."
              value={searchQ}
              onChange={(e) => { setSearchQ(e.target.value); setPage(1); }}
              className="w-[280px] pl-8 text-sm"
            />
          </div>
        </div>
        <Button variant="link" className="text-sm" onClick={resetFilters}>Reset</Button>
      </div>

      {/* BAHAGIAN B */}
      <Card>
        <div className="px-6 py-3 border-b">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Section B — Stock Transactions</h2>
        </div>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th rowSpan={2} className="px-3 py-2 text-left font-medium text-muted-foreground align-bottom border-r">Date</th>
                  <th rowSpan={2} className="px-3 py-2 text-left font-medium text-muted-foreground align-bottom border-r">Ref. No.</th>
                  <th rowSpan={2} className="px-3 py-2 text-left font-medium text-muted-foreground align-bottom border-r min-w-[180px]">Patient Name / Received From</th>
                  <th colSpan={3} className="px-3 py-1 text-center font-semibold text-muted-foreground border-b border-r">RECEIPTS</th>
                  <th colSpan={2} className="px-3 py-1 text-center font-semibold text-muted-foreground border-b border-r">DISPENSED</th>
                  <th colSpan={2} className="px-3 py-1 text-center font-semibold text-muted-foreground border-b border-r">BALANCE</th>
                  <th rowSpan={2} className="px-3 py-2 text-left font-medium text-muted-foreground align-bottom">Officer Name</th>
                </tr>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-1 text-right text-xs font-medium text-muted-foreground border-r">Quantity</th>
                  <th className="px-3 py-1 text-right text-xs font-medium text-muted-foreground border-r">Unit Price (RM)</th>
                  <th className="px-3 py-1 text-right text-xs font-medium text-muted-foreground border-r">Total (RM)</th>
                  <th className="px-3 py-1 text-right text-xs font-medium text-muted-foreground border-r">Quantity</th>
                  <th className="px-3 py-1 text-right text-xs font-medium text-muted-foreground border-r">Total (RM)</th>
                  <th className="px-3 py-1 text-right text-xs font-medium text-muted-foreground border-r">Quantity</th>
                  <th className="px-3 py-1 text-right text-xs font-medium text-muted-foreground border-r">Total (RM)</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      {allRows.length === 0
                        ? "No transactions recorded for this drug yet."
                        : "No transactions match the current filters."}
                    </td>
                  </tr>
                )}
                {paged.map((row) => {
                  const isBaki = row.jenis === "baki_awal";
                  const isTerimaan = row.jenis === "terimaan";
                  const isKeluaran = row.jenis === "keluaran";

                  const rowBg = isBaki
                    ? "bg-purple-50 dark:bg-purple-900/10"
                    : isTerimaan
                    ? "bg-red-50 dark:bg-red-900/10"
                    : "bg-green-50 dark:bg-green-900/10";

                  const borderColor = isBaki
                    ? "border-l-4 border-l-purple-600"
                    : isTerimaan
                    ? "border-l-4 border-l-red-600"
                    : "border-l-4 border-l-green-600";

                  return (
                    <tr key={row.id} className={cn("border-b", rowBg, borderColor)}>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap border-r">{format(new Date(row.tarikh), "dd/MM/yyyy")}</td>
                      <td className="px-3 py-2 text-xs border-r">{row.no_rujukan || "—"}</td>
                      <td className="px-3 py-2 border-r">
                        {isBaki ? (
                          <span className="italic text-muted-foreground">{row.nama}</span>
                        ) : (
                          <div>
                            <p className="font-medium">{row.nama}</p>
                            {row.subtext && <p className="text-xs text-muted-foreground">{row.subtext}</p>}
                          </div>
                        )}
                      </td>
                      {/* Terimaan */}
                      <td className={cn("px-3 py-2 text-right tabular-nums border-r", isTerimaan && "font-bold text-red-600 dark:text-red-400")}>
                        {row.terimaan_qty != null ? row.terimaan_qty : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums border-r">
                        {row.terimaan_seunit != null ? row.terimaan_seunit.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums border-r">
                        {row.terimaan_jumlah != null ? row.terimaan_jumlah.toFixed(2) : "—"}
                      </td>
                      {/* Keluaran */}
                      <td className={cn("px-3 py-2 text-right tabular-nums border-r", isKeluaran && "font-bold text-green-600 dark:text-green-400")}>
                        {row.keluaran_qty != null ? row.keluaran_qty : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums border-r">
                        {row.keluaran_jumlah != null ? row.keluaran_jumlah.toFixed(2) : "—"}
                      </td>
                      {/* Baki */}
                      <td className="px-3 py-2 text-right tabular-nums font-medium border-r">{row.baki_qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium border-r">{row.baki_jumlah.toFixed(2)}</td>
                      <td className="px-3 py-2 text-xs">{row.nama_pegawai || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/70 font-bold border-t-2">
                  <td colSpan={3} className="px-3 py-2 border-r">TOTAL</td>
                  <td className="px-3 py-2 text-right tabular-nums border-r">{sumTerimaan}</td>
                  <td className="px-3 py-2 border-r">—</td>
                  <td className="px-3 py-2 border-r">—</td>
                  <td className="px-3 py-2 text-right tabular-nums border-r">{sumKeluaran}</td>
                  <td className="px-3 py-2 border-r">—</td>
                  <td className="px-3 py-2 text-right tabular-nums border-r">{finalBaki}</td>
                  <td className="px-3 py-2 border-r">—</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages} ({filtered.length} records)
              </p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
