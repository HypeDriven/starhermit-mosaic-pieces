// Regression checks for saved rounds, goal visibility, and keyboard controls.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 8477;
const srv = spawn('node', ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/v1/time`); if (r.ok) break; } catch { await sleep(250); } }
console.log('ok - server.js listens when run directly');

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
const noise = /GL Driver Message|GPU stall|software WebGL|WebGLDeveloperExtensions/i;
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text())) errors.push('console: ' + m.text()); });
const fail = (m) => { throw new Error(m); };

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__mosaic?.renderer);
await page.click('[data-action="nav-mode"]');
await page.click('[data-action="nav-practice"]');
await page.click('[data-action="start-practice"][data-id="relaxed"]');
await page.click('[data-action="confirm-start"]');
await page.waitForFunction(() => window.__mosaic.state?.status === 'active');

// goal image hung on the wall
const hasArt = await page.evaluate(() => !!window.__mosaic.renderer.artMesh.material.map);
if (!hasArt) fail('goal image not applied to the gallery frame');
console.log('ok - goal image texture applied');

// arrow-key navigation inside the board mirror
await page.evaluate(() => document.querySelector('#cell-grid button').focus());
const before = await page.evaluate(() => document.activeElement.dataset.cell);
await page.keyboard.press('ArrowRight');
const right = await page.evaluate(() => document.activeElement.dataset.cell);
await page.keyboard.press('ArrowDown');
const nav = { before, right, down: await page.evaluate(() => document.activeElement.dataset.cell) };
if (nav.before !== '0' || nav.right !== '1' || nav.down !== '4') fail('arrow navigation wrong: ' + JSON.stringify(nav));
console.log('ok - arrow keys move focus in the board mirror (3x3: 0 -> 1 -> 4)');

// clicking an occupied cell with a selection explains instead of penalising
await page.evaluate(() => {
  const app = window.__mosaic;
  const p = app.state.pieces[0];
  app._selectPiece(p.id);
  app._placeSelected(p.cell);
});
const pen = await page.evaluate(() => {
  const app = window.__mosaic;
  const before = app.state.invalidActions;
  const other = app.state.pieces.find((p) => !p.placed);
  app._selectPiece(other.id);
  app._placeSelected(app.state.pieces[0].placedCell); // occupied cell
  app._selectPiece(app.state.pieces[0].id);           // already-placed piece
  return { before, after: app.state.invalidActions };
});
if (pen.after !== pen.before) fail('misclicks still bank invalid actions: ' + JSON.stringify(pen));
console.log('ok - illegal pointer targets explained without a score penalty');

// resume prompt survives boot
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.screen-card h2');
const h2 = await page.textContent('.screen-card h2');
if (h2 !== 'Welcome back') fail('resume prompt not shown after reload, got: ' + h2);
await page.click('[data-action="resume-saved"]');
await page.waitForFunction(() => window.__mosaic.state?.status === 'active');
const placed = await page.evaluate(() => window.__mosaic.state.pieces.filter((p) => p.placed).length);
if (placed !== 1) fail('resumed round lost progress: ' + placed);
console.log('ok - saved round resumes from the welcome-back prompt');

// results screen cannot be dismissed into a dead board
await page.evaluate(async () => {
  const app = window.__mosaic;
  let g = 0;
  while (app.state.status === 'active' && g++ < 100) app._cmd({ type: 'hint' });
});
await page.waitForSelector('.screen-card');
await page.keyboard.press('Escape');
await sleep(200);
const still = await page.evaluate(() => document.querySelector('.screen-card')?.textContent.includes('Total score'));
if (!still) fail('Escape dismissed the results screen, leaving no way back');
console.log('ok - Escape keeps the results screen (no dead-end board)');
const acc = await page.textContent('.screen-card');
if (!acc.includes('Tiles matching the goal image')) fail('results missing goal-accuracy row');
console.log('ok - results report goal accuracy');

if (errors.length) fail('page errors:\n' + errors.join('\n'));
console.log('\nVERIFY PASS — no page errors');
} finally {
  await browser.close();
  srv.kill();
}
