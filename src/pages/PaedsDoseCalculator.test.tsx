import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import PaedsDoseCalculator from "./PaedsDoseCalculator";

function enterPatient({ years = "", months = "", weight = "" }) {
  if (years !== "") fireEvent.change(screen.getByLabelText(/age — years/i), { target: { value: years } });
  if (months !== "") fireEvent.change(screen.getByLabelText(/age — months/i), { target: { value: months } });
  if (weight !== "") fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: weight } });
}

/** The block of text under a drug heading, both sources included. */
function drugSection(name: string) {
  const heading = screen.getByRole("heading", { name, level: 3 });
  const section = heading.closest("div")?.parentElement;
  if (!section) throw new Error(`No section for ${name}`);
  return within(section);
}

describe("PaedsDoseCalculator", () => {
  beforeEach(() => render(<PaedsDoseCalculator />));

  it("waits for both age and weight before calculating", () => {
    expect(screen.getByText(/enter an age and a weight/i)).toBeInTheDocument();
    enterPatient({ years: "2" });
    expect(screen.getByText(/enter an age and a weight/i)).toBeInTheDocument();
    enterPatient({ weight: "12" });
    expect(screen.queryByText(/enter an age and a weight/i)).not.toBeInTheDocument();
  });

  it("shows mg and mL side by side for both sources", () => {
    enterPatient({ years: "2", months: "0", weight: "12" });
    const paracetamol = drugSection("Paracetamol");
    // MIMS 2-3 years = 180mg, and Frank Shann's 15mg/kg on 12kg lands on the
    // same figure — both lines read 180 mg, and 120mg/5ml is 24mg/ml → 7.5 mL.
    expect(paracetamol.getAllByText(/180 mg/)).toHaveLength(2);
    expect(paracetamol.getAllByText(/7\.5 mL/)).toHaveLength(2);
  });

  it("recalculates when the preparation is changed", () => {
    enterPatient({ years: "2", months: "0", weight: "12" });
    const paracetamol = drugSection("Paracetamol");
    expect(paracetamol.getAllByText(/7\.5 mL/).length).toBeGreaterThan(0);

    // 250mg/5ml is 50mg/ml, so the same 180mg becomes 3.6 mL.
    fireEvent.keyDown(screen.getByLabelText(/preparation for Paracetamol/i), { key: "Enter" });
    const option = screen.getByRole("option", { name: "250mg/5ml" });
    fireEvent.click(option);
    expect(drugSection("Paracetamol").getAllByText(/3\.6 mL/).length).toBeGreaterThan(0);
  });

  // The whole point of the contraindication rule: no number to misread.
  it("shows the contraindication and no dose for a 6-year-old on dextromethorphan", () => {
    enterPatient({ years: "6", months: "0", weight: "20" });
    const section = drugSection("Dextromethorphan");
    expect(section.getAllByText(/not recommended under 12/i)).toHaveLength(2);
    // A dose reads "8–16 mg · …"; the bottle label reads "15mg/5ml" with no
    // space, so the space is what separates a dose from a strength.
    expect(section.queryByText(/\d mg/)).not.toBeInTheDocument();
  });

  it("says when a source publishes no dose at all", () => {
    enterPatient({ years: "3", months: "0", weight: "14" });
    expect(drugSection("Ambroxol").getByText("No data")).toBeInTheDocument();
  });

  it("says when the age falls outside every published band", () => {
    enterPatient({ years: "0", months: "1", weight: "4" });
    expect(drugSection("Paracetamol").getByText(/no band published/i)).toBeInTheDocument();
  });

  it("rejects a months value of 12 or more", () => {
    enterPatient({ years: "1", months: "14", weight: "10" });
    expect(screen.getByText(/months must be between 0 and 11/i)).toBeInTheDocument();
    expect(screen.getByText(/enter an age and a weight/i)).toBeInTheDocument();
  });

  it("rejects an implausible weight", () => {
    enterPatient({ years: "5", months: "0", weight: "250" });
    expect(screen.getByText(/between 0 and 100 kg/i)).toBeInTheDocument();
  });

  it("always renders the disclaimer", () => {
    expect(screen.getByText(/should not be used for diagnosing/i)).toBeInTheDocument();
  });

  it("groups drugs under their indication, fever first", () => {
    enterPatient({ years: "5", months: "0", weight: "18" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map(h => h.textContent);
    expect(headings).toEqual([
      "Fever", "Antihistamine", "Decongestant", "Wet Cough", "Dry Cough", "Miscellaneous",
    ]);
  });
});
