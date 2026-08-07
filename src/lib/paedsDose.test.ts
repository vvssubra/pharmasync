import { describe, it, expect } from "vitest";
import { evaluate, formatAmount, ageToMonths, roundMl, roundMg, type DoseOutcome } from "./paedsDose";
import { PAEDS_DRUGS } from "./paedsDoses";

function drug(id: string) {
  const found = PAEDS_DRUGS.find(d => d.id === id);
  if (!found) throw new Error(`No drug ${id} in the table`);
  return found;
}

/** mg (or mL) figures, as the UI would show them. */
function dose(id: string, years: number, months: number, weightKg: number): DoseOutcome {
  const d = drug(id);
  return evaluate(d.mims, { ageMonths: ageToMonths(years, months), weightKg });
}

function amount(outcome: DoseOutcome): string {
  if (outcome.kind !== "dose") return outcome.kind;
  return formatAmount(outcome.min, outcome.max, outcome.unit);
}

describe("age band matching", () => {
  it("treats a band's lower bound as inclusive and upper as exclusive", () => {
    // Paracetamol 6-23 months is 120mg; 2-3 years is 180mg. The 24th month is
    // the first day of the older band.
    expect(amount(dose("paracetamol", 1, 11, 10))).toBe("120 mg");
    expect(amount(dose("paracetamol", 2, 0, 12))).toBe("180 mg");
  });

  it("reports out of band rather than extrapolating past the youngest entry", () => {
    // Paracetamol's youngest MIMS band starts at 3 months.
    expect(dose("paracetamol", 0, 2, 5).kind).toBe("outOfBand");
  });

  it("reports out of band rather than extrapolating past the oldest entry", () => {
    // MIMS paracetamol stops at 11 years.
    expect(dose("paracetamol", 12, 0, 40).kind).toBe("outOfBand");
  });

  // The source runs 6-11 years then resumes above 12, leaving 12-year-olds
  // unpublished. Reproducing the gap is the point — it must not be filled.
  it("reproduces a gap the source leaves open", () => {
    expect(dose("diphenhydramine", 12, 0, 40).kind).toBe("outOfBand");
    expect(amount(dose("diphenhydramine", 13, 0, 45))).toBe("25–50 mg");
  });

  // Cetirizine's MIMS bands both cover a 6-year-old; the younger wins.
  it("resolves an overlap in favour of the band listed first", () => {
    expect(amount(dose("cetirizine", 6, 0, 20))).toBe("2.5 mg");
    expect(amount(dose("cetirizine", 7, 0, 22))).toBe("5 mg");
  });
});

describe("weight-conditional bands", () => {
  it("splits loratadine on the 30kg threshold", () => {
    expect(amount(dose("loratadine", 8, 0, 25))).toBe("5 mg");
    expect(amount(dose("loratadine", 8, 0, 35))).toBe("10 mg");
  });

  it("treats exactly 30kg as the heavier band", () => {
    expect(amount(dose("loratadine", 8, 0, 30))).toBe("10 mg");
  });
});

describe("contraindications", () => {
  it.each(["pseudoephedrine", "phenylephrine", "dextromethorphan"])(
    "%s offers no dose under 12",
    (id) => {
      expect(dose(id, 6, 0, 20).kind).toBe("notRecommended");
    }
  );
});

describe("per-kg calculation", () => {
  it("multiplies by weight", () => {
    // MIMS ibuprofen 5-10mg/kg on 14kg.
    expect(amount(dose("ibuprofen", 3, 0, 14))).toBe("70–140 mg");
  });

  it("carries a range through", () => {
    expect(amount(dose("ibuprofen", 3, 0, 14))).toBe("70–140 mg");
  });
});

describe("sources that publish no dose", () => {
  it("says so for ambroxol above the published bands rather than showing a blank", () => {
    const outcome = dose("ambroxol", 13, 0, 40);
    expect(outcome.kind).toBe("outOfBand");
  });
});

describe("volume-dosed entries", () => {
  it("computes lactulose volume from the published band", () => {
    expect(amount(dose("lactulose", 4, 0, 16))).toBe("5–10 ml");
  });
});

// Doses are reported in the unit the source publishes. Nothing is converted:
// a mg figure stays mg, and lactulose stays mL.
describe("units follow the source", () => {
  it("reports millilitres only where the source printed millilitres", () => {
    const lactulose = dose("lactulose", 3, 0, 14);
    if (lactulose.kind === "dose") expect(lactulose.unit).toBe("ml");
  });
});

describe("shown working", () => {
  it("states both ends of a per-kg range", () => {
    const outcome = dose("ibuprofen", 3, 0, 14);
    if (outcome.kind === "dose") expect(outcome.basis).toBe("5–10 mg/kg × 14 kg");
  });

  it("leaves a fixed-band dose without a basis — there is no arithmetic", () => {
    const outcome = dose("paracetamol", 2, 0, 12);
    if (outcome.kind === "dose") expect(outcome.basis).toBeUndefined();
  });
});

describe("frequently used", () => {
  it("flags exactly the six the clinic reaches for", () => {
    const flagged = PAEDS_DRUGS.filter(d => d.frequentlyUsed).map(d => d.id).sort();
    expect(flagged).toEqual([
      "bromhexine", "chlorpheniramine", "diphenhydramine",
      "lactulose", "paracetamol", "salbutamol",
    ]);
  });
});

describe("formatting", () => {
  it("rounds volumes to one decimal — a syringe cannot do better", () => {
    expect(roundMl(3.649)).toBe(3.6);
    expect(formatAmount(3.649, undefined, "mL")).toBe("3.6 mL");
  });

  // Rounding mg to one decimal would print desloratadine's published 1.25 mg
  // as 1.3 and triprolidine's 0.313 as 0.3, so the screen would disagree with
  // the printed table a clinician is checking it against.
  it("keeps the published precision on milligrams", () => {
    expect(roundMg(1.25)).toBe(1.25);
    expect(formatAmount(1.25, undefined, "mg")).toBe("1.25 mg");
    expect(formatAmount(0.313, undefined, "mg")).toBe("0.313 mg");
    expect(formatAmount(0.938, undefined, "mg")).toBe("0.938 mg");
  });

  it("renders the published small doses exactly as the source prints them", () => {
    expect(amount(dose("desloratadine", 3, 0, 14))).toBe("1.25 mg");
    expect(amount(dose("triprolidine", 1, 0, 10))).toBe("0.313 mg");
    expect(amount(dose("diphenhydramine", 3, 0, 14))).toBe("6.25 mg");
  });

  it("collapses a range whose ends round to the same figure", () => {
    expect(formatAmount(5.0001, 5.0002, "mg")).toBe("5 mg");
  });
});

// Every drug must resolve to something for a plausible mid-childhood patient —
// a typo in an age band would otherwise sit unnoticed behind "outOfBand".
describe("table coverage", () => {
  it("has no drug that silently produces nothing for a 7-year-old, 22kg", () => {
    const unresolved = PAEDS_DRUGS.filter(d => {
      const mims = evaluate(d.mims, { ageMonths: 84, weightKg: 22 });
      return mims.kind === "outOfBand";
    });
    expect(unresolved.map(d => d.id)).toEqual([]);
  });

  it("gives every drug at least one preparation", () => {
    expect(PAEDS_DRUGS.filter(d => d.preparations.length === 0)).toEqual([]);
  });

  it("carries every drug id exactly once", () => {
    const ids = PAEDS_DRUGS.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
