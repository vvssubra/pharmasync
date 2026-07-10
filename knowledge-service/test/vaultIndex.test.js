import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createVaultIndex } from "../src/vaultIndex.js";

// Deterministic bag-of-words fake embedding — no real Ollama needed for unit
// tests. Similarity reflects shared vocabulary, which is enough to exercise
// ranking/threshold/no-match/patient-group logic.
const VOCAB = [
  "ear", "infection", "child", "paediatric", "amoxicillin", "otitis",
  "urine", "urinary", "burning", "adult", "nitrofurantoin", "bladder",
];
function fakeEmbed(text) {
  const lower = text.toLowerCase();
  return VOCAB.map((word) => (lower.includes(word) ? 1 : 0));
}
function makeFakeOllama() {
  let calls = 0;
  return {
    embed: async (text) => {
      calls++;
      return fakeEmbed(text);
    },
    isUp: async () => true,
    get callCount() {
      return calls;
    },
  };
}

async function writeNote(dir, filename, frontmatter, body) {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => (Array.isArray(v) ? `${k}: [${v.join(", ")}]` : `${k}: ${v}`))
    .join("\n");
  await writeFile(path.join(dir, filename), `---\n${fm}\n---\n${body}\n`, "utf8");
}

async function setupVault() {
  const dir = await mkdtemp(path.join(tmpdir(), "vault-index-test-"));
  await writeNote(
    dir,
    "aom.md",
    { drug: "Amoxicillin", indication: "Acute Otitis Media", patient_group: "Paediatric", source: "NAG" },
    "Amoxicillin dose for ear infection in a child.",
  );
  await writeNote(
    dir,
    "uti.md",
    { drug: "Nitrofurantoin", indication: "Urinary Tract Infection", patient_group: "Adult", source: "NAG" },
    "Nitrofurantoin dose for adult bladder urinary infection with burning.",
  );
  return dir;
}

test("query returns the best-matching note verbatim above threshold", async () => {
  const dir = await setupVault();
  const ollama = makeFakeOllama();
  const cachePath = path.join(dir, "cache.json");
  const index = createVaultIndex({ vaultPath: dir, cachePath, ollama, log: { info() {}, error() {} } });
  await index.buildIndex();
  assert.equal(index.noteCount(), 2);

  const results = await index.query("ear infection in a child", { threshold: 0.3, maxMatches: 3 });
  assert.ok(results.length >= 1);
  assert.equal(results[0].drug, "Amoxicillin");
  assert.match(results[0].body, /Amoxicillin dose for ear infection/);

  await rm(dir, { recursive: true, force: true });
});

test("query passes through example_dose when the note frontmatter has one", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vault-index-test-"));
  await writeNote(
    dir,
    "aom.md",
    {
      drug: "Amoxicillin",
      indication: "Acute Otitis Media",
      patient_group: "Paediatric",
      source: "NAG",
      example_dose: "Amoxicillin 80mg/kg/day PO BD x 5 days",
    },
    "Amoxicillin dose for ear infection in a child.",
  );
  const ollama = makeFakeOllama();
  const cachePath = path.join(dir, "cache.json");
  const index = createVaultIndex({ vaultPath: dir, cachePath, ollama, log: { info() {}, error() {} } });
  await index.buildIndex();

  const results = await index.query("ear infection in a child", { threshold: 0.3, maxMatches: 3 });
  assert.equal(results[0].example_dose, "Amoxicillin 80mg/kg/day PO BD x 5 days");

  await rm(dir, { recursive: true, force: true });
});

test("query returns empty example_dose when the note has none", async () => {
  const dir = await setupVault();
  const ollama = makeFakeOllama();
  const cachePath = path.join(dir, "cache.json");
  const index = createVaultIndex({ vaultPath: dir, cachePath, ollama, log: { info() {}, error() {} } });
  await index.buildIndex();

  const results = await index.query("ear infection in a child", { threshold: 0.3, maxMatches: 3 });
  assert.equal(results[0].example_dose, "");

  await rm(dir, { recursive: true, force: true });
});

test("query returns no matches when nothing clears the threshold", async () => {
  const dir = await setupVault();
  const ollama = makeFakeOllama();
  const cachePath = path.join(dir, "cache.json");
  const index = createVaultIndex({ vaultPath: dir, cachePath, ollama, log: { info() {}, error() {} } });
  await index.buildIndex();

  const results = await index.query("completely unrelated nonsense query", { threshold: 0.9 });
  assert.deepEqual(results, []);

  await rm(dir, { recursive: true, force: true });
});

test("patient_group mismatch is down-weighted relative to a matching group", async () => {
  const dir = await setupVault();
  const ollama = makeFakeOllama();
  const cachePath = path.join(dir, "cache.json");
  const index = createVaultIndex({ vaultPath: dir, cachePath, ollama, log: { info() {}, error() {} } });
  await index.buildIndex();

  const paediatricQuery = await index.query("ear infection in a child", {
    threshold: 0,
    patientGroup: "Paediatric",
  });
  const adultQuery = await index.query("ear infection in a child", {
    threshold: 0,
    patientGroup: "Adult",
  });
  const paediatricScore = paediatricQuery.find((r) => r.drug === "Amoxicillin").score;
  const adultScore = adultQuery.find((r) => r.drug === "Amoxicillin").score;
  assert.ok(paediatricScore > adultScore, "matching patient_group should score higher than mismatched");

  await rm(dir, { recursive: true, force: true });
});

test("rebuilding the index from cache skips re-embedding unchanged notes", async () => {
  const dir = await setupVault();
  const ollama = makeFakeOllama();
  const cachePath = path.join(dir, "cache.json");

  const index1 = createVaultIndex({ vaultPath: dir, cachePath, ollama, log: { info() {}, error() {} } });
  await index1.buildIndex();
  const firstCallCount = ollama.callCount;
  assert.ok(firstCallCount >= 2); // one embed per note

  const index2 = createVaultIndex({ vaultPath: dir, cachePath, ollama, log: { info() {}, error() {} } });
  await index2.buildIndex();
  assert.equal(ollama.callCount, firstCallCount, "unchanged notes should not be re-embedded after cache reload");
  assert.equal(index2.noteCount(), 2);

  await rm(dir, { recursive: true, force: true });
});

test("removing a note file drops it from the index on rebuild", async () => {
  const dir = await setupVault();
  const ollama = makeFakeOllama();
  const cachePath = path.join(dir, "cache.json");

  const index = createVaultIndex({ vaultPath: dir, cachePath, ollama, log: { info() {}, error() {} } });
  await index.buildIndex();
  assert.equal(index.noteCount(), 2);

  await rm(path.join(dir, "uti.md"));
  const index2 = createVaultIndex({ vaultPath: dir, cachePath, ollama, log: { info() {}, error() {} } });
  await index2.buildIndex();
  assert.equal(index2.noteCount(), 1);

  await rm(dir, { recursive: true, force: true });
});
