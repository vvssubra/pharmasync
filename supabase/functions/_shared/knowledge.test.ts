// This file uses Deno's built-in test runner (not Vitest).
// Run with: deno test --no-check --allow-env supabase/functions/_shared/knowledge.test.ts

import { assertEquals } from "./asserts.ts";
import { fetchDoseMatches, doseMatchesBlock, type KnowledgeMatch } from "./knowledge.ts";

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const MATCH: KnowledgeMatch = {
  drug: "Amoxicillin",
  indication: "Acute Otitis Media",
  patient_group: "Paediatric",
  source: "NAG 2024",
  body: "Amoxicillin 80-90 mg/kg/day PO divided BD x 5-7 days.",
  score: 0.91,
};

Deno.test("fetchDoseMatches: returns [] when KNOWLEDGE_SERVICE_URL is unset", async () => {
  Deno.env.delete("KNOWLEDGE_SERVICE_URL");
  assertEquals(await fetchDoseMatches("ear infection"), []);
});

Deno.test("fetchDoseMatches: posts query and key header, returns matches", async () => {
  Deno.env.set("KNOWLEDGE_SERVICE_URL", "http://knowledge-service:8787");
  Deno.env.set("KNOWLEDGE_KEY", "sekrit");
  let captured: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
  const restore = stubFetch((input, init) => {
    captured = {
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    };
    return Promise.resolve(new Response(JSON.stringify({ matches: [MATCH] }), { status: 200 }));
  });
  try {
    const matches = await fetchDoseMatches("ear infection", "Paediatric");
    assertEquals(captured!.url, "http://knowledge-service:8787/suggest-dose");
    assertEquals(captured!.headers["x-knowledge-key"], "sekrit");
    assertEquals(captured!.body, { query: "ear infection", patient_group: "Paediatric" });
    assertEquals(matches, [MATCH]);
  } finally {
    restore();
    Deno.env.delete("KNOWLEDGE_SERVICE_URL");
    Deno.env.delete("KNOWLEDGE_KEY");
  }
});

Deno.test("fetchDoseMatches: returns [] on non-ok response", async () => {
  Deno.env.set("KNOWLEDGE_SERVICE_URL", "http://knowledge-service:8787");
  const restore = stubFetch(() => Promise.resolve(new Response("boom", { status: 503 })));
  try {
    assertEquals(await fetchDoseMatches("x"), []);
  } finally {
    restore();
    Deno.env.delete("KNOWLEDGE_SERVICE_URL");
  }
});

Deno.test("fetchDoseMatches: returns [] on network error", async () => {
  Deno.env.set("KNOWLEDGE_SERVICE_URL", "http://knowledge-service:8787");
  const restore = stubFetch(() => Promise.reject(new Error("connection refused")));
  try {
    assertEquals(await fetchDoseMatches("x"), []);
  } finally {
    restore();
    Deno.env.delete("KNOWLEDGE_SERVICE_URL");
  }
});

Deno.test("fetchDoseMatches: returns [] for a blank query without fetching", async () => {
  Deno.env.set("KNOWLEDGE_SERVICE_URL", "http://knowledge-service:8787");
  let called = false;
  const restore = stubFetch(() => {
    called = true;
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  try {
    assertEquals(await fetchDoseMatches("   "), []);
    assertEquals(called, false);
  } finally {
    restore();
    Deno.env.delete("KNOWLEDGE_SERVICE_URL");
  }
});

Deno.test("doseMatchesBlock: empty for no matches", () => {
  assertEquals(doseMatchesBlock([]), "");
});

Deno.test("doseMatchesBlock: serializes drug, indication, source and body", () => {
  const block = doseMatchesBlock([MATCH]);
  assertEquals(block.includes("Amoxicillin — Acute Otitis Media"), true);
  assertEquals(block.includes("NAG 2024"), true);
  assertEquals(block.includes("80-90 mg/kg/day"), true);
  assertEquals(block.startsWith("## Verified local dosing notes"), true);
});
