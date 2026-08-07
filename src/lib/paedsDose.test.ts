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
  it("reports out of band below paracetamol's 3-month floor", () => {
    expect(dose("paracetamol", 0, 2, 5).kind).toBe("outOfBand");
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
  it.each(["phenylephrine", "dextromethorphan"])(
    "%s offers no dose under 12",
    (id) => {
      expect(dose(id, 6, 0, 20).kind).toBe("notRecommended");
    }
  );

  it("releases the phenylephrine per-kg dose once the patient is 12, capped at 10mg", () => {
    expect(amount(dose("phenylephrine", 14, 0, 40))).toBe("8 mg");
    expect(amount(dose("phenylephrine", 14, 0, 60))).toBe("10 mg");
  });

  it("releases the dextromethorphan per-kg dose once the patient is 12", () => {
    expect(amount(dose("dextromethorphan", 12, 0, 40))).toBe("8–16 mg");
  });
});

describe("per-kg calculation", () => {
  it("multiplies by weight", () => {
    // Clinic protocol paracetamol 15mg/kg on 14kg.
    expect(amount(dose("paracetamol", 2, 0, 14))).toBe("210 mg");
  });

  it("carries a range through", () => {
    // MIMS ibuprofen 5-10mg/kg on 14kg.
    expect(amount(dose("ibuprofen", 3, 0, 14))).toBe("70–140 mg");
  });

  it("caps chlorpheniramine at 0.1mg/kg, not the old fixed 1mg band", () => {
    // 0.1mg/kg on 14kg is 1.4mg, not the retired 1mg fixed dose.
    expect(amount(dose("chlorpheniramine", 2, 0, 14))).toBe("1.4 mg");
  });

  it("doses promethazine, bromhexine, diphenhydramine and salbutamol by weight", () => {
    expect(amount(dose("promethazine", 3, 0, 14))).toBe("2.8–7 mg");
    expect(amount(dose("bromhexine", 3, 0, 14))).toBe("4.2 mg");
    expect(amount(dose("diphenhydramine", 3, 0, 14))).toBe("14–28 mg");
    expect(amount(dose("salbutamol", 3, 0, 14))).toBe("1.4–2.1 mg");
  });
});

describe("volume-dosed entries", () => {
  it("computes lactulose from mL per kg", () => {
    expect(amount(dose("lactulose", 4, 0, 16))).toBe("8 ml");
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
    const outcome = dose("cetirizine", 3, 0, 14);
    if (outcome.kind === "dose") expect(outcome.basis).toBeUndefined();
  });

  it("states the mg/kg basis for paracetamol", () => {
    const outcome = dose("paracetamol", 2, 0, 14);
    if (outcome.kind === "dose") expect(outcome.basis).toBe("15 mg/kg × 14 kg");
  });

  it("states the mL/kg basis for lactulose", () => {
    const outcome = dose("lactulose", 4, 0, 16);
    if (outcome.kind === "dose") expect(outcome.basis).toBe("0.5 mL/kg × 16 kg");
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

  // Rounding mg to one decimal would print triprolidine's published 0.313 mg
  // as 0.3, so the screen would disagree with the printed table a clinician
  // is checking it against.
  it("keeps the published precision on milligrams", () => {
    expect(roundMg(0.313)).toBe(0.313);
    expect(formatAmount(0.313, undefined, "mg")).toBe("0.313 mg");
    expect(formatAmount(0.938, undefined, "mg")).toBe("0.938 mg");
  });

  it("renders the published small doses exactly as the source prints them", () => {
    expect(amount(dose("triprolidine", 1, 0, 10))).toBe("0.313 mg");
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
