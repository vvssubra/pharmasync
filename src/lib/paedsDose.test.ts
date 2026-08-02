import { describe, it, expect } from "vitest";
import { evaluate, toMl, formatAmount, ageToMonths, round1, type DoseOutcome } from "./paedsDose";
import { PAEDS_DRUGS } from "./paedsDoses";

function drug(id: string) {
  const found = PAEDS_DRUGS.find(d => d.id === id);
  if (!found) throw new Error(`No drug ${id} in the table`);
  return found;
}

/** mg (or mL) figures for one source, as the UI would show them. */
function dose(id: string, source: "mims" | "shann", years: number, months: number, weightKg: number): DoseOutcome {
  const d = drug(id);
  return evaluate(d[source], { ageMonths: ageToMonths(years, months), weightKg });
}

function amount(outcome: DoseOutcome): string {
  if (outcome.kind !== "dose") return outcome.kind;
  return formatAmount(outcome.min, outcome.max, outcome.unit);
}

describe("age band matching", () => {
  it("treats a band's lower bound as inclusive and upper as exclusive", () => {
    // Paracetamol 6-23 months is 120mg; 2-3 years is 180mg. The 24th month is
    // the first day of the older band.
    expect(amount(dose("paracetamol", "mims", 1, 11, 10))).toBe("120 mg");
    expect(amount(dose("paracetamol", "mims", 2, 0, 12))).toBe("180 mg");
  });

  it("reports out of band rather than extrapolating past the youngest entry", () => {
    // Paracetamol's youngest MIMS band starts at 3 months.
    expect(dose("paracetamol", "mims", 0, 2, 5).kind).toBe("outOfBand");
  });

  it("reports out of band rather than extrapolating past the oldest entry", () => {
    // MIMS paracetamol stops at 11 years.
    expect(dose("paracetamol", "mims", 12, 0, 40).kind).toBe("outOfBand");
  });

  // The source runs 6-11 years then resumes above 12, leaving 12-year-olds
  // unpublished. Reproducing the gap is the point — it must not be filled.
  it("reproduces a gap the source leaves open", () => {
    expect(dose("diphenhydramine", "mims", 12, 0, 40).kind).toBe("outOfBand");
    expect(amount(dose("diphenhydramine", "mims", 13, 0, 45))).toBe("25–50 mg");
  });

  // Cetirizine's MIMS bands both cover a 6-year-old; the younger wins.
  it("resolves an overlap in favour of the band listed first", () => {
    expect(amount(dose("cetirizine", "mims", 6, 0, 20))).toBe("2.5 mg");
    expect(amount(dose("cetirizine", "mims", 7, 0, 22))).toBe("5 mg");
  });
});

describe("weight-conditional bands", () => {
  it("splits loratadine on the 30kg threshold", () => {
    expect(amount(dose("loratadine", "mims", 8, 0, 25))).toBe("5 mg");
    expect(amount(dose("loratadine", "mims", 8, 0, 35))).toBe("10 mg");
  });

  it("treats exactly 30kg as the heavier band", () => {
    expect(amount(dose("loratadine", "mims", 8, 0, 30))).toBe("10 mg");
  });

  it("applies the Frank Shann lower weight bound too", () => {
    // Frank Shann's band is 12-30kg; a 10kg toddler is below it.
    expect(dose("loratadine", "shann", 2, 0, 10).kind).toBe("outOfBand");
    expect(amount(dose("loratadine", "shann", 2, 0, 13))).toBe("5 mg");
  });
});

describe("contraindications", () => {
  it.each(["pseudoephedrine", "phenylephrine", "dextromethorphan"])(
    "%s offers no dose under 12 from either source",
    (id) => {
      expect(dose(id, "mims", 6, 0, 20).kind).toBe("notRecommended");
      expect(dose(id, "shann", 6, 0, 20).kind).toBe("notRecommended");
    }
  );

  it("releases the Frank Shann dose once the patient is 12", () => {
    expect(amount(dose("dextromethorphan", "shann", 12, 0, 40))).toBe("8–16 mg");
  });
});

describe("per-kg calculation", () => {
  it("multiplies by weight", () => {
    // Frank Shann paracetamol 15mg/kg on 12kg.
    expect(amount(dose("paracetamol", "shann", 2, 0, 12))).toBe("180 mg");
  });

  it("carries a range through", () => {
    // MIMS ibuprofen 5-10mg/kg on 14kg.
    expect(amount(dose("ibuprofen", "mims", 3, 0, 14))).toBe("70–140 mg");
  });

  it("caps at the published maximum", () => {
    // Frank Shann phenylephrine 0.2mg/kg, max 10mg. 60kg would give 12mg.
    expect(amount(dose("phenylephrine", "shann", 14, 0, 60))).toBe("10 mg");
    expect(amount(dose("phenylephrine", "shann", 14, 0, 40))).toBe("8 mg");
  });
});

describe("sources that publish no dose", () => {
  it("says so for ambroxol rather than showing a blank", () => {
    const outcome = dose("ambroxol", "shann", 3, 0, 14);
    expect(outcome.kind).toBe("noData");
    if (outcome.kind === "noData") expect(outcome.note).toBe("No data");
  });

  it("does not invent a frequency for bromhexine", () => {
    const outcome = dose("bromhexine", "shann", 3, 0, 14);
    expect(outcome.kind).toBe("dose");
    if (outcome.kind === "dose") expect(outcome.freq).toBe("frequency not stated");
  });
});

describe("volume-dosed entries", () => {
  it("keeps triprolidine's Frank Shann figure in mL", () => {
    const outcome = dose("triprolidine", "shann", 3, 0, 14);
    expect(outcome.kind).toBe("dose");
    if (outcome.kind === "dose") expect(outcome.unit).toBe("ml");
    expect(amount(outcome)).toBe("2.5–5 ml");
  });

  it("computes lactulose from mL per kg", () => {
    expect(amount(dose("lactulose", "shann", 4, 0, 16))).toBe("8 ml");
  });
});

describe("mg to mL conversion", () => {
  it("converts against the selected strength", () => {
    const outcome = dose("paracetamol", "mims", 2, 0, 12); // 180 mg
    const [low, high] = drug("paracetamol").preparations;
    expect(toMl(outcome, low)).toEqual({ min: 7.5, max: undefined });   // 120mg/5ml
    expect(toMl(outcome, high)).toEqual({ min: 3.6, max: undefined });  // 250mg/5ml
  });

  it("converts both ends of a range", () => {
    const outcome = dose("ibuprofen", "mims", 3, 0, 14); // 70-140 mg
    expect(toMl(outcome, drug("ibuprofen").preparations[0])).toEqual({ min: 3.5, max: 7 });
  });

  it("passes a mL dose through untouched", () => {
    const outcome = dose("lactulose", "shann", 4, 0, 16);
    expect(toMl(outcome, drug("lactulose").preparations[0])).toEqual({ min: 8, max: undefined });
  });

  it("offers no volume when the strength is unknown", () => {
    const outcome = dose("paracetamol", "mims", 2, 0, 12);
    expect(toMl(outcome, { label: "unconfirmed", mgPerMl: null })).toBeNull();
  });

  it("offers no volume for an outcome that is not a dose", () => {
    expect(toMl({ kind: "outOfBand" }, { label: "x", mgPerMl: 1 })).toBeNull();
  });
});

describe("formatting", () => {
  it("rounds to one decimal", () => {
    expect(round1(3.649)).toBe(3.6);
    expect(formatAmount(0.3125, undefined, "mg")).toBe("0.3 mg");
  });

  it("collapses a range whose ends round to the same figure", () => {
    expect(formatAmount(5.01, 5.02, "mg")).toBe("5 mg");
  });
});

// Every drug must resolve to something for a plausible mid-childhood patient —
// a typo in an age band would otherwise sit unnoticed behind "outOfBand".
describe("table coverage", () => {
  it("has no drug that silently produces nothing for a 7-year-old, 22kg", () => {
    const unresolved = PAEDS_DRUGS.filter(d => {
      const mims = evaluate(d.mims, { ageMonths: 84, weightKg: 22 });
      const shann = evaluate(d.shann, { ageMonths: 84, weightKg: 22 });
      return mims.kind === "outOfBand" && shann.kind === "outOfBand";
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
