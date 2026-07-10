// Parses a single Obsidian markdown note into a structured record.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import matter from "gray-matter";

export function hashContent(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

// Text fed to the embedding model — combines structured fields + body so
// matching considers drug/indication/tags as well as the free-text dose.
// Note: example_dose is deliberately excluded here — it's an authoring
// convenience for the "Use" button, not a matching signal.
export function buildEmbedInput({ drug, indication, patient_group, tags, body }) {
  const parts = [
    drug && `Drug: ${drug}`,
    indication && `Indication: ${indication}`,
    patient_group && `Patient group: ${patient_group}`,
    Array.isArray(tags) && tags.length ? `Tags: ${tags.join(", ")}` : null,
    body,
  ].filter(Boolean);
  return parts.join("\n");
}

export async function parseNoteFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  const { data, content } = matter(raw);
  const body = content.trim();
  return {
    file: filePath,
    drug: typeof data.drug === "string" ? data.drug.trim() : "",
    indication: typeof data.indication === "string" ? data.indication.trim() : "",
    patient_group: typeof data.patient_group === "string" ? data.patient_group.trim() : "Any",
    source: typeof data.source === "string" ? data.source.trim() : "",
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    example_dose: typeof data.example_dose === "string" ? data.example_dose.trim() : "",
    body,
    hash: hashContent(raw),
  };
}
