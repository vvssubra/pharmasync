// src/components/DiagnosisCombobox.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiagnosisCombobox } from "./DiagnosisCombobox";

function open() {
  fireEvent.click(screen.getByRole("combobox", { name: "Diagnosis" }));
}

describe("DiagnosisCombobox", () => {
  it("shows the current value on the trigger", () => {
    render(<DiagnosisCombobox value="Acute Otitis Media" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Diagnosis" })).toHaveTextContent("Acute Otitis Media");
  });

  it("shows placeholder text when empty", () => {
    render(<DiagnosisCombobox value="" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Diagnosis" })).toHaveTextContent(
      "Select or type diagnosis..."
    );
  });

  it("finds a NAG pathway by alias, not just its canonical label", async () => {
    const user = userEvent.setup();
    render(<DiagnosisCombobox value="" onChange={vi.fn()} />);
    open();
    await user.type(screen.getByPlaceholderText("Search diagnosis..."), "sore throat");
    expect(await screen.findByText("Acute Pharyngitis")).toBeInTheDocument();
    expect(screen.getByText("NAG")).toBeInTheDocument();
  });

  it("calls onChange with the canonical label on select and closes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DiagnosisCombobox value="" onChange={onChange} />);
    open();
    await user.type(screen.getByPlaceholderText("Search diagnosis..."), "oti");
    const item = await screen.findByText("Acute Otitis Media");
    fireEvent.click(item);
    expect(onChange).toHaveBeenCalledWith("Acute Otitis Media");
    expect(screen.queryByPlaceholderText("Search diagnosis...")).not.toBeInTheDocument();
  });

  it("offers a free-text option for a query matching nothing, and passes it through verbatim", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DiagnosisCombobox value="" onChange={onChange} />);
    open();
    await user.type(screen.getByPlaceholderText("Search diagnosis..."), "dengue");
    const freeTextItem = await screen.findByText('Use "dengue"');
    fireEvent.click(freeTextItem);
    expect(onChange).toHaveBeenCalledWith("dengue");
  });

  it("lists recents first, capped at 5, and excludes them from the NAG/Common duplicate", async () => {
    const recent = ["Acute Otitis Media", "Foo", "Bar", "Baz", "Qux", "Extra"];
    render(<DiagnosisCombobox value="" onChange={vi.fn()} recent={recent} />);
    open();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getAllByText("Acute Otitis Media")).toHaveLength(1); // dedup vs NAG group
    expect(screen.queryByText("Extra")).not.toBeInTheDocument(); // beyond the 5-item cap
  });
});
