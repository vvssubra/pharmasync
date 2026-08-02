import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import G6pdDeficiency from "./G6pdDeficiency";

function search(term: string) {
  fireEvent.change(screen.getByLabelText(/search drugs/i), { target: { value: term } });
}

describe("G6pdDeficiency", () => {
  beforeEach(() => render(<G6pdDeficiency />));

  it("shows both tiers of the full table before any search", () => {
    expect(screen.getByRole("heading", { name: /definite risk of haemolysis/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /possible risk of haemolysis/i })).toBeInTheDocument();
    expect(screen.getByText("Primaquine")).toBeInTheDocument();
    expect(screen.getByText("Colchicine")).toBeInTheDocument();
  });

  it("replaces the table with the answer when a drug is searched", () => {
    search("primaquine");
    expect(screen.getByText("Primaquine")).toBeInTheDocument();
    expect(screen.queryByText("Colchicine")).not.toBeInTheDocument();
    expect(screen.getByText(/definite risk of haemolysis/i)).toBeInTheDocument();
  });

  it("states the class the drug was found under", () => {
    search("nitrofurantoin");
    expect(screen.getByText(/Antibiotics · Nitrofurans/)).toBeInTheDocument();
  });

  it("finds a drug by its alternative name", () => {
    search("aspirin");
    expect(screen.getByText("Acetylsalicylic acid")).toBeInTheDocument();
    expect(screen.getByText(/possible risk of haemolysis/i)).toBeInTheDocument();
  });

  // A summary table is not a complete list, and "no results" alone would read
  // as a safety clearance.
  it("does not let an absent drug read as safe", () => {
    search("amoxicillin");
    expect(screen.getByText(/is not on this table/i)).toBeInTheDocument();
    expect(screen.getByText(/does not mean it is safe/i)).toBeInTheDocument();
  });

  it("returns to the full table when the search is cleared", () => {
    search("primaquine");
    expect(screen.queryByText("Colchicine")).not.toBeInTheDocument();
    search("");
    expect(screen.getByText("Colchicine")).toBeInTheDocument();
  });

  it("shows both listings of a drug published under two classes", () => {
    search("quinidine");
    expect(screen.getAllByText("Quinidine")).toHaveLength(2);
  });

  it("flags the entry whose class could not be resolved", () => {
    search("proadione");
    expect(screen.getByText(/does not resolve to a known INN/i)).toBeInTheDocument();
  });

  it("credits the source", () => {
    expect(screen.getByText(/ver01032006/)).toBeInTheDocument();
  });
});
