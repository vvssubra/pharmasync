// This file uses Deno's built-in test runner (not Vitest), consistent with
// security.test.ts in this directory.
// Run with: deno test supabase/functions/_shared/parity.test.ts
//
// Asserts the marker-delimited text mirrored from src/lib/*.ts into this
// directory (stock.ts, quotaHelpers.ts, doseQuery.ts) is byte-identical to
// its source, since the edge bundle cannot import outside supabase/functions/.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

interface MirrorPair {
  name: string;
  srcPath: string;
  sharedPath: string;
  startMarker: string;
  endMarker: string;
}

const PAIRS: MirrorPair[] = [
  {
    name: "stock",
    srcPath: "../../../src/lib/stock.ts",
    sharedPath: "./stock.ts",
    startMarker: "// <<<shared-stock",
    endMarker: "// shared-stock>>>",
  },
  {
    name: "quotaHelpers",
    srcPath: "../../../src/lib/quotaHelpers.ts",
    sharedPath: "./quotaHelpers.ts",
    startMarker: "// <<<shared-quotahelpers",
    endMarker: "// shared-quotahelpers>>>",
  },
  {
    name: "doseQuery",
    srcPath: "../../../src/lib/doseQuery.ts",
    sharedPath: "./doseQuery.ts",
    startMarker: "// <<<shared-dosequery",
    endMarker: "// shared-dosequery>>>",
  },
  {
    name: "abxDose",
    srcPath: "../../../src/lib/abxDose.ts",
    sharedPath: "./abxDose.ts",
    startMarker: "// <<<shared-abxdose",
    endMarker: "// shared-abxdose>>>",
  },
  {
    name: "nagPathways",
    srcPath: "../../../src/lib/nagPathways.ts",
    sharedPath: "./nagPathways.ts",
    startMarker: "// <<<shared-nagpathways",
    endMarker: "// shared-nagpathways>>>",
  },
];

function extractMarked(fileUrl: URL, startMarker: string, endMarker: string): string {
  const text = Deno.readTextFileSync(fileUrl);
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start === -1 || end === -1) {
    throw new Error(`Markers ${startMarker}/${endMarker} not found in ${fileUrl}`);
  }
  return text.slice(start, end + endMarker.length);
}

for (const pair of PAIRS) {
  Deno.test(`${pair.name}: _shared mirror matches src/lib verbatim`, () => {
    const srcUrl = new URL(pair.srcPath, import.meta.url);
    const sharedUrl = new URL(pair.sharedPath, import.meta.url);
    const srcText = extractMarked(srcUrl, pair.startMarker, pair.endMarker);
    const sharedText = extractMarked(sharedUrl, pair.startMarker, pair.endMarker);
    assertEquals(
      sharedText,
      srcText,
      `supabase/functions/_shared/${pair.name}.ts has drifted from src/lib/${pair.name}.ts — copy the marked region verbatim.`,
    );
  });
}
