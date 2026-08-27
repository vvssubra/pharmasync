import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuotaPatientTable, type QuotaPatientRow } from "./QuotaPatientTable";

function makeRow(overrides: Partial<QuotaPatientRow> = {}): QuotaPatientRow {
  return {
    id: "row-1",
    source_bil: 1,
    tarikh_mula_rawatan: "2024-08-13",
    status: "AKTIF",
    dosing: "30iu TDS",
    fms_name: "DR SYAZWANI",
    clinic_name: "KK Kempas",
    catatan: "Tpc checked",
    kuota: 1,
    patient_id: "patient-1",
    patient_registry: { id: "patient-1", patient_name: "Saringat Salleh", no_ic: "580305715589" },
    ...overrides,
  };
}

describe("QuotaPatientTable", () => {
  it("renders all 8 column headers in the source sheet's order", () => {
    render(<QuotaPatientTable rows={[]} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="Tiada pesakit." />);
    for (const label of ["BIL", "NAMA PESAKIT", "NO IC", "TARIKH MULA RAWATAN", "STATUS", "DOSING", "FMS", "CATATAN"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("does not render a KUOTA column", () => {
    // Dropped from the table; `kuota` survives on the row only because the
    // caller's duplicate-IC collapse picks the max of the group.
    render(<QuotaPatientTable rows={[makeRow({ kuota: 3 })]} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    expect(screen.queryByText("KUOTA")).not.toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("renders BIL as 1..N over the given (already-filtered) rows, not source_bil", () => {
    const rows = [makeRow({ id: "a", source_bil: 41, patient_id: "p-a", patient_registry: { id: "p-a", patient_name: "A", no_ic: "580305715589" } }),
                  makeRow({ id: "b", source_bil: 42, patient_id: "p-b", patient_registry: { id: "p-b", patient_name: "B", no_ic: "580305715590" } })];
    render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    // BIL is the first cell of each data row — check it directly rather than
    // by text, which would match any other cell holding the same digits.
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

  it("hides the KLINIK column when every row is from the same clinic", () => {
    const rows = [makeRow({ id: "a", patient_id: "p-a" }),
                  makeRow({ id: "b", patient_id: "p-b", patient_registry: { id: "p-b", patient_name: "B", no_ic: "580305715590" } })];
    render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    expect(screen.queryByText("KLINIK")).not.toBeInTheDocument();
    expect(screen.queryByText("KK Kempas")).not.toBeInTheDocument();
  });

  it("shows KLINIK beside FMS when the rows span clinics", () => {
    const rows = [makeRow({ id: "a", patient_id: "p-a", clinic_name: "KK Kempas" }),
                  makeRow({ id: "b", patient_id: "p-b", clinic_name: "KK Larkin", patient_registry: { id: "p-b", patient_name: "B", no_ic: "580305715590" } })];
    render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    expect(screen.getByText("KLINIK")).toBeInTheDocument();
    expect(screen.getByText("KK Kempas")).toBeInTheDocument();
    expect(screen.getByText("KK Larkin")).toBeInTheDocument();

    // Beside FMS, not appended at the end: KLINIK sits between FMS and CATATAN.
    const headers = screen.getAllByRole("columnheader").map(h => h.textContent);
    expect(headers.slice(headers.indexOf("FMS"), headers.indexOf("FMS") + 3))
      .toEqual(["FMS", "KLINIK", "CATATAN"]);
  });

  it("renders '—' for a row with no clinic while others have one", () => {
    const rows = [makeRow({ id: "a", patient_id: "p-a", clinic_name: "KK Kempas" }),
                  makeRow({ id: "b", patient_id: "p-b", clinic_name: "KK Larkin", patient_registry: { id: "p-b", patient_name: "B", no_ic: "580305715590" } }),
                  makeRow({ id: "c", patient_id: "p-c", clinic_name: null, patient_registry: { id: "p-c", patient_name: "C", no_ic: "580305715591" } })];
    render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    const cRow = screen.getByText("C").closest("tr")!;
    const cells = Array.from(cRow.querySelectorAll("td")).map(td => td.textContent);
    expect(cells[7]).toBe("—"); // KLINIK, the 8th cell once the column is shown
  });

  it("renders STATUS as a read-only badge when no onStatusChange is given", () => {
    render(<QuotaPatientTable rows={[makeRow()]} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="—" />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("AKTIF")).toBeInTheDocument();
  });

  it("offers the three enrolment statuses when onStatusChange is given", async () => {
    const onStatusChange = vi.fn();
    render(<QuotaPatientTable rows={[makeRow()]} selectedPatientId={null} onSelect={vi.fn()} onStatusChange={onStatusChange} emptyMessage="—" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Status Saringat Salleh" }));
    for (const s of ["AKTIF", "PENDING", "TIDAK AKTIF"]) {
      expect(await screen.findByRole("option", { name: s })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("option", { name: "TIDAK AKTIF" }));
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ id: "row-1" }), "TIDAK AKTIF");
  });

  it("does not open the patient sheet when the status dropdown is used", async () => {
    const onSelect = vi.fn();
    render(<QuotaPatientTable rows={[makeRow()]} selectedPatientId={null} onSelect={onSelect} onStatusChange={vi.fn()} emptyMessage="—" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Status Saringat Salleh" }));
    // The row's own onClick would pop the history sheet open behind the dropdown.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables the dropdown for the row whose status write is in flight", () => {
    render(<QuotaPatientTable rows={[makeRow()]} selectedPatientId={null} onSelect={vi.fn()} onStatusChange={vi.fn()} savingStatusRowId="row-1" emptyMessage="—" />);
    expect(screen.getByRole("combobox", { name: "Status Saringat Salleh" })).toBeDisabled();
  });

  it("shows a dispensing request's own status as the placeholder, not as a fourth option", async () => {
    // These rows carry the REQUEST's status ("approved"), which is not one of
    // the three enrolment statuses — it must still be readable.
    const rows = [makeRow({ status: "approved", patient_id: "dr:req-1" })];
    render(<QuotaPatientTable rows={rows} selectedPatientId={null} onSelect={vi.fn()} onStatusChange={vi.fn()} emptyMessage="—" />);
    expect(screen.getByText("approved")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Status Saringat Salleh" }));
    expect(await screen.findByRole("option", { name: "AKTIF" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "approved" })).not.toBeInTheDocument();
  });

  it("shows the empty-state message when there are no rows", () => {
    render(<QuotaPatientTable rows={[]} selectedPatientId={null} onSelect={vi.fn()} emptyMessage="Tiada pesakit berdaftar untuk ubat ini." />);
    expect(screen.getByText("Tiada pesakit berdaftar untuk ubat ini.")).toBeInTheDocument();
  });
});
