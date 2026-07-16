// This file uses Deno's built-in test runner (not Vitest).
// Run with: deno test --no-check supabase/functions/_shared/nagRetrieval.test.ts

import { assertEquals, assert } from "./asserts.ts";
import { splitNagSections, selectNagSections } from "./nagRetrieval.ts";

const SAMPLE_NAG = `NATIONAL ANTIBIOTIC GUIDELINES 2024

GENERAL PRINCIPLES
Prescribe antibiotics only when a bacterial infection is likely.
Always check for drug allergies before prescribing.

1.1 COMMUNITY ACQUIRED PNEUMONIA
Adults: Amoxicillin 1g PO TDS x 5-7 days.
Children: Amoxicillin 90 mg/kg/day divided BD.
Severe cases: refer to hospital.

1.2 ACUTE OTITIS MEDIA
First line: Amoxicillin 80-90 mg/kg/day PO divided BD x 5-7 days.
Penicillin allergy: Azithromycin 10 mg/kg OD day 1, then 5 mg/kg.

2.1 ACUTE PHARYNGITIS
Use the Centor criteria. Score >= 3: Phenoxymethylpenicillin 500mg q6h.

3.1 URINARY TRACT INFECTION
Uncomplicated cystitis: Trimethoprim 200mg BD x 3 days.
`;

Deno.test("splitNagSections: splits on uppercase and numbered headings", () => {
  const sections = splitNagSections(SAMPLE_NAG);
  const headings = sections.map((s) => s.heading);
  assert(headings.includes("GENERAL PRINCIPLES"));
  assert(headings.includes("1.1 COMMUNITY ACQUIRED PNEUMONIA"));
  assert(headings.includes("2.1 ACUTE PHARYNGITIS"));
  assert(headings.includes("3.1 URINARY TRACT INFECTION"));
});

Deno.test("splitNagSections: section text contains its body lines", () => {
  const sections = splitNagSections(SAMPLE_NAG);
  const pneumonia = sections.find((s) => s.heading.includes("PNEUMONIA"))!;
  assert(pneumonia.text.includes("Amoxicillin 1g PO TDS"));
});

Deno.test("selectNagSections: ranks the matching condition's section first", () => {
  const sections = splitNagSections(SAMPLE_NAG);
  const result = selectNagSections(sections, ["community acquired pneumonia"]);
  assert(result.includes("COMMUNITY ACQUIRED PNEUMONIA"));
  assert(result.indexOf("PNEUMONIA") < (result.indexOf("PHARYNGITIS") + 1 || Infinity));
});

Deno.test("selectNagSections: synonym AOM finds the otitis media section", () => {
  const sections = splitNagSections(SAMPLE_NAG);
  const result = selectNagSections(sections, ["AOM in a child"]);
  assert(result.includes("ACUTE OTITIS MEDIA"));
});

Deno.test("selectNagSections: always appends general principles when budget allows", () => {
  const sections = splitNagSections(SAMPLE_NAG);
  const result = selectNagSections(sections, ["UTI"]);
  assert(result.includes("URINARY TRACT INFECTION"));
  assert(result.includes("GENERAL PRINCIPLES"));
});

Deno.test("selectNagSections: respects the character budget", () => {
  const sections = splitNagSections(SAMPLE_NAG);
  const result = selectNagSections(sections, ["pneumonia otitis pharyngitis uti"], 200);
  assert(result.length <= 200);
});

Deno.test("selectNagSections: no matching terms returns empty or principles only", () => {
  const sections = splitNagSections(SAMPLE_NAG);
  const result = selectNagSections(sections, ["zzz-unrelated-term"]);
  assertEquals(result.includes("PNEUMONIA"), false);
});
