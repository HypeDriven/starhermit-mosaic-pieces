// Bakes the browser build's procedural surface textures (render.js before the
// engine port: woodTexture, stoneTexture, feltTexture) into assets/textures/
// by running that canvas code unchanged in Chrome (~/games/tools/gpu-chrome.mjs).
// The desk's 420 wavy grain strokes, the slab's 5,000 speckles and veins and
// the felt's 6,000 fibres paint too slowly on the engine's canvas at start-up,
// so the engine client loads these images instead (native/render.ts), one set
// per preset texture budget (gfx.js BUDGETS texture: 256 Balanced, 512 High,
// 1024 Ultra; the old canvases were scaled by budget / 512):
//   wood-<px>.webp  desk planks (WebP: the grain compresses badly as PNG), <px>×2 wide and <px> tall
//   stone-<px>.png  board slab, <px> square
//   felt-<px>.png   tray felt, <px>/2 square
// Run once; commit the PNGs.   node tools/bake-textures.mjs
import { createRequire } from 'node:module';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function findPlaywright() {
  const roots = [root, resolve(root, '..'), ...readdirSync(resolve(root, '..')).map((d) => resolve(root, '..', d))];
  for (const r of roots) {
    for (const name of ['playwright-core', 'playwright']) {
      const p = join(r, 'node_modules', name);
      if (existsSync(p)) return createRequire(join(r, 'package.json'))(name);
    }
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

// The old render.js painters, verbatim, with canvasTex returning the canvas.
const painters = String.raw`
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvasTex(w, h, draw, { scale = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d');
  if (scale !== 1) ctx.scale(scale, scale);
  draw(ctx, w, h);
  return c;
}
function woodTexture(scale = 1) {
  return canvasTex(1024, 512, (x, W, H) => {
    const r = rng(7);
    x.fillStyle = '#5a3f2c';
    x.fillRect(0, 0, W, H);
    const planks = 6;
    for (let p = 0; p < planks; p++) {
      const y0 = p * H / planks;
      x.fillStyle = 'rgba(' + (r() < 0.5 ? '255,220,180' : '0,0,0') + ',' + (0.03 + r() * 0.06) + ')';
      x.fillRect(0, y0, W, H / planks);
      for (let i = 0; i < 70; i++) {
        const yy = y0 + r() * H / planks, amp = 1 + r() * 4, ph = r() * 6, fr = 0.004 + r() * 0.01;
        x.strokeStyle = r() < 0.7 ? 'rgba(30,16,8,' + (0.12 + r() * 0.2) + ')' : 'rgba(255,214,170,' + (0.05 + r() * 0.08) + ')';
        x.lineWidth = 0.6 + r() * 1.6;
        x.beginPath();
        for (let xx = 0; xx <= W; xx += 16) {
          const y = yy + Math.sin(xx * fr + ph) * amp;
          if (xx === 0) x.moveTo(xx, y); else x.lineTo(xx, y);
        }
        x.stroke();
      }
      x.fillStyle = 'rgba(15,8,4,0.55)';
      x.fillRect(0, y0, W, 2);
    }
  }, { scale });
}
function stoneTexture(scale = 1) {
  return canvasTex(512, 512, (x, W) => {
    const r = rng(11);
    x.fillStyle = '#343a48';
    x.fillRect(0, 0, W, W);
    for (let i = 0; i < 5000; i++) {
      const v = r();
      x.fillStyle = v < 0.5 ? 'rgba(255,255,255,' + (0.02 + r() * 0.05) + ')' : 'rgba(0,0,0,' + (0.04 + r() * 0.08) + ')';
      x.fillRect(r() * W, r() * W, 1 + r() * 3, 1 + r() * 3);
    }
    for (let i = 0; i < 14; i++) {
      x.strokeStyle = 'rgba(200,210,230,' + (0.04 + r() * 0.05) + ')';
      x.lineWidth = 1 + r();
      x.beginPath();
      let px = r() * W, py = r() * W; x.moveTo(px, py);
      for (let k = 0; k < 8; k++) { px += (r() - 0.5) * 120; py += (r() - 0.3) * 80; x.lineTo(px, py); }
      x.stroke();
    }
  }, { scale });
}
function feltTexture(scale = 1) {
  return canvasTex(256, 256, (x, W) => {
    const r = rng(23);
    x.fillStyle = '#2a3a34';
    x.fillRect(0, 0, W, W);
    for (let i = 0; i < 6000; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)';
      x.fillRect(r() * W, r() * W, 1, 1 + r() * 2);
    }
  }, { scale });
}`;

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, close } = await launchChrome(chromium);
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: painters });
  const jobs = [];
  for (const px of [256, 512, 1024]) {
    const k = px / 512;
    jobs.push([`wood-${px}.webp`, `woodTexture(${k})`], [`stone-${px}.png`, `stoneTexture(${k})`], [`felt-${px}.png`, `feltTexture(${k})`]);
  }
  for (const [name, expr] of jobs) {
    const url = await page.evaluate((e) => (0, eval)(e[0]).toDataURL(e[1], 0.9), [expr, name.endsWith('.webp') ? 'image/webp' : 'image/png']);
    writeFileSync(join(root, 'assets/textures', name), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote assets/textures/' + name);
  }
} finally { await close(); }
