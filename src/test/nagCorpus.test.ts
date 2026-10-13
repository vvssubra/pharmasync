import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitNagMarkdown, normalizeForMatch, type NagSection } from "../../supabase/functions/_shared/nagCorpus";
import { NAG_CORPUS_SECTIONS } from "../../supabase/functions/_shared/nagCorpus.generated";
import { verifyAiAnswer, parseRawAnswer, buildCaseMessage, type AiRawAnswer } from "../../supabase/functions/antibiotic-suggest/nagAi";

const DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs");

describe("NAG corpus bundle", () => {
  it("is in sync with docs/nag-section-*.md (run `node scripts/build-nag-corpus.ts` after editing the docs)", () => {
    const rebuilt = readdirSync(DOCS_DIR)
      .filter((f) => /^nag-section-.*\.md$/.test(f))
      .sort()
      .flatMap((f) => splitNagMarkdown(f.replace(/^nag-section-/, "").replace(/\.md$/, ""), readFileSync(resolve(DOCS_DIR, f), "utf-8")));
    expect(NAG_CORPUS_SECTIONS).toEqual(rebuilt);
  });

  it("has unique section ids and tags Section B as paediatric", () => {
    const ids = NAG_CORPUS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(NAG_CORPUS_SECTIONS.filter((s) => s.id.startsWith("b-")).every((s) => s.group === "Paediatric")).toBe(true);
    expect(NAG_CORPUS_SECTIONS.filter((s) => s.id.startsWith("a-")).every((s) => s.group === "Adult")).toBe(true);
  });

  it("drops reference lists", () => {
    expect(NAG_CORPUS_SECTIONS.some((s) => /references/i.test(s.path))).toBe(false);
  });
});

describe("splitNagMarkdown", () => {
  const md = [
    "# NAG Section A (Adult) — Test",
    "Intro line.",
    "## 1. Disease",
    "### 1.1 Outpatient",
    "- **Preferred:** Amoxicillin 500mg PO q8h for 5–7 days",
    "### 1.2 Inpatient",
    "- **Preferred:** Ceftriaxone 2g IV q24h",
    "## References",
    "Some citation.",
  ].join("\n");

  it("splits at headings with breadcrumbs and stable ids", () => {
    const s = splitNagMarkdown("a-test", md);
    expect(s.map((x) => x.id)).toEqual(["a-test/intro", "a-test/1/1-1", "a-test/1/1-2"]);
    expect(s[1].path).toBe("NAG Section A (Adult) — Test › 1. Disease › 1.1 Outpatient");
    expect(s[1].text).toContain("Amoxicillin 500mg");
  });
});

// ── verifier ────────────────────────────────────────────────────────────────

const SECTIONS: NagSection[] = [
  {
    id: "a-x/1/1-1",
    path: "NAG Section A (Adult) — X › 1. PID › 1.1 Outpatient",
    group: "Adult",
    text: "**Preferred**\n- Ceftriaxone 500mg IM single dose (BW >150kg: 1g IM STAT)\n- PLUS Metronidazole 400mg PO q12h for 14 days\n- PLUS Doxycycline 100mg PO q12h for 14 days\n**Comments**\n- \\*Doxycycline is contraindicated in pregnancy.",
  },
  {
    id: "b-x/b9/1",
    path: "NAG Section B (Paediatrics) › B9. ENT › 1. Tonsillitis",
    group: "Paediatric",
    text: "- Amoxicillin 50mg/kg/day PO in 1 or 2 divided doses (max. 1g/day)",
  },
];

const goodAnswer: AiRawAnswer = {
  refer: false,
  regimens: [{
    tier: "Preferred",
    drug: "Ceftriaxone",
    section_id: "a-x/1/1-1",
    quotes: [
      "Ceftriaxone 500mg IM single dose (BW >150kg: 1g IM STAT)",
      "Metronidazole 400mg PO q12h for 14 days",
      "Doxycycline 100mg PO q12h for 14 days",
    ],
  }],
  notes: [{ section_id: "a-x/1/1-1", quote: "*Doxycycline is contraindicated in pregnancy." }],
};

describe("verifyAiAnswer", () => {
  it("accepts verbatim quotes and builds the rationale from the section breadcrumb", () => {
    const v = verifyAiAnswer(goodAnswer, SECTIONS, "Adult");
    expect(v.rejected).toBe(0);
    expect(v.regimens).toHaveLength(1);
    expect(v.regimens[0].text).toBe(
      "Ceftriaxone 500mg IM single dose (BW >150kg: 1g IM STAT) + Metronidazole 400mg PO q12h for 14 days + Doxycycline 100mg PO q12h for 14 days",
    );
    expect(v.regimens[0].sourcePath).toBe(SECTIONS[0].path);
    expect(v.rationale).toContain(SECTIONS[0].path);
    expect(v.warning).toContain("contraindicated in pregnancy");
  });

  it("rejects a regimen whose dose was altered by even one digit", () => {
    const altered = structuredClone(goodAnswer);
    altered.regimens[0].quotes[1] = "Metronidazole 500mg PO q12h for 14 days";
    const v = verifyAiAnswer(altered, SECTIONS, "Adult");
    expect(v.regimens).toHaveLength(0);
    expect(v.rejected).toBe(1);
  });

  it("rejects quotes stitched from text that is not contiguous in the section", () => {
    const stitched = structuredClone(goodAnswer);
    stitched.regimens[0].quotes = ["Ceftriaxone 500mg IM for 14 days"];
    expect(verifyAiAnswer(stitched, SECTIONS, "Adult").regimens).toHaveLength(0);
  });

  it("never serves a paediatric section to an adult or vice versa", () => {
    expect(verifyAiAnswer(goodAnswer, SECTIONS, "Paediatric").regimens).toHaveLength(0);
    const paeds: AiRawAnswer = {
      refer: false,
      regimens: [{ tier: "Preferred", drug: "Amoxicillin", section_id: "b-x/b9/1", quotes: ["Amoxicillin 50mg/kg/day PO in 1 or 2 divided doses (max. 1g/day)"] }],
      notes: [],
    };
    expect(verifyAiAnswer(paeds, SECTIONS, "Adult").regimens).toHaveLength(0);
    expect(verifyAiAnswer(paeds, SECTIONS, "Paediatric").regimens).toHaveLength(1);
  });

  it("rejects an unknown section id, a mislabelled drug, and an unknown tier", () => {
    const badSection = { ...goodAnswer, regimens: [{ ...goodAnswer.regimens[0], section_id: "a-x/9/9-9" }] };
    const badDrug = { ...goodAnswer, regimens: [{ ...goodAnswer.regimens[0], drug: "Azithromycin" }] };
    const badTier = { ...goodAnswer, regimens: [{ ...goodAnswer.regimens[0], tier: "Best" }] };
    for (const a of [badSection, badDrug, badTier]) expect(verifyAiAnswer(a, SECTIONS, "Adult").regimens).toHaveLength(0);
  });

  it("returns a refer answer when the model refers", () => {
    const v = verifyAiAnswer({ refer: true, regimens: goodAnswer.regimens, notes: [] }, SECTIONS, "Adult");
    expect(v.regimens).toHaveLength(0);
    expect(v.rationale).toMatch(/could not be matched/);
  });

  it("drops notes that are not verbatim", () => {
    const a = { ...goodAnswer, notes: [{ section_id: "a-x/1/1-1", quote: "Doxycycline is safe in pregnancy." }] };
    expect(verifyAiAnswer(a, SECTIONS, "Adult").warning).toBeNull();
  });

  it("flags penicillin-class regimens when an allergy is stated", () => {
    const paeds: AiRawAnswer = {
      refer: false,
      regimens: [{ tier: "Preferred", drug: "Amoxicillin", section_id: "b-x/b9/1", quotes: ["Amoxicillin 50mg/kg/day PO in 1 or 2 divided doses (max. 1g/day)"] }],
      notes: [],
    };
    const v = verifyAiAnswer(paeds, SECTIONS, "Paediatric", "Penicillin - rash");
    expect(v.regimens[0].penicillinClass).toBe(true);
    expect(v.warning).toMatch(/contains penicillin/);
  });
});

describe("normalizeForMatch", () => {
  it("ignores markdown, dash style and spacing but not content", () => {
    expect(normalizeForMatch("**Amoxicillin** 5–7  days")).toBe(normalizeForMatch("Amoxicillin 5-7 days"));
    expect(normalizeForMatch("Amoxicillin 500mg")).not.toBe(normalizeForMatch("Amoxicillin 50mg"));
  });
});

describe("parseRawAnswer / buildCaseMessage", () => {
  it("rejects malformed model output", () => {
    expect(parseRawAnswer(null)).toBeNull();
    expect(parseRawAnswer({ refer: false, regimens: [{ tier: "Preferred" }], notes: [] })).toBeNull();
    expect(parseRawAnswer(goodAnswer)).toEqual(goodAnswer);
  });

  it("redacts anything IC-shaped from every free-text field before it leaves the VPS", () => {
    const msg = buildCaseMessage({
      diagnosis: "PID in 900101-14-5678",
      checklistIndication: null,
      checklist: { note: "ic 900101145678" },
      patientAge: 30,
      patientGroup: "Adult",
      allergyStatus: "penicillin (900101 14 5678)",
    });
    expect(msg).not.toMatch(/900101/);
    expect(msg).toContain("[IC removed]");
    expect(JSON.parse(msg).diagnosis).toBe("PID in [IC removed]");
  });

  it("sends no identifying fields — only clinical case data", () => {
    const msg = JSON.parse(buildCaseMessage({ diagnosis: "PID", checklistIndication: null, patientAge: 30, patientGroup: "Adult" }));
    expect(Object.keys(msg).sort()).toEqual(
      ["checklist_findings", "checklist_indication", "diagnosis", "drug_allergy", "patient_age_years", "patient_group", "weight_kg"].sort(),
    );
  });
});

describe("severity not stated — two candidate sections", () => {
  it("keeps regimens from both PID sections, each labelled with its own section, and notes it for the audit log", () => {
    const v = verifyAiAnswer({
      refer: false,
      regimens: [
        { tier: "Preferred", drug: "Ceftriaxone", section_id: "a-obstetrics-gynaecology/1/1-1", quotes: ["Ceftriaxone 500mg IM single dose (BW >150kg: 1g IM STAT)", "Metronidazole 400mg PO q12h for 14 days", "Doxycycline 100mg PO q12h for 14 days"] },
        { tier: "Preferred", drug: "Ceftriaxone", section_id: "a-obstetrics-gynaecology/1/1-2", quotes: ["Ceftriaxone 2g IV q24h", "Doxycycline 100mg PO q12h", "Metronidazole 400mg PO or 500mg IV q12h"] },
      ],
      notes: [],
    }, NAG_CORPUS_SECTIONS, "Adult");
    expect(v.regimens).toHaveLength(2);
    expect(v.regimens[0].sourcePath).toMatch(/1\.1 Outpatient/);
    expect(v.regimens[1].sourcePath).toMatch(/1\.2 Inpatient/);
    expect(v.auditNote).toMatch(/^nag_ai ok: regimens=2 rejected=0/);
  });

  it("records why an answer came back empty, without patient data", () => {
    const v = verifyAiAnswer({ refer: true, regimens: [], notes: [] }, NAG_CORPUS_SECTIONS, "Adult");
    expect(v.auditNote).toBe("nag_ai empty: model_refer=true proposed=0 rejected=0");
  });
});

describe("real corpus spot-check", () => {
  it("contains verbatim dose lines a model would need to quote", () => {
    const pid = NAG_CORPUS_SECTIONS.find((s) => s.path.includes("Pelvic Inflammatory Disease") && s.path.includes("Outpatient"));
    expect(pid).toBeDefined();
    const v = verifyAiAnswer({
      refer: false,
      regimens: [{ tier: "Preferred", drug: "Ceftriaxone", section_id: pid!.id, quotes: ["Ceftriaxone 500mg IM single dose (BW >150kg: 1g IM STAT)"] }],
      notes: [],
    }, NAG_CORPUS_SECTIONS, "Adult");
    expect(v.regimens).toHaveLength(1);
  });
});
