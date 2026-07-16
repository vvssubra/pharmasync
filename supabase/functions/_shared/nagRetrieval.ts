// supabase/functions/_shared/nagRetrieval.ts
// The NAG document can be up to 500 KB (~125k tokens) — far beyond what the
// self-hosted 8B model can take. These helpers split it into sections and
// pick only the ones relevant to the current request, under a hard character
// budget, so the prompt always fits num_ctx.

export interface NagSection {
  heading: string;
  text: string;
}

// A heading is a short line that is either numbered ("3.1 Pharyngitis"),
// mostly uppercase ("ACUTE OTITIS MEDIA"), or a markdown heading.
const HEADING_RE = /^(#{1,4}\s+.+|\d+(?:\.\d+)*\s+\S.*|[A-Z][A-Z0-9 ()\/,&-]{6,80})$/;

export function splitNagSections(nagText: string): NagSection[] {
  const lines = nagText.split(/\r?\n/);
  const sections: NagSection[] = [];
  let heading = "PREAMBLE";
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) sections.push({ heading, text });
    buf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && trimmed.length <= 80 && HEADING_RE.test(trimmed)) {
      flush();
      heading = trimmed;
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

// Condition synonyms so "AOM" in the form still ranks the otitis section etc.
const SYNONYMS: Record<string, string[]> = {
  pneumonia: ["pneumonia", "cap", "respiratory", "lung"],
  otitis: ["otitis", "aom", "ear", "otalgia"],
  pharyngitis: ["pharyngitis", "tonsillitis", "sore throat", "throat", "centor"],
  rhinosinusitis: ["rhinosinusitis", "sinusitis", "sinus", "nasal"],
  ssti: ["ssti", "skin", "soft tissue", "cellulitis", "impetigo", "abscess", "wound"],
  uti: ["uti", "urinary", "cystitis", "pyelonephritis", "dysuria", "bladder"],
};

function expandTerms(queryTerms: string[]): string[] {
  const expanded = new Set<string>();
  for (const term of queryTerms) {
    for (const word of term.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length < 3) continue;
      expanded.add(word);
      for (const group of Object.values(SYNONYMS)) {
        if (group.includes(word)) group.forEach((s) => expanded.add(s));
      }
    }
  }
  return Array.from(expanded);
}

function scoreSection(section: NagSection, terms: string[]): number {
  const haystack = `${section.heading}\n${section.text}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (section.heading.toLowerCase().includes(term)) score += 5;
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

/**
 * Return the most relevant sections concatenated, hard-capped at budgetChars.
 * A "general principles"-type section is always appended if present and
 * budget remains — it carries the prescribing ground rules.
 */
export function selectNagSections(
  sections: NagSection[],
  queryTerms: string[],
  budgetChars = 10_000,
): string {
  const terms = expandTerms(queryTerms);
  const scored = sections
    .map((section) => ({ section, score: scoreSection(section, terms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const general = sections.find((s) => /general principles|prinsip/i.test(s.heading));

  const picked: NagSection[] = [];
  let used = 0;
  for (const { section } of scored) {
    const size = section.heading.length + section.text.length + 2;
    if (used + size > budgetChars) continue;
    picked.push(section);
    used += size;
  }
  if (general && !picked.includes(general)) {
    const size = general.heading.length + general.text.length + 2;
    if (used + size <= budgetChars) picked.push(general);
  }

  return picked.map((s) => `${s.heading}\n${s.text}`).join("\n\n");
}
