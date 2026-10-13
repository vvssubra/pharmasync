// supabase/functions/_shared/nagCorpus.ts
// Sectioned NAG 2024 guideline text — the ONLY source the AI dose lookup in
// antibiotic-suggest may answer from. The section data itself lives in
// nagCorpus.generated.ts, built from docs/nag-section-*.md by
// scripts/build-nag-corpus.ts (the edge bundle cannot read outside
// supabase/functions/, so the markdown is compiled in). src/test/nagCorpus.test.ts
// fails if the generated file is stale against the docs.
//
// This module is pure (no Deno or npm imports) so Vitest can exercise the
// splitter and the quote verifier directly.

export type CorpusGroup = "Adult" | "Paediatric";

export interface NagSection {
  /** Stable id the model must cite, e.g. "a-respiratory/1-3". */
  id: string;
  /** Human breadcrumb shown to the doctor, e.g. "NAG Section A (Adult) — Respiratory › 1. Community Acquired Pneumonia (CAP) › 1.3 Inpatient". */
  path: string;
  group: CorpusGroup;
  /** Section body (markdown), without its heading line. */
  text: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "section";
}

function cleanHeading(s: string): string {
  return s.replace(/\\\*/g, "*").replace(/\s+/g, " ").trim();
}

const SKIP_HEADING = /^references\b/i;

/**
 * Splits one docs/nag-section-*.md file into sections at every heading.
 * Each section's text is only the body between its heading and the next
 * heading (any level); the path carries the ancestor headings so a deep
 * section is still self-describing. Empty bodies and reference lists are
 * dropped — they hold no dosing a regimen could quote.
 */
export function splitNagMarkdown(fileKey: string, markdown: string): NagSection[] {
  const group: CorpusGroup = fileKey.startsWith("b-") ? "Paediatric" : "Adult";
  const lines = markdown.split(/\r?\n/);
  const stack: { level: number; title: string }[] = [];
  const sections: NagSection[] = [];
  const usedIds = new Set<string>();
  let body: string[] = [];
  let skipping = false;
  let docTitle: string | null = null;

  const flush = () => {
    const text = body.join("\n").replace(/^\s*---\s*$/gm, "").trim();
    body = [];
    if (skipping || !text || stack.length === 0) return;
    // A later level-1 heading (Section B's "B9.", "B10." …) replaces the doc
    // title on the stack; keep the title in the breadcrumb so the doctor can
    // always see which NAG section a quote came from.
    const titles = stack.map((h) => h.title);
    if (docTitle && titles[0] !== docTitle) titles.unshift(docTitle.split(" — ")[0]);
    const path = titles.join(" › ");
    // The document's own title heading is left out of ids (it is the file);
    // every other level contributes its leading token — "1.3 Inpatient …"
    // becomes "1-3" — so ids stay short and readable for the model to cite.
    const idParts = stack.filter((h) => h.title !== docTitle);
    let id = `${fileKey}/${idParts.map((h) => slug(h.title.split(" ")[0] ?? h.title)).join("/") || "intro"}`;
    if (usedIds.has(id)) id = `${fileKey}/${idParts.map((h) => slug(h.title)).join("/") || "intro"}`;
    let n = 2;
    const base = id;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    sections.push({ id, path, group, text });
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) {
      body.push(line);
      continue;
    }
    flush();
    const level = m[1].length;
    const title = cleanHeading(m[2]);
    if (docTitle === null && level === 1) docTitle = title;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, title });
    skipping = stack.some((h) => SKIP_HEADING.test(h.title));
  }
  flush();
  return sections;
}

/**
 * Canonical form used on BOTH sides of the verbatim check: markdown emphasis
 * and escapes removed, dash variants unified, whitespace collapsed, case
 * folded. Deliberately nothing looser — a quote that differs in any digit,
 * unit or word from the guideline text must fail.
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/\\/g, "")
    .replace(/\*\*|\*/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^\s*[-•]\s+/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Renders the corpus for the system prompt. Order and bytes are stable so the prompt cache hits. */
export function renderCorpus(sections: NagSection[]): string {
  return sections
    .map((s) => `<section id="${s.id}" group="${s.group}" path="${s.path.replace(/"/g, "'")}">\n${s.text}\n</section>`)
    .join("\n\n");
}
