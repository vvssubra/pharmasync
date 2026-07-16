// This file uses Deno's built-in test runner (not Vitest).
// Run with: deno test --no-check supabase/functions/_shared/htmlText.test.ts

import { assertEquals, assert } from "./asserts.ts";
import { htmlToText } from "./htmlText.ts";

Deno.test("htmlToText: strips tags and keeps text", () => {
  assertEquals(htmlToText("<p>Amoxicillin <b>500mg</b> TDS</p>"), "Amoxicillin 500mg TDS");
});

Deno.test("htmlToText: drops script, style and nav blocks entirely", () => {
  const html = `<nav>Menu Home About</nav><script>alert("x")</script>
<style>.a{color:red}</style><p>Dose: 1g BD</p>`;
  const text = htmlToText(html);
  assertEquals(text.includes("Menu"), false);
  assertEquals(text.includes("alert"), false);
  assertEquals(text.includes("color"), false);
  assert(text.includes("Dose: 1g BD"));
});

Deno.test("htmlToText: block-level closes become line breaks", () => {
  const text = htmlToText("<h1>UTI</h1><p>Trimethoprim 200mg BD</p><p>x 3 days</p>");
  assert(text.includes("\n"));
  assert(text.includes("UTI"));
  assert(text.includes("Trimethoprim 200mg BD"));
});

Deno.test("htmlToText: decodes common entities", () => {
  assertEquals(htmlToText("Adults &amp; children &gt; 12: 500mg&nbsp;TDS"), "Adults & children > 12: 500mg TDS");
});

Deno.test("htmlToText: decodes numeric entities", () => {
  assertEquals(htmlToText("5&#45;7 days"), "5-7 days");
});

Deno.test("htmlToText: collapses whitespace runs", () => {
  const text = htmlToText("<p>a</p>\n\n\n\n<p>b</p>");
  assertEquals(/\n{3,}/.test(text), false);
});

Deno.test("htmlToText: respects maxChars cap", () => {
  const text = htmlToText(`<p>${"x".repeat(1000)}</p>`, 100);
  assertEquals(text.length, 100);
});
