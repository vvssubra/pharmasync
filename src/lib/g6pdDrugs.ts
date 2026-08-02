// src/lib/g6pdDrugs.ts
//
// Drugs to avoid in G6PD deficiency, transcribed from the summary table
// (ver01032006, nomenclature per INN). THIS FILE IS CLINICAL DATA, NOT LOGIC.
//
// The two risk tiers come straight from the source's two columns, so a drug's
// tier is exactly as published. Pharmacological class is the source's own
// grouping and is presentational — a clinician asking "is this safe in G6PD"
// needs the drug and the tier, which is what the page leads with.
//
// Known gaps in the source paste, surfaced rather than filled:
//  - The definite column lists an "Others" class with no drugs against it.
//  - The possible column lists "Hormonal Contraceptives" and "Nitrates" with
//    no drugs against them.
//  - "Proadione" appears in the possible column between Colchicine and the
//    vitamin K substances with no class that clearly owns it, and is not a
//    name that resolves to a known INN. It is kept, marked unverified, rather
//    than filed under a guess or dropped.

export type G6pdRisk = "definite" | "possible";

export interface G6pdDrug {
  name: string;
  /** Alternative or proprietary name as the source prints it. */
  aka?: string;
  /** Sub-heading the source nests this drug under, e.g. "Sulfonamides". */
  family?: string;
  /** Qualifier the source attaches, e.g. "rare". */
  qualifier?: string;
  /** Something about this entry could not be resolved from the source. */
  unverified?: string;
}

export interface G6pdClass {
  name: string;
  risk: G6pdRisk;
  drugs: G6pdDrug[];
}

export const G6PD_CLASSES: G6pdClass[] = [
  // ── DEFINITE RISK OF HAEMOLYSIS ──────────────────────────────────────────
  {
    name: "Anthelmintics",
    risk: "definite",
    drugs: [
      { name: "ß-Naphthol" },
      { name: "Niridazole" },
      { name: "Stibophen" },
    ],
  },
  {
    name: "Antibiotics",
    risk: "definite",
    drugs: [
      { name: "Nitrofurantoin", family: "Nitrofurans" },
      { name: "Nitrofurazone", family: "Nitrofurans" },
      { name: "Ciprofloxacin", family: "Quinolones" },
      { name: "Moxifloxacin", family: "Quinolones" },
      { name: "Nalidixic acid", family: "Quinolones" },
      { name: "Norfloxacin", family: "Quinolones" },
      { name: "Ofloxacin", family: "Quinolones" },
      { name: "Chloramphenicol" },
      { name: "Co-trimoxazole", aka: "Sulfamethoxazole + Trimethoprim", family: "Sulfonamides" },
      { name: "Sulfacetamide", family: "Sulfonamides" },
      { name: "Sulfadiazine", family: "Sulfonamides" },
      { name: "Sulfadimidine", family: "Sulfonamides" },
      { name: "Sulfamethoxazole", family: "Sulfonamides" },
      { name: "Sulfanilamide", family: "Sulfonamides" },
      { name: "Sulfapyridine", family: "Sulfonamides" },
      { name: "Sulfasalazine", aka: "Salazosulfapyridine", family: "Sulfonamides" },
      { name: "Sulfisoxazole", aka: "Sulfafurazole", family: "Sulfonamides" },
    ],
  },
  {
    name: "Antimalarials",
    risk: "definite",
    drugs: [
      { name: "Mepacrine" },
      { name: "Pamaquine" },
      { name: "Pentaquine" },
      { name: "Primaquine" },
    ],
  },
  {
    name: "Antimethemoglobinaemic Agents",
    risk: "definite",
    drugs: [{ name: "Methylene blue" }],
  },
  {
    name: "Antimycobacterials",
    risk: "definite",
    drugs: [
      { name: "Dapsone" },
      { name: "Para-aminosalicylic acid" },
      { name: "Aldesulfone sodium", aka: "Sulfoxone", family: "Sulfones" },
      { name: "Glucosulfone", family: "Sulfones" },
      { name: "Thiazosulfone", family: "Sulfones" },
    ],
  },
  {
    name: "Antineoplastic Adjuncts",
    risk: "definite",
    drugs: [
      { name: "Doxorubicin" },
      { name: "Rasburicase" },
    ],
  },
  {
    name: "Genitourinary Analgesics",
    risk: "definite",
    drugs: [{ name: "Phenazopyridine", aka: "Pyridium" }],
  },

  // ── POSSIBLE RISK OF HAEMOLYSIS ──────────────────────────────────────────
  {
    name: "Analgesics",
    risk: "possible",
    drugs: [
      { name: "Acetylsalicylic acid", aka: "Aspirin" },
      { name: "Acetanilide" },
      { name: "Paracetamol", aka: "Acetaminophen" },
      { name: "Aminophenazone", aka: "Aminopyrine" },
      { name: "Dipyrone", aka: "Metamizole" },
      { name: "Phenacetin" },
      { name: "Phenazone", aka: "Antipyrine" },
      { name: "Phenylbutazone" },
      { name: "Tiaprofenic acid" },
    ],
  },
  {
    name: "Antibiotics",
    risk: "possible",
    drugs: [
      { name: "Furazolidone" },
      { name: "Streptomycin" },
      { name: "Sulfacytine", family: "Sulfonamides" },
      { name: "Sulfaguanidine", family: "Sulfonamides" },
      { name: "Sulfamerazine", family: "Sulfonamides" },
      { name: "Sulfamethoxypyridazole", family: "Sulfonamides" },
    ],
  },
  { name: "Anticonvulsants", risk: "possible", drugs: [{ name: "Phenytoin" }] },
  { name: "Antidiabetics", risk: "possible", drugs: [{ name: "Glibenclamide" }] },
  { name: "Antidotes", risk: "possible", drugs: [{ name: "Dimercaprol", aka: "BAL" }] },
  {
    name: "Antihistamines",
    risk: "possible",
    drugs: [
      { name: "Antazoline", aka: "Antistine" },
      { name: "Diphenhydramine" },
      { name: "Tripelennamine" },
    ],
  },
  {
    name: "Antihypertensives",
    risk: "possible",
    drugs: [{ name: "Hydralazine" }, { name: "Methyldopa" }],
  },
  {
    name: "Antimalarials",
    risk: "possible",
    drugs: [
      { name: "Chloroquine & derivatives" },
      { name: "Proguanil" },
      { name: "Pyrimethamine" },
      { name: "Quinidine" },
      { name: "Quinine" },
    ],
  },
  { name: "Antimycobacterials", risk: "possible", drugs: [{ name: "Isoniazid" }] },
  {
    name: "Antiparkinsonism Agents",
    risk: "possible",
    drugs: [
      { name: "Trihexyphenidyl", aka: "Benzhexol" },
      { name: "Dopamine", aka: "L-dopa" },
    ],
  },
  {
    name: "Cardiovascular Drugs",
    risk: "possible",
    drugs: [{ name: "Procainamide" }, { name: "Quinidine" }],
  },
  {
    name: "Diagnostic Agent for Cancer Detection",
    risk: "possible",
    drugs: [{ name: "Toluidine blue" }],
  },
  { name: "Gout Preparations", risk: "possible", drugs: [{ name: "Colchicine" }] },
  {
    name: "Vitamin K Substance",
    risk: "possible",
    drugs: [
      { name: "Menadione Na bisulfite" },
      { name: "Phytomenadione" },
    ],
  },
  {
    name: "Vitamins",
    risk: "possible",
    drugs: [{ name: "Ascorbic acid", aka: "Vit C", qualifier: "rare" }],
  },
  {
    name: "Others",
    risk: "possible",
    drugs: [
      { name: "Arsine" },
      { name: "Berberine", aka: "in Coptis chinensis" },
      { name: "Fava beans" },
      { name: "Naphthalene", aka: "in mothballs" },
      { name: "Para-aminobenzoic acid" },
      {
        name: "Proadione",
        unverified:
          "Listed in the source between Colchicine and the vitamin K substances with no class against it, and does not resolve to a known INN. Class unconfirmed — check the original table.",
      },
    ],
  },
];

export const G6PD_RISK_LABELS: Record<G6pdRisk, string> = {
  definite: "Definite risk of haemolysis",
  possible: "Possible risk of haemolysis",
};

export const G6PD_SOURCE_NOTE =
  "Nomenclature based on INN (International non-proprietary name). " +
  "Refer to www.g6pd.org for further information. Summary table ver01032006.";
