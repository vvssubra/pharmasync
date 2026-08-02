import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import PaedsDoseCalculator from "./PaedsDoseCalculator";

function enterPatient({ years = "", months = "", weight = "" }) {
  if (years !== "") fireEvent.change(screen.getByLabelText(/age — years/i), { target: { value: years } });
  if (months !== "") fireEvent.change(screen.getByLabelText(/age — months/i), { target: { value: months } });
  if (weight !== "") fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: weight } });
}

/** One drug's card, both sources included. */
function drugCard(id: string) {
  return within(screen.getByTestId(`drug-${id}`));
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

  it("shows both sources in mg, with no volume conversion", () => {
    enterPatient({ years: "2", months: "0", weight: "12" });
    const paracetamol = drugCard("paracetamol");
    // MIMS 2-3 years = 180mg, and Frank Shann's 15mg/kg on 12kg lands on the
    // same figure, so both lines read 180 mg.
    expect(paracetamol.getAllByText(/180 mg/)).toHaveLength(2);
    expect(paracetamol.queryByText(/mL/)).not.toBeInTheDocument();
  });

  // The user's own worked example: 15 mg/kg at 10 kg is 150 mg.
  it("shows the arithmetic behind a per-kg dose", () => {
    enterPatient({ years: "2", months: "0", weight: "10" });
    const paracetamol = drugCard("paracetamol");
    expect(paracetamol.getByText("150 mg")).toBeInTheDocument();
    expect(paracetamol.getByText("15 mg/kg × 10 kg")).toBeInTheDocument();
  });

  it("keeps millilitres where the source itself publishes them", () => {
    enterPatient({ years: "4", months: "0", weight: "16" });
    // Frank Shann lactulose is 0.5 mL/kg — there is no mg figure to show.
    expect(drugCard("lactulose").getByText("8 mL")).toBeInTheDocument();
  });

  // The whole point of the contraindication rule: no number to misread.
  it("shows the contraindication and no dose for a 6-year-old on dextromethorphan", () => {
    enterPatient({ years: "6", months: "0", weight: "20" });
    const section = drugCard("dextromethorphan");
    expect(section.getAllByText(/not recommended under 12/i)).toHaveLength(2);
    // A dose reads "8–16 mg · …"; the bottle label reads "15mg/5ml" with no
    // space, so the space is what separates a dose from a strength.
    expect(section.queryByText(/\d mg/)).not.toBeInTheDocument();
  });

  it("says when a source publishes no dose at all", () => {
    enterPatient({ years: "3", months: "0", weight: "14" });
    expect(drugCard("ambroxol").getByText("No data")).toBeInTheDocument();
  });

  it("says when the age falls outside every published band", () => {
    enterPatient({ years: "0", months: "1", weight: "4" });
    expect(drugCard("paracetamol").getByText(/no band published/i)).toBeInTheDocument();
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

  it("marks the frequently-used drugs and can filter to just them", () => {
    enterPatient({ years: "5", months: "0", weight: "18" });
    expect(within(screen.getByTestId("drug-paracetamol")).getByLabelText(/frequently used/i))
      .toBeInTheDocument();
    expect(screen.getByTestId("drug-ibuprofen")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/frequently used only/i));

    expect(screen.getByTestId("drug-paracetamol")).toBeInTheDocument();
    expect(screen.queryByTestId("drug-ibuprofen")).not.toBeInTheDocument();
    // Decongestants have no starred drug, so that heading goes with them.
    expect(screen.queryByText("Decongestant")).not.toBeInTheDocument();
  });

  it("groups drugs under their indication, fever first", () => {
    enterPatient({ years: "5", months: "0", weight: "18" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map(h => h.textContent);
    expect(headings).toEqual([
      "Fever", "Antihistamine", "Decongestant", "Wet Cough", "Dry Cough", "Miscellaneous",
    ]);
  });
});
