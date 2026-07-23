import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/server.js";
import { config } from "../src/config.js";

// Send the configured shared-secret header on every request so these tests
// pass regardless of whether the local .env has KNOWLEDGE_KEY set.
const authHeaders = config.knowledgeKey ? { "x-knowledge-key": config.knowledgeKey } : {};

function fakeVaultIndex(matches) {
  return {
    noteCount: () => 2,
    query: async () => matches,
  };
}
function fakeOllama(up = true) {
  return { isUp: async () => up };
}

async function withServer(app, fn) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /health reports note count and ollama status", async () => {
  const app = createApp({ vaultIndex: fakeVaultIndex([]), ollama: fakeOllama(true) });
  await withServer(app, async (base) => {
    const resp = await fetch(`${base}/health`);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.deepEqual(body, { ok: true, note_count: 2, ollama: "up" });
  });
});

test("POST /suggest-dose returns matches for a valid query", async () => {
  const match = { drug: "Amoxicillin", indication: "AOM", patient_group: "Paediatric", source: "NAG", body: "dose text", score: 0.9 };
  const app = createApp({ vaultIndex: fakeVaultIndex([match]), ollama: fakeOllama(true) });
  await withServer(app, async (base) => {
    const resp = await fetch(`${base}/suggest-dose`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ query: "ear infection" }),
    });
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.deepEqual(body.matches, [match]);
  });
});

test("POST /suggest-dose returns a message when there are no matches", async () => {
  const app = createApp({ vaultIndex: fakeVaultIndex([]), ollama: fakeOllama(true) });
  await withServer(app, async (base) => {
    const resp = await fetch(`${base}/suggest-dose`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ query: "nonsense" }),
    });
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.deepEqual(body.matches, []);
    assert.equal(body.message, "No matching guideline found");
  });
});

test("POST /suggest-dose rejects a missing query", async () => {
  const app = createApp({ vaultIndex: fakeVaultIndex([]), ollama: fakeOllama(true) });
  await withServer(app, async (base) => {
    const resp = await fetch(`${base}/suggest-dose`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({}),
    });
    assert.equal(resp.status, 400);
  });
});

test("POST /suggest-dose rejects a request missing the shared-secret header when one is configured", async (t) => {
  if (!config.knowledgeKey) t.skip("no KNOWLEDGE_KEY configured in this environment");
  const app = createApp({ vaultIndex: fakeVaultIndex([]), ollama: fakeOllama(true) });
  await withServer(app, async (base) => {
    const resp = await fetch(`${base}/suggest-dose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "ear infection" }),
    });
    assert.equal(resp.status, 401);
  });
});

test("GET /unknown-route returns 404", async () => {
  const app = createApp({ vaultIndex: fakeVaultIndex([]), ollama: fakeOllama(true) });
  await withServer(app, async (base) => {
    const resp = await fetch(`${base}/unknown-route`);
    assert.equal(resp.status, 404);
  });
});
