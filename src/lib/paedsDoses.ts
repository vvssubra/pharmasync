// src/lib/paedsDoses.ts
//
// The paediatric dose table. THIS FILE IS CLINICAL DATA, NOT LOGIC — every
// entry carries the source text verbatim above it so it can be checked line by
// line against MIMS without reading any code.
//
// Conventions:
//  - Age bands are whole months, minMonths inclusive, maxMonths exclusive.
//    "2-5 years" means aged 2 up to the 6th birthday → [24, 72).
//  - Rules are matched in the order listed, so where the published bands
//    overlap the first (younger) one wins.
//  - Where a source publishes a gap, it is reproduced rather than filled; the
//    calculator then reports "no band published" instead of inventing a dose.
//
// Dexchlorpheniramine and acetylcysteine are deliberately absent: the source
// paste did not carry a usable concentration for either.

import type { Drug } from "./paedsDose";

export const PAEDS_DRUGS: Drug[] = [
  // ── FEVER ────────────────────────────────────────────────────────────────
  {
    // MIMS  3-5 months: 60mg Q4H-Q6H / 6-23 months: 120mg Q4H-Q6H /
    //       2-3 years: 180mg / 4-5 years: 240mg / 6-7 years: 240-250mg /
    //       8-9 years: 360-375mg / 10-11 years: 480-500mg  (all Q4H-Q6H)
    id: "paracetamol",
    frequentlyUsed: true,
    name: "Paracetamol",
    category: "fever",
    preparations: [
      { label: "120mg/5ml" },
      { label: "250mg/5ml" },
    ],
    mims: [
      { kind: "fixed", minMonths: 3, maxMonths: 6, mgMin: 60, freq: "Q4H–Q6H" },
      { kind: "fixed", minMonths: 6, maxMonths: 24, mgMin: 120, freq: "Q4H–Q6H" },
      { kind: "fixed", minMonths: 24, maxMonths: 48, mgMin: 180, freq: "Q4H–Q6H" },
      { kind: "fixed", minMonths: 48, maxMonths: 72, mgMin: 240, freq: "Q4H–Q6H" },
      { kind: "fixed", minMonths: 72, maxMonths: 96, mgMin: 240, mgMax: 250, freq: "Q4H–Q6H" },
      { kind: "fixed", minMonths: 96, maxMonths: 120, mgMin: 360, mgMax: 375, freq: "Q4H–Q6H" },
      { kind: "fixed", minMonths: 120, maxMonths: 144, mgMin: 480, mgMax: 500, freq: "Q4H–Q6H" },
    ],
  },
  {
    // MIMS  >6 months: 5-10mg/kg TDS or QID
    id: "ibuprofen",
    name: "Ibuprofen",
    category: "fever",
    preparations: [{ label: "100mg/5ml" }],
    mims: [{ kind: "perKg", minMonths: 6, mgPerKgMin: 5, mgPerKgMax: 10, freq: "TDS or QID" }],
  },

  // ── ANTIHISTAMINE ────────────────────────────────────────────────────────
  {
    // MIMS  0.5-2 years: 15mg BD / 2-11 years: 30mg BD /
    //       ≥12 years: 60mg BD or 180mg OD
    id: "fexofenadine",
    name: "Fexofenadine",
    category: "antihistamine",
    preparations: [{ label: "30mg/5ml" }],
    mims: [
      { kind: "fixed", minMonths: 6, maxMonths: 24, mgMin: 15, freq: "BD" },
      { kind: "fixed", minMonths: 24, maxMonths: 144, mgMin: 30, freq: "BD" },
      { kind: "fixed", minMonths: 144, mgMin: 60, freq: "BD", note: "or 180 mg OD" },
    ],
  },
  {
    // MIMS  1-5 years: 1.25mg OD / 6-11 years: 2.5mg OD / ≥12 years: 5mg OD
    id: "desloratadine",
    name: "Desloratadine",
    category: "antihistamine",
    preparations: [{ label: "2.5mg/5ml" }],
    mims: [
      { kind: "fixed", minMonths: 12, maxMonths: 72, mgMin: 1.25, freq: "OD" },
      { kind: "fixed", minMonths: 72, maxMonths: 144, mgMin: 2.5, freq: "OD" },
      { kind: "fixed", minMonths: 144, mgMin: 5, freq: "OD" },
    ],
  },
  {
    // MIMS  2-12 years (<30kg): 5mg OD / 2-11 years (>30kg): 10mg OD
    id: "loratadine",
    name: "Loratadine",
    category: "antihistamine",
    preparations: [{ label: "5mg/5ml" }],
    caution: "MIMS gives the under-30kg band as 2–12 years but the over-30kg band as 2–11; reproduced as published.",
    mims: [
      { kind: "fixed", minMonths: 24, maxMonths: 156, maxKg: 30, mgMin: 5, freq: "OD" },
      { kind: "fixed", minMonths: 24, maxMonths: 144, minKg: 30, mgMin: 10, freq: "OD" },
    ],
  },
  {
    // MIMS  2-6 years: 2.5mg BD / 6-12 years: 5mg BD
    id: "cetirizine",
    name: "Cetirizine",
    category: "antihistamine",
    preparations: [{ label: "5mg/5ml" }],
    caution: "MIMS bands overlap at 6 years; the younger band is applied.",
    mims: [
      { kind: "fixed", minMonths: 24, maxMonths: 84, mgMin: 2.5, freq: "BD" },
      { kind: "fixed", minMonths: 72, maxMonths: 156, mgMin: 5, freq: "BD" },
    ],
  },
  {
    // MIMS  2-5 years: 1mg q4-6h / 6-12 years: 2mg q4-6h
    id: "chlorpheniramine",
    frequentlyUsed: true,
    name: "Chlorpheniramine",
    category: "antihistamine",
    preparations: [{ label: "2mg/5ml" }],
    mims: [
      { kind: "fixed", minMonths: 24, maxMonths: 72, mgMin: 1, freq: "Q4H–Q6H" },
      { kind: "fixed", minMonths: 72, maxMonths: 156, mgMin: 2, freq: "Q4H–Q6H" },
    ],
  },
  {
    // MIMS  2-5 years: 5mg TDS / 6-10 years: 10mg BD / >10 years: 25mg OD or BD
    id: "promethazine",
    name: "Promethazine",
    category: "antihistamine",
    preparations: [{ label: "5mg/5ml" }],
    mims: [
      { kind: "fixed", minMonths: 24, maxMonths: 72, mgMin: 5, freq: "TDS" },
      { kind: "fixed", minMonths: 72, maxMonths: 132, mgMin: 10, freq: "BD" },
      { kind: "fixed", minMonths: 132, mgMin: 25, freq: "OD or BD" },
    ],
  },
  {
    // MIMS  4months-<2 years: 0.313mg QID / 2-<4 years: 0.625mg QID /
    //       4-<6 years: 0.938mg QID / 6-<12 years: 1.25mg QID
    id: "triprolidine",
    name: "Triprolidine",
    category: "antihistamine",
    preparations: [{ label: "1.25mg/5ml" }],
    mims: [
      { kind: "fixed", minMonths: 4, maxMonths: 24, mgMin: 0.313, freq: "QID" },
      { kind: "fixed", minMonths: 24, maxMonths: 48, mgMin: 0.625, freq: "QID" },
      { kind: "fixed", minMonths: 48, maxMonths: 72, mgMin: 0.938, freq: "QID" },
      { kind: "fixed", minMonths: 72, maxMonths: 144, mgMin: 1.25, freq: "QID" },
    ],
  },

  // ── DECONGESTANT ─────────────────────────────────────────────────────────
  {
    // MIMS  Not recommended < 12 years old
    id: "pseudoephedrine",
    name: "Pseudoephedrine",
    category: "decongestant",
    preparations: [{ label: "30mg/5ml" }],
    mims: [{ kind: "notRecommended", belowMonths: 144, note: "Not recommended under 12 years" }],
  },
  {
    // MIMS  Not recommended < 12 years old
    id: "phenylephrine",
    name: "Phenylephrine",
    category: "decongestant",
    preparations: [{ label: "5mg/5ml" }],
    mims: [{ kind: "notRecommended", belowMonths: 144, note: "Not recommended under 12 years" }],
  },

  // ── WET COUGH ────────────────────────────────────────────────────────────
  {
    // MIMS  2-5 years: 4mg BD / 6-11 years: 8mg TDS
    id: "bromhexine",
    frequentlyUsed: true,
    name: "Bromhexine",
    category: "wetCough",
    preparations: [{ label: "4mg/5ml" }],
    mims: [
      { kind: "fixed", minMonths: 24, maxMonths: 72, mgMin: 4, freq: "BD" },
      { kind: "fixed", minMonths: 72, maxMonths: 144, mgMin: 8, freq: "TDS" },
    ],
  },
  {
    // MIMS  2-5 years: 100mg BD / 6-12 years: 100mg or 250mg TDS
    id: "carbocisteine",
    name: "Carbocisteine",
    category: "wetCough",
    preparations: [{ label: "100mg/5ml" }],
    mims: [
      { kind: "fixed", minMonths: 24, maxMonths: 72, mgMin: 100, freq: "BD" },
      { kind: "fixed", minMonths: 72, maxMonths: 156, mgMin: 100, freq: "TDS", note: "or 250 mg TDS" },
    ],
  },
  {
    // MIMS  <6 months: 3mg BD / 7-11 months: 6mg BD / 1-2 years: 7.5mg BD /
    //       2-5 years: 7.5mg TDS / 6-11 years: 15mg TDS
    id: "ambroxol",
    name: "Ambroxol",
    category: "wetCough",
    preparations: [{ label: "3mg/ml" }],
    caution: "MIMS jumps from \"<6 months\" to \"7-11 months\"; infants of exactly 6 months fall in no published band.",
    mims: [
      { kind: "fixed", maxMonths: 6, mgMin: 3, freq: "BD" },
      { kind: "fixed", minMonths: 7, maxMonths: 12, mgMin: 6, freq: "BD" },
      { kind: "fixed", minMonths: 12, maxMonths: 24, mgMin: 7.5, freq: "BD" },
      { kind: "fixed", minMonths: 24, maxMonths: 72, mgMin: 7.5, freq: "TDS" },
      { kind: "fixed", minMonths: 72, maxMonths: 144, mgMin: 15, freq: "TDS" },
    ],
  },
  {
    // MIMS  6-12 years: 100mg QID
    id: "guaifenesin",
    name: "Guaifenesin",
    category: "wetCough",
    preparations: [{ label: "50mg/5ml" }],
    mims: [{ kind: "fixed", minMonths: 72, maxMonths: 156, mgMin: 100, freq: "QID" }],
  },
  {
    // MIMS  2-5 years: 6.25mg QID / 6-11 years: 12.5-25mg QID /
    //       >12 years: 25-50mg TDS or QID
    id: "diphenhydramine",
    frequentlyUsed: true,
    name: "Diphenhydramine",
    category: "wetCough",
    preparations: [
      { label: "12.5mg/5ml" },
      { label: "14mg/5ml" },
    ],
    caution: "MIMS runs to 11 years then resumes above 12; 12-year-olds fall in no published band.",
    mims: [
      { kind: "fixed", minMonths: 24, maxMonths: 72, mgMin: 6.25, freq: "QID" },
      { kind: "fixed", minMonths: 72, maxMonths: 144, mgMin: 12.5, mgMax: 25, freq: "QID" },
      { kind: "fixed", minMonths: 156, mgMin: 25, mgMax: 50, freq: "TDS or QID" },
    ],
  },

  // ── DRY COUGH ────────────────────────────────────────────────────────────
  {
    // MIMS  Not recommended < 12 years old
    id: "dextromethorphan",
    name: "Dextromethorphan",
    category: "dryCough",
    preparations: [{ label: "15mg/5ml" }],
    mims: [{ kind: "notRecommended", belowMonths: 144, note: "Not recommended under 12 years" }],
  },
  {
    // MIMS  6-12 years: 2-5mg TDS or QID
    id: "pholcodine",
    name: "Pholcodine",
    category: "dryCough",
    preparations: [{ label: "10mg/5ml" }],
    mims: [{ kind: "fixed", minMonths: 72, maxMonths: 156, mgMin: 2, mgMax: 5, freq: "TDS or QID" }],
  },

  // ── MISCELLANEOUS ────────────────────────────────────────────────────────
  {
    // MIMS  2-6 years: 1-2mg TDS or QID / >6-12 years: 2mg TDS or QID
    id: "salbutamol",
    frequentlyUsed: true,
    name: "Salbutamol",
    category: "misc",
    preparations: [{ label: "2mg/5ml" }],
    mims: [
      { kind: "fixed", minMonths: 24, maxMonths: 84, mgMin: 1, mgMax: 2, freq: "TDS or QID" },
      { kind: "fixed", minMonths: 84, maxMonths: 156, mgMin: 2, freq: "TDS or QID" },
    ],
  },
  {
    // MIMS  <1 year: up to 5ml daily / 1-6 years: 5-10ml daily /
    //       7-14 years: 10-15ml daily
    id: "lactulose",
    frequentlyUsed: true,
    name: "Lactulose",
    category: "misc",
    // Dosed by volume, so no mg conversion is offered.
    preparations: [{ label: "3.335g/5ml" }],
    mims: [
      { kind: "volume", maxMonths: 12, mlMin: 5, freq: "daily", note: "up to" },
      { kind: "volume", minMonths: 12, maxMonths: 84, mlMin: 5, mlMax: 10, freq: "daily" },
      { kind: "volume", minMonths: 84, maxMonths: 180, mlMin: 10, mlMax: 15, freq: "daily" },
    ],
  },
];

export const DISCLAIMER =
  "The information provided should not be used for diagnosing or treating a health problem or disease, " +
  "and those seeking personal medical advice should consult with a licensed physician. Always seek the " +
  "advice of your doctor or other qualified health provider regarding a medical condition.";
