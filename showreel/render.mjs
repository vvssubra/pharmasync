// Renders index.html frame-by-frame to MP4 (or stills with --stills t1,t2,...).
// Usage: node render.mjs [--workers 4] [--clean] [--stills 1.2,7.5]
// --clean drops the film-grain overlay (smaller, sharper files for phones).
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, DUR = 66, N = FPS * DUR;
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dir = path.dirname(new URL(import.meta.url).pathname);
const url = 'file://' + path.join(dir, 'index.html') + '?render=1' + (args.includes('--clean') ? '&clean=1' : '');
const outDir = opt('--out') || path.join(dir, 'build');
fs.mkdirSync(outDir, { recursive: true });

async function page(browser) {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await p.goto(url);
  await p.evaluate(() => window.__ready);
  return p;
}
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
if (opt('--stills')) {
  const p = await page(browser);
  for (const t of opt('--stills').split(',').map(Number)) {
    await p.evaluate(t => window.__renderAt(t), t);
    await p.screenshot({ path: path.join(outDir, `still_${t.toFixed(2)}.jpg`), type: 'jpeg', quality: 80 });
  }
  await browser.close();
  process.exit(0);
}
const workers = +(opt('--workers') || 4);
const per = Math.ceil(N / workers);
await Promise.all(Array.from({ length: workers }, async (_, w) => {
  const a = w * per, b = Math.min(N, a + per);
  const p = await page(browser);
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), path.join(outDir, `seg${w}.mp4`)], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = a; f < b; f++) {
    await p.evaluate(t => window.__renderAt(t), f / FPS);
    const buf = await p.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`frame ${f}/${N}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
}));
await browser.close();
fs.writeFileSync(path.join(outDir, 'list.txt'), Array.from({ length: workers }, (_, w) => `file 'seg${w}.mp4'`).join('\n'));
console.log('segments done');
