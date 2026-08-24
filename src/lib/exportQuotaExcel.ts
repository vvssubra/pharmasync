// Builds and downloads a controlled-drug quota summary workbook shaped like
// the district's existing "SENARAI UBAT KAWALAN KHUSUS" tracking sheet (BIL /
// ITEM / SKU / HARGA SEUNIT / JUMLAH HARGA / KUOTA / JUMLAH KUOTA PESAKIT /
// JUMLAH PESAKIT AKTIF / %KUOTA YANG TELAH DIGUNAKAN). Source data is always
// this app's own national quota pool (get_drug_quota_usage) — never raw
// patient records.
//
// exceljs is dynamically imported: it's a large library only ever needed
// when someone clicks "Export to Excel", so it ships as its own chunk
// instead of bloating the app's main bundle and PWA precache manifest (see
// vite.config.ts's injectManifest.globIgnores for that chunk).
import { formatKuotaLabel } from "@/lib/quotaHelpers";

export type QuotaExcelRow = {
  drug_name: string;
  unit_pengukuran: string;
  unit_price: number | null;
  quota_per_fms: number | null;
  fms_count: number | null;
  quota_limit: number;
  used: number;
};

const HEADER_ROW = [
  "BIL", "ITEM", "SKU", "HARGA SEUNIT (RM)", "JUMLAH HARGA (usage)", "KUOTA",
  "JUMLAH KUOTA PESAKIT", "JUMLAH PESAKIT AKTIF (usage)", "%KUOTA YANG TELAH DIGUNAKAN",
];

export async function exportQuotaExcel(rows: QuotaExcelRow[], year: number) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Quota Summary");

  sheet.addRow([`SENARAI UBAT KAWALAN KHUSUS — National Quota Pool (${year})`]);
  sheet.mergeCells(1, 1, 1, HEADER_ROW.length);
  sheet.getRow(1).font = { bold: true, size: 12 };

  sheet.addRow([]);

  const headerRow = sheet.addRow(HEADER_ROW);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5A623" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  rows.forEach((row, i) => {
    const pct = row.quota_limit > 0 ? (row.used / row.quota_limit) * 100 : 0;
    const totalHarga = row.unit_price != null ? row.unit_price * row.used : null;
    sheet.addRow([
      i + 1,
      row.drug_name,
      row.unit_pengukuran,
      row.unit_price ?? "—",
      totalHarga ?? "—",
      formatKuotaLabel(row.quota_per_fms, row.fms_count),
      row.quota_limit,
      row.used,
      row.quota_limit > 0 ? Number(pct.toFixed(2)) : "—",
    ]);
  });

  sheet.columns = [
    { width: 6 }, { width: 45 }, { width: 16 }, { width: 14 }, { width: 16 },
    { width: 18 }, { width: 14 }, { width: 16 }, { width: 16 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `quota-summary-${year}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
