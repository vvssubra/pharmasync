// Rasterises the PWA icon set from inline SVG sources into public/.
//
// Run manually: `node scripts/generate-pwa-icons.mjs`
// Deliberately NOT wired into `npm run build`: sharp ships a platform-specific
// native binary and resolving it inside the node:20-alpine build stage
// (Dockerfile) is a musl/glibc problem we have no reason to take on. The PNGs are
// committed instead, so a production build never needs sharp at all.
//
// Two sources rather than one, because "any" and "maskable" icons want opposite
// things:
//
//   any / favicon-ish  -> rounded square, transparent corners. This is the shape
//                         launchers draw as-is.
//   maskable + apple   -> colour bleeding to all four edges, glyph kept inside
//                         the centre 80% circle. The OS applies its own mask
//                         (circle on Android, squircle on iOS) and crops up to
//                         10% off each side. A rounded, inset source gets
//                         letterboxed: you see the icon's own corners cut away
//                         and transparency around it.
//
// This is why @vite-pwa/assets-generator was dropped — its minimal2023 preset
// scales one source down to fit the safe zone, which produces exactly that
// letterboxed maskable icon.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");

// The app's primary token, hsl(162 73% 22%) in src/index.css.
const BRAND = "#0f6148";

// Capital-P monogram, drawn as geometry so no font is needed at rasterisation
// time. Stem and bowl are one contour (no seam); the counter is subtracted with
// fill-rule="evenodd". Bounds 180..331 x 136..376 on a 512 canvas, centred on
// (256,256); the furthest corner is ~142px out, inside the r=205 safe circle.
//
// Built as a letterform rather than a rect plus a circle: a full circular bowl
// centred on the stem reads as a lowercase p, because the stem then descends
// past a bowl that looks optically centred.
const GLYPH = `<path fill="#fff" fill-rule="evenodd"
  d="M180 136 H266 A65 65 0 0 1 266 266 H226 V376 H180 Z
     M226 178 H266 A23 23 0 0 1 266 224 H226 Z"/>`;

const rounded = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="${BRAND}"/>
  ${GLYPH}
</svg>`;

const fullBleed = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${BRAND}"/>
  ${GLYPH}
</svg>`;

const targets = [
  { file: "pwa-192x192.png", size: 192, src: rounded },
  { file: "pwa-512x512.png", size: 512, src: rounded },
  { file: "maskable-icon-512x512.png", size: 512, src: fullBleed },
  // iOS never masks transparency to the brand colour — it composites onto black
  // or white — so the apple icon uses the full-bleed source too.
  { file: "apple-touch-icon-180x180.png", size: 180, src: fullBleed },
];

await mkdir(OUT, { recursive: true });

for (const { file, size, src } of targets) {
  const png = await sharp(Buffer.from(src)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(OUT, file), png);
  const { width, height, channels } = await sharp(png).metadata();
  console.log(`${file.padEnd(32)} ${width}x${height}  ${channels}ch  ${png.length}B`);
}

// public/favicon.ico is intentionally left alone. Replacing the site favicon is
// a separate decision from adding installable-app icons.
console.log("\nDone. public/favicon.ico untouched by design.");
