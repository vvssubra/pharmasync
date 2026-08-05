// Diagnosis picker seed data for the antibiotic request form. Labels only —
// nothing here drives dosing or NAG pathway matching (that stays
// checklist-only, see matchPathwayDetailed in nagPathways.ts). This is a
// typing shortcut, not a clinical decision.
import { NAG_PATHWAYS } from "./nagPathways";

export interface DiagnosisOption {
  label: string;
  keywords: string[];
}

// Derived from NAG_PATHWAYS rather than retyped, so this list can never
// drift from the pathway data — an alias added there (e.g. a new synonym
// for AOM) shows up here automatically.
export const NAG_DIAGNOSIS_OPTIONS: DiagnosisOption[] = NAG_PATHWAYS.map((p) => ({
  label: p.indication,
  keywords: p.aliases,
}));

// Common non-NAG diagnoses that still get antibiotics in a klinik kesihatan.
// Curated shortcuts only — no dosing or pathway claim attached; anything not
// on this list is still fully enterable as free text.
export const COMMON_DIAGNOSES: DiagnosisOption[] = [
  { label: "Dental Abscess", keywords: ["dental abscess", "tooth abscess"] },
  { label: "Infected Wound", keywords: ["infected wound", "wound infection"] },
  { label: "Post-op Wound Infection", keywords: ["post-op wound infection", "surgical site infection", "ssi"] },
  { label: "Otitis Externa", keywords: ["otitis externa", "ear canal infection", "swimmer's ear"] },
  { label: "Boil / Abscess", keywords: ["boil", "abscess", "furuncle"] },
  { label: "Paronychia", keywords: ["paronychia", "nail infection"] },
  { label: "Animal Bite Wound", keywords: ["animal bite", "dog bite", "cat bite"] },
  { label: "Infected Diabetic Foot Ulcer", keywords: ["diabetic foot ulcer", "infected foot ulcer", "diabetic foot infection"] },
  { label: "Mastitis", keywords: ["mastitis", "breast infection"] },
  { label: "Bacterial Conjunctivitis", keywords: ["bacterial conjunctivitis", "conjunctivitis", "pink eye"] },
  { label: "Pyelonephritis", keywords: ["pyelonephritis", "kidney infection", "upper uti"] },
  { label: "Acute Exacerbation of COPD", keywords: ["copd exacerbation", "acute exacerbation of copd", "aecopd"] },
  { label: "Bacterial Vaginosis", keywords: ["bacterial vaginosis", "bv"] },
  { label: "Pelvic Inflammatory Disease", keywords: ["pelvic inflammatory disease", "pid"] },
  { label: "Enteric Fever", keywords: ["enteric fever", "typhoid"] },
  { label: "Leptospirosis", keywords: ["leptospirosis", "lepto"] },
  { label: "H. pylori Eradication", keywords: ["h. pylori", "h pylori", "helicobacter pylori"] },
  { label: "Secondary Skin Infection", keywords: ["secondary skin infection", "infected eczema", "infected dermatitis"] },
];

function matches(option: DiagnosisOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return option.label.toLowerCase().includes(q) || option.keywords.some((k) => k.toLowerCase().includes(q));
}

export function filterDiagnosisOptions(options: DiagnosisOption[], query: string): DiagnosisOption[] {
  return options.filter((o) => matches(o, query));
}
