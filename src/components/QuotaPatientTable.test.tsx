import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuotaPatientTable, type QuotaPatientRow } from "./QuotaPatientTable";

function makeRow(overrides: Partial<QuotaPatientRow> = {}): QuotaPatientRow {
  return {
    id: "row-1",
    source_bil: 1,
    tarikh_mula_rawatan: "2024-08-13",
    status: "AKTIF",
    dosing: "30iu TDS",
    fms_name: "DR SYAZWANI",
    catatan: "Tpc checked",
    kuota: 1,
    patient_id: "patient-1",
    patient_registry: { id: "patient-1", patient_name: "Saringat Salleh", no_ic: "580305715589" },
    ...overrides,
  };
}

describe("QuotaPatientTable", () => {
  it("renders all 9 column headers in the source sheet's order", () => {
    render(<QuotaPatientTable rows={[]} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="Tiada pesakit." />);
    for (const label of ["BIL", "NAMA PESAKIT", "NO IC", "TARIKH MULA RAWATAN", "STATUS", "DOSING", "FMS", "CATATAN", "KUOTA"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders BIL as 1..N over the given (already-filtered) rows, not source_bil", () => {
    const rows = [makeRow({ id: "a", source_bil: 41, patient_id: "p-a", patient_registry: { id: "p-a", patient_name: "A", no_ic: "580305715589" } }),
                  makeRow({ id: "b", source_bil: 42, patient_id: "p-b", patient_registry: { id: "p-b", patient_name: "B", no_ic: "580305715590" } })];
    render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    // BIL is the first cell of each data row — check it directly rather than
    // by text (which collides with the kuota column, also "1" by default).
    const dataRows = screen.getAllByRole("row").slice(1); // drop the header row
    const bilCells = dataRows.map(r => r.querySelector("td")?.textContent);
    expect(bilCells).toEqual(["1", "2"]);
    expect(screen.queryByText("41")).not.toBeInTheDocument();
  });

  it("shows a green AKTIF badge and a gray badge for any other status", () => {
    const rows = [
      makeRow({ id: "a", status: "AKTIF", patient_id: "p-a" }),
      makeRow({ id: "b", status: "TIDAK AKTIF", patient_id: "p-b", patient_registry: { id: "p-b", patient_name: "B", no_ic: "580305715590" } }),
    ];
    render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    expect(screen.getByText("AKTIF")).toHaveClass("bg-green-100");
    expect(screen.getByText("TIDAK AKTIF")).toHaveClass("bg-gray-100");
  });

  it("flags a malformed (non-12-digit) IC with a warning icon", () => {
    const rows = [makeRow({ patient_registry: { id: "patient-1", patient_name: "Bad IC", no_ic: "77028341" } })];
    const { container } = render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    expect(container.querySelector("svg.lucide-circle-alert")).toBeTruthy();
  });

  it("does not flag a valid 12-digit IC", () => {
    const rows = [makeRow()];
    const { container } = render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    expect(container.querySelector("svg.lucide-circle-alert")).toBeFalsy();
  });

  it("renders a merged-duplicate kuota (>1) as a badge, and 0 muted", () => {
    const rows = [
      makeRow({ id: "a", kuota: 2, patient_id: "p-a" }),
      makeRow({ id: "b", kuota: 0, patient_id: "p-b", patient_registry: { id: "p-b", patient_name: "B", no_ic: "580305715590" } }),
    ];
    render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    // "2" is ambiguous on its own (row B's BIL is also 2) — scope to the badge class.
    const kuotaBadge = screen.getAllByText("2").find(el => el.className.includes("bg-blue-50"));
    expect(kuotaBadge).toBeTruthy();
    const mutedZero = screen.getAllByText("0").find(el => el.className.includes("text-muted-foreground"));
    expect(mutedZero).toBeTruthy();
  });

  it("renders '—' for a null tarikh_mula_rawatan", () => {
    const rows = [makeRow({ tarikh_mula_rawatan: null })];
    render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("calls onSelect with the patient_id when a row is clicked", () => {
    const onSelect = vi.fn();
    const rows = [makeRow()];
    render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={onSelect} emptyMessage="—" />);
    fireEvent.click(screen.getByText("Saringat Salleh"));
    expect(onSelect).toHaveBeenCalledWith("patient-1");
  });

  it("shows the empty-state message when there are no rows", () => {
    render(<QuotaPatientTable rows={[]} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="Tiada pesakit berdaftar untuk ubat ini." />);
    expect(screen.getByText("Tiada pesakit berdaftar untuk ubat ini.")).toBeInTheDocument();
  });
});
