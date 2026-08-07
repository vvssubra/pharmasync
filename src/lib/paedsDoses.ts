// src/lib/paedsDoses.ts
//
// The paediatric dose table. THIS FILE IS CLINICAL DATA, NOT LOGIC — every
// entry carries the source text verbatim above it so it can be checked line by
// line against source without reading any code. "MIMS" entries are transcribed
// from the MIMS Malaysia label; "Clinic protocol" entries are the mg/kg (or
// mL/kg) figures the clinic doses by, sourced from Frank Shann Drug Doses.
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
    // Clinic protocol: 15mg/kg/dose Q4H-Q6H, from 3 months.
    id: "paracetamol",
    frequentlyUsed: true,
    name: "Paracetamol",
    category: "fever",
    preparations: [
      { label: "120mg/5ml" },
      { label: "250mg/5ml" },
    ],
    mims: [
      { kind: "perKg", minMonths: 3, mgPerKgMin: 15, freq: "Q4H–Q6H" },
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
    // Clinic protocol: 0.1mg/kg/dose Q4H-Q6H, from 2 years.
    id: "chlorpheniramine",
    frequentlyUsed: true,
    name: "Chlorpheniramine",
    category: "antihistamine",
    preparations: [{ label: "2mg/5ml" }],
    mims: [
      { kind: "perKg", minMonths: 24, mgPerKgMin: 0.1, freq: "Q4H–Q6H" },
    ],
  },
  {
    // Clinic protocol: 0.2-0.5mg/kg/dose TDS.
    id: "promethazine",
    name: "Promethazine",
    category: "antihistamine",
    preparations: [{ label: "5mg/5ml" }],
    mims: [
      { kind: "perKg", mgPerKgMin: 0.2, mgPerKgMax: 0.5, freq: "TDS" },
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
    // Not recommended under 12 years; clinic protocol above that is
    // 0.2mg/kg/dose TDS or QID, max 10mg.
    id: "phenylephrine",
    name: "Phenylephrine",
    category: "decongestant",
    preparations: [{ label: "5mg/5ml" }],
    mims: [
      { kind: "notRecommended", belowMonths: 144, note: "Not recommended under 12 years" },
      { kind: "perKg", mgPerKgMin: 0.2, maxMg: 10, freq: "TDS or QID", note: "max 10 mg" },
    ],
  },

  // ── WET COUGH ────────────────────────────────────────────────────────────
  {
    // Clinic protocol: 0.3mg/kg/dose. Source gives no frequency; none invented.
    id: "bromhexine",
    frequentlyUsed: true,
    name: "Bromhexine",
    category: "wetCough",
    preparations: [{ label: "4mg/5ml" }],
    mims: [
      { kind: "perKg", mgPerKgMin: 0.3, freq: "frequency not stated" },
    ],
  },
  {
    // Clinic protocol: 1-2mg/kg/dose TDS or QID.
    id: "diphenhydramine",
    frequentlyUsed: true,
    name: "Diphenhydramine",
    category: "wetCough",
    preparations: [
      { label: "12.5mg/5ml" },
      { label: "14mg/5ml" },
    ],
    mims: [
      { kind: "perKg", mgPerKgMin: 1, mgPerKgMax: 2, freq: "TDS or QID" },
    ],
  },

  // ── DRY COUGH ────────────────────────────────────────────────────────────
  {
    // Not recommended under 12 years; clinic protocol above that is
    // 0.2-0.4mg/kg/dose TDS or QID.
    id: "dextromethorphan",
    name: "Dextromethorphan",
    category: "dryCough",
    preparations: [{ label: "15mg/5ml" }],
    mims: [
      { kind: "notRecommended", belowMonths: 144, note: "Not recommended under 12 years" },
      { kind: "perKg", mgPerKgMin: 0.2, mgPerKgMax: 0.4, freq: "TDS or QID" },
    ],
  },

  // ── MISCELLANEOUS ────────────────────────────────────────────────────────
  {
    // Clinic protocol: 0.1-0.15mg/kg/dose QID.
    id: "salbutamol",
    frequentlyUsed: true,
    name: "Salbutamol",
    category: "misc",
    preparations: [{ label: "2mg/5ml" }],
    mims: [
      { kind: "perKg", mgPerKgMin: 0.1, mgPerKgMax: 0.15, freq: "QID" },
    ],
  },
  {
    // Clinic protocol: 0.5mL/kg/dose BD.
    id: "lactulose",
    frequentlyUsed: true,
    name: "Lactulose",
    category: "misc",
    preparations: [{ label: "3.335g/5ml" }],
    mims: [{ kind: "mlPerKg", mlPerKg: 0.5, freq: "BD" }],
  },
];

export const DISCLAIMER =
  "The information provided should not be used for diagnosing or treating a health problem or disease, " +
  "and those seeking personal medical advice should consult with a licensed physician. Always seek the " +
  "advice of your doctor or other qualified health provider regarding a medical condition.";
