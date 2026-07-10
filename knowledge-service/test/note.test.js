import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseNoteFile, buildEmbedInput, hashContent } from "../src/note.js";

const SAMPLE = `---
drug: Amoxicillin
indication: Acute Otitis Media
patient_group: Paediatric
source: NAG 2024
tags: [antibiotic, dosing]
---
Amoxicillin 80-90 mg/kg/day PO divided BD x 5-7 days.
`;

test("parseNoteFile extracts frontmatter + verbatim body", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vault-test-"));
  const file = path.join(dir, "note.md");
  await writeFile(file, SAMPLE, "utf8");

  const parsed = await parseNoteFile(file);
  assert.equal(parsed.drug, "Amoxicillin");
  assert.equal(parsed.indication, "Acute Otitis Media");
  assert.equal(parsed.patient_group, "Paediatric");
  assert.equal(parsed.source, "NAG 2024");
  assert.deepEqual(parsed.tags, ["antibiotic", "dosing"]);
  assert.equal(parsed.body, "Amoxicillin 80-90 mg/kg/day PO divided BD x 5-7 days.");
  assert.equal(parsed.hash, hashContent(SAMPLE));

  await rm(dir, { recursive: true, force: true });
});

test("parseNoteFile defaults patient_group to Any when absent", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vault-test-"));
  const file = path.join(dir, "note.md");
  await writeFile(file, "---\ndrug: X\n---\nBody text.", "utf8");

  const parsed = await parseNoteFile(file);
  assert.equal(parsed.patient_group, "Any");

  await rm(dir, { recursive: true, force: true });
});

test("buildEmbedInput combines structured fields and body", () => {
  const input = buildEmbedInput({
    drug: "Amoxicillin",
    indication: "Acute Otitis Media",
    patient_group: "Paediatric",
    tags: ["antibiotic"],
    body: "Dose text here.",
  });
  assert.match(input, /Drug: Amoxicillin/);
  assert.match(input, /Indication: Acute Otitis Media/);
  assert.match(input, /Patient group: Paediatric/);
  assert.match(input, /Tags: antibiotic/);
  assert.match(input, /Dose text here\./);
});

test("hashContent is stable for identical content", () => {
  assert.equal(hashContent("abc"), hashContent("abc"));
  assert.notEqual(hashContent("abc"), hashContent("abd"));
});
