// This file uses Deno's built-in test runner (not Vitest).
// Run with: deno test --no-check --allow-env supabase/functions/_shared/hermes.test.ts

import { assertEquals, assertRejects } from "./asserts.ts";
import { hermesChat } from "./hermes.ts";

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("hermesChat: sends model, messages, and options to /api/chat", async () => {
  let captured: { url: string; body: Record<string, unknown> } | null = null;
  const restore = stubFetch((input, init) => {
    captured = { url: String(input), body: JSON.parse(String(init?.body)) };
    return Promise.resolve(okResponse({
      message: { role: "assistant", content: "hello" },
      prompt_eval_count: 10,
      eval_count: 5,
    }));
  });
  try {
    const result = await hermesChat({ system: "sys", user: "usr", maxTokens: 99, temperature: 0.3 });

    assertEquals(captured!.url.endsWith("/api/chat"), true);
    assertEquals(captured!.body.stream, false);
    assertEquals(captured!.body.format, undefined);
    const options = captured!.body.options as Record<string, unknown>;
    assertEquals(options.num_predict, 99);
    assertEquals(options.temperature, 0.3);
    const messages = captured!.body.messages as Array<{ role: string; content: string }>;
    assertEquals(messages[0], { role: "system", content: "sys" });
    assertEquals(messages[1], { role: "user", content: "usr" });
    assertEquals(result.text, "hello");
  } finally {
    restore();
  }
});

Deno.test("hermesChat: json mode sets format:'json'", async () => {
  let body: Record<string, unknown> | null = null;
  const restore = stubFetch((_input, init) => {
    body = JSON.parse(String(init?.body));
    return Promise.resolve(okResponse({ message: { content: "{}" } }));
  });
  try {
    await hermesChat({ system: "s", user: "u", json: true });
    assertEquals(body!.format, "json");
  } finally {
    restore();
  }
});

Deno.test("hermesChat: tokensUsed = prompt_eval_count + eval_count", async () => {
  const restore = stubFetch(() =>
    Promise.resolve(okResponse({
      message: { content: "x" },
      prompt_eval_count: 123,
      eval_count: 45,
    }))
  );
  try {
    const result = await hermesChat({ system: "s", user: "u" });
    assertEquals(result.tokensUsed, 168);
  } finally {
    restore();
  }
});

Deno.test("hermesChat: missing token counts default to 0", async () => {
  const restore = stubFetch(() => Promise.resolve(okResponse({ message: { content: "x" } })));
  try {
    const result = await hermesChat({ system: "s", user: "u" });
    assertEquals(result.tokensUsed, 0);
  } finally {
    restore();
  }
});

Deno.test("hermesChat: throws on non-ok HTTP status", async () => {
  const restore = stubFetch(() =>
    Promise.resolve(new Response("model not found", { status: 404 }))
  );
  try {
    await assertRejects(
      () => hermesChat({ system: "s", user: "u" }),
      Error,
      "ollama_http_404",
    );
  } finally {
    restore();
  }
});

Deno.test("hermesChat: times out into a normal throw", async () => {
  // Real fetch against a hanging endpoint is awkward to stub; emulate the
  // abort path by rejecting with the same error AbortSignal.timeout produces.
  const restore = stubFetch((_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })
  );
  try {
    await assertRejects(() => hermesChat({ system: "s", user: "u", timeoutMs: 10 }));
  } finally {
    restore();
  }
});
