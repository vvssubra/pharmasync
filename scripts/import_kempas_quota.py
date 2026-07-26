#!/usr/bin/env python3
"""Generate the KK Kempas 2026 controlled-drug quota seed migration.

Reads "UBAT KAWALAN KHUSUS FMS PKDJB 2026.xlsx" (the district's master quota
register — one sheet per drug, split into per-clinic blocks) and emits
supabase/migrations/20260727000100_seed_kk_kempas_2026_quota_patients.sql:
INSERTs for the drug master rows, the 2026 drug_quotas, the patient_registry
rows, and the drug_quota_patients enrolment rows for Klinik Kesihatan Kempas.

Uses only the standard library (no openpyxl) — reads the sheet XML directly
out of the .xlsx zip, the same way the source data was originally explored.

Usage:
    python3 scripts/import_kempas_quota.py "/path/to/UBAT KAWALAN KHUSUS FMS PKDJB 2026.xlsx"

Scope for this run: Novomix + Levemir only, KK Kempas only, year 2026.
MDI Foster and the other 24 drugs / 14 clinics follow the same shape later —
SHEETS below is the thing to extend.
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from datetime import date, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "supabase/migrations/20260727000100_seed_kk_kempas_2026_quota_patients.sql"
KEMPAS_CLINIC_ID = "00000000-0000-0000-0000-000000000001"
YEAR = 2026

# One entry per drug in scope. Kempas block row range is 1-indexed, inclusive,
# spanning from the "KK: KEMPAS" header row through the "KUOTA DIGUNAKAN:" row
# (both are skipped automatically — see extract_block).
SHEETS = [
    {
        "sheet_name": "4. Insulin Novomix",
        "drug_name": "Insulin Aspart 30% & Protaminated Insulin Aspart 70% 100iu/ml Injection (NOVOMIX)",
        "unit_pengukuran": "vial",
        "kempas_row_range": (489, 591),  # KK: KEMPAS ... KUOTA DIGUNAKAN: 71
        "expected_total_kuota": 100,
        "expected_kuota_digunakan": 71,
    },
    {
        "sheet_name": "5. Insulin Levemir",
        "drug_name": "Insulin Detemir 100iu/ml Injection (LEVEMIR)",
        "unit_pengukuran": "vial",
        "kempas_row_range": (233, 276),  # KK: KEMPAS ... KUOTA DIGUNAKAN: 35
        "expected_total_kuota": 40,
        "expected_kuota_digunakan": 35,
    },
]


# ── XLSX reading (stdlib only) ───────────────────────────────────────────────

def col_num(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


class Workbook:
    def __init__(self, path: Path):
        self.zf = zipfile.ZipFile(path)
        wb = ET.fromstring(self.zf.read("xl/workbook.xml"))
        rels = {
            r.get("Id"): r.get("Target")
            for r in ET.fromstring(self.zf.read("xl/_rels/workbook.xml.rels"))
        }
        self.sheet_targets = {}
        for s in wb.iter(NS + "sheet"):
            rid = s.get(REL_NS + "id")
            target = rels[rid]
            self.sheet_targets[s.get("name")] = target if target.startswith("xl/") else "xl/" + target

        self.shared_strings = []
        try:
            sst = ET.fromstring(self.zf.read("xl/sharedStrings.xml"))
            for si in sst.iter(NS + "si"):
                self.shared_strings.append("".join(t.text or "" for t in si.iter(NS + "t")))
        except KeyError:
            pass

    def rows(self, sheet_name: str):
        """Returns {row_number: {col_number: cell_value}} for one sheet."""
        sheet_xml = ET.fromstring(self.zf.read(self.sheet_targets[sheet_name]))
        rows = {}
        for row in sheet_xml.iter(NS + "row"):
            r = int(row.get("r"))
            cells = {}
            for c in row.iter(NS + "c"):
                t = c.get("t")
                v = c.find(NS + "v")
                inline = c.find(NS + "is")
                value = None
                if t == "s" and v is not None:
                    value = self.shared_strings[int(v.text)]
                elif t == "inlineStr" and inline is not None:
                    value = "".join(x.text or "" for x in inline.iter(NS + "t"))
                elif v is not None:
                    value = v.text
                if value not in (None, ""):
                    cells[col_num(c.get("r"))] = value
            if cells:
                rows[r] = cells
        return rows


# ── Normalization ────────────────────────────────────────────────────────────

def clean_text(raw) -> str:
    return re.sub(r"\s+", " ", str(raw)).strip()


def sql_str(value) -> str:
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def normalize_name(raw) -> str:
    return clean_text(raw).upper()


_NUMERIC_CELL = re.compile(r"[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?")


def _ic_digits_from_cell(raw) -> str:
    """Excel serializes a 12-digit number cell (whether genuinely numeric or
    an IC typed as a number) as a float — often in scientific notation, e.g.
    '9.30618016233E11'. Stripping non-digits from that string naively keeps
    the exponent's digits too ('...1211'), corrupting the IC. Round-trip
    through float() first so the true integer value is recovered; only fall
    back to a plain digit-strip for cells that aren't purely numeric (already
    dash-formatted text, or genuinely non-numeric junk)."""
    s = str(raw).strip()
    if _NUMERIC_CELL.fullmatch(s):
        try:
            return str(int(float(s)))
        except (ValueError, OverflowError):
            pass
    return re.sub(r"\D", "", s)


def normalize_ic(raw, warnings: list, context: str) -> tuple[str, str | None]:
    """Returns (digits_only_ic, catatan_note_or_None)."""
    digits = _ic_digits_from_cell(raw)
    if len(digits) == 12:
        return digits, None
    if len(digits) == 11:
        padded = "0" + digits
        yy, mm, dd = int(padded[0:2]), int(padded[2:4]), int(padded[4:6])
        if 1 <= mm <= 12 and 1 <= dd <= 31:
            return padded, f"IC DIBETULKAN DARI {digits}"
        warnings.append(f"{context}: 11-digit IC {digits!r} does not left-pad to a valid YYMMDD, kept as padded anyway")
        return padded, f"IC DIBETULKAN DARI {digits}"
    # Any other length (8 digits, etc.) — insert as-is, never synthesize.
    warnings.append(f"{context}: malformed IC {raw!r} ({len(digits)} digits) inserted as-is")
    return digits, "NO IC TIDAK SAH - SILA SAHKAN"


_EXCEL_EPOCH = date(1899, 12, 30)  # Lotus 1-2-3 leap-year bug offset, not 12-31
_DATE_FORMATS = ["%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d.%m.%y", "%d/%m/%y"]


def normalize_date(raw, warnings: list, context: str) -> tuple[str | None, str | None]:
    """Returns (iso_date_or_None, catatan_note_or_None)."""
    if raw is None:
        return None, None
    s = str(raw).strip()
    if not s:
        return None, None

    if re.fullmatch(r"\d+(\.0+)?", s):
        n = int(float(s))
        if 20000 <= n <= 60000:
            d = _EXCEL_EPOCH + timedelta(days=n)
            if date(2000, 1, 1) <= d <= date(2026, 12, 31):
                return d.isoformat(), None

    from datetime import datetime
    for fmt in _DATE_FORMATS:
        try:
            d = datetime.strptime(s, fmt).date()
        except ValueError:
            continue
        if fmt.endswith("%y"):
            # Two-digit year pivot: Malaysian records here run 2018-2026.
            yy = d.year % 100
            d = d.replace(year=2000 + yy if yy <= 30 else 1900 + yy)
        if date(2000, 1, 1) <= d <= date(2026, 12, 31):
            return d.isoformat(), None
        break

    warnings.append(f"{context}: could not parse date {raw!r}, kept as free text in catatan")
    return None, f'TARIKH ASAL: "{s}"'


def normalize_status(raw) -> str:
    s = clean_text(raw).upper() if raw else "AKTIF"
    if s in ("AKTIF", "ACTIVE", ""):
        return "AKTIF"
    if s in ("X AKTIF", "TIDAK AKTIF", "TAK AKTIF"):
        return "TIDAK AKTIF"
    return s


# ── Extraction ────────────────────────────────────────────────────────────────

def extract_block(wb: Workbook, sheet_cfg: dict, warnings: list) -> list[dict]:
    rows = wb.rows(sheet_cfg["sheet_name"])
    start, end = sheet_cfg["kempas_row_range"]
    out = []
    for r in range(start, end + 1):
        row = rows.get(r, {})
        name_raw = row.get(2)
        if not name_raw or not str(name_raw).strip():
            continue  # blank template row (BIL with no patient) or a header/footer row
        if str(row.get(1, "")).strip().upper() in ("BIL", "KK:"):
            continue
        context = f"{sheet_cfg['drug_name']} BIL={row.get(1)}"
        ic, ic_note = normalize_ic(row.get(3, ""), warnings, context)
        tarikh, tarikh_note = normalize_date(row.get(4), warnings, context)
        catatan_parts = [p for p in [clean_text(row.get(8, "")) or None, ic_note, tarikh_note] if p]
        try:
            bil = int(float(str(row.get(1, "0")).strip()))
        except ValueError:
            bil = None
        try:
            kuota = int(float(str(row.get(9, "1")).strip()))
        except ValueError:
            kuota = 1
        out.append({
            "source_bil": bil,
            "patient_name": normalize_name(name_raw),
            "no_ic": ic,
            "tarikh_mula_rawatan": tarikh,
            "status": normalize_status(row.get(5)),
            "dosing": clean_text(row.get(6, "")) or None,
            "fms_name": clean_text(row.get(7, "")) or None,
            "catatan": " | ".join(catatan_parts) if catatan_parts else None,
            "kuota": kuota,
        })
    return out


def merge_duplicates(rows: list[dict], warnings: list, context: str) -> list[dict]:
    """Merge multiple source rows sharing one normalized IC into one enrolment."""
    by_ic: dict[str, list[dict]] = {}
    for row in rows:
        by_ic.setdefault(row["no_ic"], []).append(row)

    merged = []
    for ic, group in by_ic.items():
        if len(group) == 1:
            merged.append(group[0])
            continue
        warnings.append(f"{context}: merging {len(group)} source rows for IC {ic} (BIL {[g['source_bil'] for g in group]})")
        dates = [g["tarikh_mula_rawatan"] for g in group if g["tarikh_mula_rawatan"]]
        catatans = [g["catatan"] for g in group if g["catatan"]]
        bils = [g["source_bil"] for g in group if g["source_bil"] is not None]
        merged.append({
            "source_bil": min(bils) if bils else None,
            "patient_name": group[0]["patient_name"],
            "no_ic": ic,
            "tarikh_mula_rawatan": min(dates) if dates else None,
            "status": "AKTIF" if any(g["status"] == "AKTIF" for g in group) else group[0]["status"],
            "dosing": next((g["dosing"] for g in group if g["dosing"]), None),
            "fms_name": next((g["fms_name"] for g in group if g["fms_name"]), None),
            "catatan": " | ".join(dict.fromkeys(catatans)) + (" | " if catatans else "")
                       + f"DIGABUNG: {len(group)} baris sumber (BIL {','.join(str(b) for b in bils)})",
            "kuota": sum(g["kuota"] for g in group),
        })
    return merged


# ── SQL generation ───────────────────────────────────────────────────────────

def build_sql(drugs_data: list[tuple[dict, list[dict]]]) -> str:
    lines = []
    lines.append(f"-- KK Kempas {YEAR} controlled-drug quota seed.")
    lines.append(f"-- Generated by scripts/import_kempas_quota.py from")
    lines.append(f'-- "UBAT KAWALAN KHUSUS FMS PKDJB 2026.xlsx" — {", ".join(d["sheet_name"] for d, _ in drugs_data)}.')
    lines.append("-- Idempotent: safe to re-run. Aborts (rolls back) if the quota-used totals")
    lines.append("-- computed by drug_quota_used() don't match the source sheet's")
    lines.append("-- \"KUOTA DIGUNAKAN\" figures — see the self-check at the end of this file.")
    lines.append("--")
    lines.append("-- Must run AFTER 20260727000000_drug_quota_patients.sql (needs")
    lines.append("-- drug_quota_patients, the widened drug_quotas/patient_registry unique")
    lines.append("-- constraints, and drug_quota_used()).")
    lines.append("begin;")
    lines.append("")

    # 1. Drugs
    lines.append("-- 1. Drugs (global table, keyed by drug_name)")
    lines.append("insert into public.drugs (drug_name, unit_pengukuran, perlu_kelulusan_pakar, is_active)")
    lines.append("values")
    drug_value_lines = [
        f"  ({sql_str(cfg['drug_name'])}, {sql_str(cfg['unit_pengukuran'])}, true, true)"
        for cfg, _ in drugs_data
    ]
    lines.append(",\n".join(drug_value_lines))
    lines.append("on conflict (drug_name) do nothing;")
    lines.append("")

    # 2. Quotas
    lines.append(f"-- 2. Quotas for {YEAR} @ KK Kempas")
    lines.append("insert into public.drug_quotas (clinic_id, drug_id, year, quota_limit, alert_threshold_pct)")
    lines.append(f"select '{KEMPAS_CLINIC_ID}'::uuid, d.id, {YEAR}, v.quota_limit, 20")
    lines.append("from (values")
    quota_value_lines = [
        f"  ({sql_str(cfg['drug_name'])}, {cfg['expected_total_kuota']})"
        for cfg, _ in drugs_data
    ]
    lines.append(",\n".join(quota_value_lines))
    lines.append(") as v(drug_name, quota_limit)")
    lines.append("join public.drugs d on d.drug_name = v.drug_name")
    lines.append("on conflict (clinic_id, drug_id, year)")
    lines.append("do update set quota_limit = excluded.quota_limit;")
    lines.append("")

    # 3. Patients (dedup across drugs by IC — a patient on both Novomix and
    # Levemir gets one patient_registry row and two drug_quota_patients rows).
    all_patients: dict[str, str] = {}
    for _, rows in drugs_data:
        for row in rows:
            all_patients.setdefault(row["no_ic"], row["patient_name"])

    lines.append(f"-- 3. Patients — {len(all_patients)} distinct IC across all drugs in this seed")
    lines.append("insert into public.patient_registry (clinic_id, no_ic, patient_name)")
    lines.append(f"select '{KEMPAS_CLINIC_ID}'::uuid, v.no_ic, v.patient_name")
    lines.append("from (values")
    patient_value_lines = [
        f"  ({sql_str(ic)}, {sql_str(name)})" for ic, name in all_patients.items()
    ]
    lines.append(",\n".join(patient_value_lines))
    lines.append(") as v(no_ic, patient_name)")
    lines.append("on conflict (clinic_id, no_ic) do nothing;")
    lines.append("")

    # 4. Enrolments
    total_rows = sum(len(rows) for _, rows in drugs_data)
    lines.append(f"-- 4. Enrolments — {total_rows} rows across {len(drugs_data)} drug(s)")
    lines.append("insert into public.drug_quota_patients (")
    lines.append("  clinic_id, drug_id, year, patient_id,")
    lines.append("  source_bil, tarikh_mula_rawatan, status, dosing, fms_name, catatan, kuota)")
    lines.append(f"select '{KEMPAS_CLINIC_ID}'::uuid, d.id, {YEAR}, p.id,")
    lines.append("       v.source_bil, v.tarikh_mula_rawatan, v.status,")
    lines.append("       v.dosing, v.fms_name, v.catatan, v.kuota")
    lines.append("from (values")
    enrolment_lines = []
    for cfg, rows in drugs_data:
        for row in rows:
            enrolment_lines.append(
                "  ("
                f"{sql_str(cfg['drug_name'])}, "
                f"{sql_str(row['no_ic'])}, "
                f"{row['source_bil'] if row['source_bil'] is not None else 'null'}, "
                f"{('date ' + sql_str(row['tarikh_mula_rawatan'])) if row['tarikh_mula_rawatan'] else 'null'}, "
                f"{sql_str(row['status'])}, "
                f"{sql_str(row['dosing'])}, "
                f"{sql_str(row['fms_name'])}, "
                f"{sql_str(row['catatan'])}, "
                f"{row['kuota']}"
                ")"
            )
    lines.append(",\n".join(enrolment_lines))
    lines.append(") as v(drug_name, no_ic, source_bil, tarikh_mula_rawatan, status, dosing, fms_name, catatan, kuota)")
    lines.append("join public.drugs d on d.drug_name = v.drug_name")
    lines.append("join public.patient_registry p")
    lines.append("  on p.no_ic = v.no_ic")
    lines.append(f" and p.clinic_id = '{KEMPAS_CLINIC_ID}'::uuid")
    lines.append("on conflict (clinic_id, drug_id, year, patient_id) do update")
    lines.append("set source_bil          = excluded.source_bil,")
    lines.append("    tarikh_mula_rawatan = excluded.tarikh_mula_rawatan,")
    lines.append("    status              = excluded.status,")
    lines.append("    dosing              = excluded.dosing,")
    lines.append("    fms_name            = excluded.fms_name,")
    lines.append("    catatan             = excluded.catatan,")
    lines.append("    kuota               = excluded.kuota,")
    lines.append("    updated_at          = now();")
    lines.append("")

    # 5. Self-check
    lines.append("-- 5. Self-check — aborts the whole transaction if the numbers are wrong.")
    lines.append("-- Exercises drug_quota_used() end-to-end (enrolments + any dispensing_requests),")
    lines.append("-- not just sum(kuota), so it validates the real quota-math path.")
    lines.append("do $$")
    lines.append("declare r record;")
    lines.append("begin")
    lines.append("  for r in")
    lines.append("    select d.drug_name, q.quota_limit,")
    lines.append("           public.drug_quota_used(q.clinic_id, q.drug_id, q.year) as used")
    lines.append("    from public.drug_quotas q")
    lines.append("    join public.drugs d on d.id = q.drug_id")
    lines.append(f"    where q.clinic_id = '{KEMPAS_CLINIC_ID}'")
    lines.append(f"      and q.year = {YEAR}")
    drug_name_list = ", ".join(sql_str(cfg["drug_name"]) for cfg, _ in drugs_data)
    lines.append(f"      and d.drug_name in ({drug_name_list})")
    lines.append("  loop")
    conditions = []
    for cfg, _ in drugs_data:
        conditions.append(
            f"    if r.drug_name = {sql_str(cfg['drug_name'])} "
            f"and (r.quota_limit, r.used) is distinct from ({cfg['expected_total_kuota']}, {cfg['expected_kuota_digunakan']}) then\n"
            f"      raise exception 'Seed check failed for %: quota=% used=% (expected {cfg['expected_total_kuota']}/{cfg['expected_kuota_digunakan']})', r.drug_name, r.quota_limit, r.used;\n"
            "    end if;"
        )
    lines.append("\n".join(conditions))
    lines.append("  end loop;")
    lines.append("end $$;")
    lines.append("")
    lines.append("commit;")
    lines.append("")
    return "\n".join(lines)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xlsx_path", type=Path, help="Path to UBAT KAWALAN KHUSUS FMS PKDJB 2026.xlsx")
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUTPUT, help="Output .sql path")
    args = parser.parse_args()

    if not args.xlsx_path.exists():
        sys.exit(f"error: {args.xlsx_path} not found")

    wb = Workbook(args.xlsx_path)
    warnings: list[str] = []
    drugs_data = []

    for cfg in SHEETS:
        raw_rows = extract_block(wb, cfg, warnings)
        merged_rows = merge_duplicates(raw_rows, warnings, cfg["drug_name"])
        actual_sum = sum(r["kuota"] for r in merged_rows)
        if actual_sum != cfg["expected_kuota_digunakan"]:
            sys.exit(
                f"error: {cfg['drug_name']}: sum(kuota) = {actual_sum}, "
                f"expected {cfg['expected_kuota_digunakan']} (KUOTA DIGUNAKAN in the sheet). "
                f"Refusing to emit SQL — check the row range / normalization rules."
            )
        print(
            f"{cfg['sheet_name']}: {len(raw_rows)} source rows -> {len(merged_rows)} enrolments, "
            f"sum(kuota)={actual_sum} (matches KUOTA DIGUNAKAN={cfg['expected_kuota_digunakan']}) ✓",
            file=sys.stderr,
        )
        drugs_data.append((cfg, merged_rows))

    if warnings:
        print("\n--- normalization warnings (review before running the migration) ---", file=sys.stderr)
        for w in warnings:
            print(f"  ! {w}", file=sys.stderr)
        print("", file=sys.stderr)

    sql = build_sql(drugs_data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(sql)
    print(f"wrote {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
