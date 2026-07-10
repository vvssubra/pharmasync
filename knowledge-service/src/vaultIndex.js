// Builds and maintains the in-memory embedding index over the Obsidian vault,
// watches for changes, and answers dose-lookup queries by cosine similarity.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import { glob } from "node:fs/promises";
import { parseNoteFile, buildEmbedInput } from "./note.js";
import { cosineSimilarity } from "./cosine.js";

// Patient-group compatibility: exact match or "Any" on either side gets full
// weight; a mismatch (e.g. query wants Paediatric, note is Adult-only) is
// down-weighted rather than excluded — some notes apply broadly regardless
// of the frontmatter label, so we still surface them lower in the ranking.
const GROUP_MISMATCH_PENALTY = 0.15;

export function createVaultIndex({ vaultPath, cachePath, ollama, log = console }) {
  /** @type {Map<string, object>} keyed by file path */
  let notes = new Map();

  async function loadCache() {
    try {
      const raw = await readFile(cachePath, "utf8");
      const entries = JSON.parse(raw);
      for (const entry of entries) notes.set(entry.file, entry);
      log.info?.(`[vault] loaded ${entries.length} cached note(s) from ${cachePath}`);
    } catch {
      // No cache yet — first run will build it from scratch.
    }
  }

  async function saveCache() {
    const entries = Array.from(notes.values());
    await writeFile(cachePath, JSON.stringify(entries), "utf8");
  }

  async function listMarkdownFiles() {
    const found = [];
    for await (const entry of glob("**/*.md", { cwd: vaultPath })) {
      found.push(path.join(vaultPath, entry));
    }
    return found;
  }

  async function indexFile(filePath) {
    try {
      const parsed = await parseNoteFile(filePath);
      const existing = notes.get(filePath);
      if (existing && existing.hash === parsed.hash) return; // unchanged — skip re-embed
      const embedding = await ollama.embed(buildEmbedInput(parsed));
      notes.set(filePath, { ...parsed, embedding });
      log.info?.(`[vault] indexed ${path.relative(vaultPath, filePath)}`);
    } catch (err) {
      log.error?.(`[vault] failed to index ${filePath}: ${err.message}`);
    }
  }

  function removeFile(filePath) {
    if (notes.delete(filePath)) {
      log.info?.(`[vault] removed ${path.relative(vaultPath, filePath)}`);
    }
  }

  async function buildIndex() {
    await loadCache();
    const files = await listMarkdownFiles();
    const current = new Set(files);
    for (const existingPath of notes.keys()) {
      if (!current.has(existingPath)) removeFile(existingPath);
    }
    for (const file of files) await indexFile(file);
    await saveCache();
  }

  function watch(onChange) {
    const watcher = chokidar.watch(path.join(vaultPath, "**/*.md"), {
      ignoreInitial: true,
    });
    const handleChange = async (filePath) => {
      await indexFile(filePath);
      await saveCache();
      onChange?.();
    };
    const handleUnlink = async (filePath) => {
      removeFile(filePath);
      await saveCache();
      onChange?.();
    };
    watcher.on("add", handleChange).on("change", handleChange).on("unlink", handleUnlink);
    return watcher;
  }

  async function query(queryText, { patientGroup, maxMatches, threshold } = {}) {
    const queryEmbedding = await ollama.embed(queryText);
    const scored = Array.from(notes.values()).map((note) => {
      let score = cosineSimilarity(queryEmbedding, note.embedding);
      const notePGroup = note.patient_group || "Any";
      const groupsCompatible =
        !patientGroup || notePGroup === "Any" || patientGroup === "Any" || notePGroup === patientGroup;
      if (!groupsCompatible) score -= GROUP_MISMATCH_PENALTY;
      return { note, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const minScore = threshold ?? 0.5;
    const top = scored.filter((s) => s.score >= minScore).slice(0, maxMatches ?? 3);
    return top.map(({ note, score }) => ({
      drug: note.drug,
      indication: note.indication,
      patient_group: note.patient_group,
      source: note.source,
      body: note.body,
      score: Math.round(score * 1000) / 1000,
    }));
  }

  function noteCount() {
    return notes.size;
  }

  return { buildIndex, watch, query, noteCount };
}
