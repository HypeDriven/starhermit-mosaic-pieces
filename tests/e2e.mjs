/**
 * Mosaic Pieces — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome (playwright-core + system
 * Chrome): title → journey stage 1 → setup → play a full round by clicking
 * the tray/cell mirror buttons → results with score breakdown → retry →
 * pause/resume (Esc) → settings open/change/close → help → practice round.
 * Two passes: desktop 1280x800 and mobile 390x844 (touch). Screenshots at
 * each stage go to /tmp/mosaic-pieces-e2e-<stage>-<desktop|mobile>.png.
 *
 * Self-contained: embeds its own static file server on an ephemeral port
 * with minimal same-origin /api stubs (time/daily/leaderboard/event) so the
 * game runs fully "online" without the StarHermit authoritative server.js.
 * Fails loudly on any non-benign console error or pageerror.
 *
 * Run: npm run test:e2e
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { dailyContent } from '../content.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2', '.ts': 'application/typescript', '.txt': 'text/plain; charset=utf-8'
};
// benign GPU/swiftshader noise (same regex as tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const p = url.pathname;
    const sendJson = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    if (p.startsWith('/api/')) {
      // minimal stand-ins for the platform API so play works fully offline
      if (p === '/api/v1/time') return sendJson(200, { now: Date.now(), iso: new Date().toISOString() });
      if (p === '/api/v1/daily') return sendJson(200, dailyContent(new Date().toISOString().slice(0, 10)));
      if (p === '/api/v1/leaderboard') return sendJson(200, { board: url.searchParams.get('board') || 'chase', entries: [] });
      if (p === '/api/v1/leaderboard/submit') return sendJson(200, { ok: true, rank: 1, board: 'stub' });
      if (p === '/api/v1/achievements') return sendJson(200, { ok: true });
      if (p === '/api/v1/event') return sendJson(200, { ok: true });
      return sendJson(404, { error: 'unknown endpoint' });
    }
    const rel = decodeURIComponent(p === '/' ? '/index.html' : p);
    const filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      fs.createReadStream(filePath).pipe(res);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const SHOT = (stage, label) => `/tmp/mosaic-pieces-e2e-${stage}-${label}.png`;
const step = async (name, fn) => { await fn(); console.log(`ok - ${name}`); };

async function runPass(browser, label, viewport, hasTouch) {
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  // On mobile the side rails are off-canvas drawers; open the actions rail
  // (which holds the tray piece and board cell mirror buttons) first.
  const openActionsRail = async () => {
    if (!hasTouch) return;
    const rail = page.locator('#actions-rail');
    if (!(await rail.evaluate((el) => el.classList.contains('open')))) {
      await page.locator('[data-action="toggle-right-rail"]').click();
    }
  };

  // Play the active round to completion through the visible mirror UI.
  // Game state is read only to decide which visible button to click next.
  const playToCompletion = async (shotName) => {
    for (let guard = 0; guard < 200; guard++) {
      const st = await page.evaluate(() => {
        const app = window.__mosaic;
        if (!app.state || app.state.status !== 'active') return { status: app.state ? app.state.status : null };
        const p = app.state.pieces.find((x) => !x.placed);
        return {
          status: app.state.status,
          needRotation: !!app.state.ruleset.needRotation,
          piece: p ? { id: p.id, cell: p.cell, rot: p.rot } : null
        };
      });
      if (st.status !== 'active') return;
      if (!st.piece) throw new Error('round active but no unplaced piece found');
      await page.locator(`#piece-list button[data-piece="${st.piece.id}"]`).click();
      if (st.needRotation && st.piece.rot !== 0) {
        for (let r = 0; r < (4 - st.piece.rot) % 4; r++) await page.locator('#btn-rotate').click();
      }
      await page.locator(`#cell-grid button[data-cell="${st.piece.cell}"]`).click();
      if (guard === 0 && shotName) await page.screenshot({ path: shotName });
    }
    throw new Error('round did not finish within 200 placements');
  };

  try {
    await step(`${label}: load + title visible`, async () => {
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__mosaic && !!window.__mosaic.renderer, null, { timeout: 15000 });
      await page.waitForSelector('.screen-card h2', { timeout: 10000 });
      const h2 = await page.textContent('.screen-card h2');
      if (!h2.includes('Mosaic Pieces')) throw new Error('title screen not shown, got: ' + h2);
      const webgl = await page.evaluate(() => window.__mosaic.renderer.webgl === true);
      if (!webgl) throw new Error('WebGL renderer not active');
      await page.screenshot({ path: SHOT('title', label) });
    });

    await step(`${label}: journey screen lists 40 stages, stage 1 unlocked`, async () => {
      await page.click('[data-action="nav-journey"]');
      const stages = await page.locator('[data-action="start-stage"]').count();
      if (stages !== 40) throw new Error(`expected 40 journey stages, got ${stages}`);
      const locked = await page.locator('[data-action="start-stage"][disabled]').count();
      if (locked !== 39) throw new Error(`expected 39 locked stages, got ${locked}`);
      await page.screenshot({ path: SHOT('journey', label) });
    });

    await step(`${label}: stage 1 setup screen`, async () => {
      await page.locator('[data-action="start-stage"][data-index="1"]').click();
      await page.waitForSelector('.screen-card table.score');
      const txt = await page.textContent('.screen-card');
      if (!txt.includes('Journey stage 1')) throw new Error('setup screen missing stage title');
      await page.screenshot({ path: SHOT('setup', label) });
    });

    await step(`${label}: start round → active with HUD and mirror`, async () => {
      await page.click('[data-action="confirm-start"]');
      await page.waitForFunction(() => window.__mosaic.state?.status === 'active', null, { timeout: 8000 });
      if (await page.locator('#hud').isHidden()) throw new Error('HUD not visible during play');
      await openActionsRail();
      const pieces = await page.locator('#piece-list button').count();
      const cells = await page.locator('#cell-grid button').count();
      if (pieces !== 4 || cells !== 4) throw new Error(`stage 1 mirror wrong: ${pieces} pieces, ${cells} cells`);
      if (!(await page.locator('#canvas-host canvas').count())) throw new Error('no WebGL canvas');
    });

    await step(`${label}: play full round via tray/cell buttons → results`, async () => {
      await playToCompletion(SHOT('play', label));
      await page.waitForFunction(() => window.__mosaic.state?.status === 'complete', null, { timeout: 5000 });
      await page.waitForSelector('.screen-card', { timeout: 5000 });
      const txt = await page.textContent('.screen-card');
      if (!txt.includes('Mosaic complete!')) throw new Error('win headline missing');
      if (!txt.includes('Total score')) throw new Error('score breakdown missing');
      await page.screenshot({ path: SHOT('results', label) });
    });

    await step(`${label}: progression persisted (journeyCompleted = 1)`, async () => {
      const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('mp-progress-v1')));
      if (prog.journeyCompleted !== 1) throw new Error('journey progress not persisted: ' + JSON.stringify(prog));
      if (!prog.achievements.includes('first_completion')) throw new Error('first_completion achievement missing');
    });

    await step(`${label}: retry → pause (Esc) → resume`, async () => {
      await page.click('[data-action="retry"]');
      await page.waitForFunction(() => window.__mosaic.state?.status === 'active', null, { timeout: 8000 });
      await openActionsRail();
      // place one piece first so undo has history later
      await playToCompletionOne(page);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.screen-card h2');
      const h2 = await page.textContent('.screen-card h2');
      if (h2 !== 'Paused') throw new Error('pause screen not shown, got: ' + h2);
      const snap = await page.evaluate(() => localStorage.getItem('mp-session-v1') !== null);
      if (!snap) throw new Error('session snapshot not saved');
      await page.screenshot({ path: SHOT('pause', label) });
      await page.click('[data-action="resume"]');
      await page.waitForFunction(() => window.__mosaic.paused === false && !window.__mosaic.ui.screenOpen);
    });

    async function playToCompletionOne(pg) {
      const p = await pg.evaluate(() => {
        const x = window.__mosaic.state.pieces.find((q) => !q.placed);
        return x ? { id: x.id, cell: x.cell } : null;
      });
      if (!p) return;
      await pg.locator(`#piece-list button[data-piece="${p.id}"]`).click();
      await pg.locator(`#cell-grid button[data-cell="${p.cell}"]`).click();
    }

    await step(`${label}: undo restores board via UI button`, async () => {
      await openActionsRail();
      const before = await page.evaluate(() => window.__mosaic.state.pieces.filter((p) => p.placed).length);
      if (before !== 1) throw new Error('expected 1 placed piece before undo, got ' + before);
      await page.locator('#btn-undo').click();
      const after = await page.evaluate(() => ({
        placed: window.__mosaic.state.pieces.filter((p) => p.placed).length,
        undos: window.__mosaic.state.undosUsed
      }));
      if (after.placed !== 0 || after.undos !== 1) throw new Error('undo failed: ' + JSON.stringify(after));
    });

    await step(`${label}: hint button applies a legal move`, async () => {
      await page.locator('#btn-hint').click();
      const st = await page.evaluate(() => ({
        hints: window.__mosaic.state.hintsUsed,
        placed: window.__mosaic.state.pieces.filter((p) => p.placed).length
      }));
      if (st.hints !== 1 || st.placed !== 1) throw new Error('hint did not place a piece: ' + JSON.stringify(st));
    });

    await step(`${label}: settings open → change → close`, async () => {
      await page.keyboard.press('Escape'); // pause
      await page.waitForSelector('.screen-card h2');
      await page.click('.screen [data-action="nav-settings"]');
      await page.waitForSelector('input[data-setting="highContrast"]');
      await page.check('input[data-setting="highContrast"]');
      await page.check('input[data-setting="reducedMotion"]');
      await page.selectOption('select[data-setting="theme"]', 'forest');
      const applied = await page.evaluate(() => ({
        contrast: document.body.classList.contains('high-contrast'),
        theme: document.body.dataset.theme,
        reduced: window.__mosaic.settings.reducedMotion
      }));
      if (!applied.contrast || applied.theme !== 'forest' || !applied.reduced) {
        throw new Error('settings not applied: ' + JSON.stringify(applied));
      }
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mp-settings-v1')));
      if (!saved.highContrast || saved.theme !== 'forest') throw new Error('settings not persisted');
      await page.screenshot({ path: SHOT('settings', label) });
      await page.click('[data-action="close-screen"]');
      // closing settings while paused returns to the pause screen
      await page.waitForSelector('.screen-card h2');
      const h2 = await page.textContent('.screen-card h2');
      if (h2 !== 'Paused') throw new Error('expected pause screen after settings, got: ' + h2);
    });

    await step(`${label}: help opens and closes from pause`, async () => {
      await page.click('.screen [data-action="nav-help"]');
      await page.waitForSelector('.screen-card h2');
      const h2 = await page.textContent('.screen-card h2');
      if (h2 !== 'How to play') throw new Error('help screen not shown, got: ' + h2);
      await page.click('[data-action="close-screen"]');
      await page.waitForSelector('.screen-card h2');
    });

    await step(`${label}: leave round → title → practice round`, async () => {
      await page.click('[data-action="quit-round"]');
      await page.waitForSelector('.screen-card h2');
      const h2 = await page.textContent('.screen-card h2');
      if (!h2.includes('Mosaic Pieces')) throw new Error('title not shown after leaving round');
      await page.click('[data-action="nav-mode"]');
      await page.click('[data-action="nav-practice"]');
      await page.click('[data-action="start-practice"][data-id="relaxed"]');
      const setup = await page.textContent('.screen-card');
      if (!setup.includes('Practice — Relaxed (3x3)')) throw new Error('practice setup missing');
      await page.click('[data-action="confirm-start"]');
      await page.waitForFunction(() => window.__mosaic.state?.status === 'active', null, { timeout: 8000 });
      if ((await page.locator('#piece-list button').count()) !== 9) throw new Error('practice mirror should show 9 pieces');
      await page.screenshot({ path: SHOT('practice', label) });
    });

    await step(`${label}: finish practice round via UI → results`, async () => {
      await playToCompletion();
      await page.waitForFunction(() => window.__mosaic.state?.status === 'complete', null, { timeout: 5000 });
      await page.waitForSelector('.screen-card');
      const txt = await page.textContent('.screen-card');
      if (!txt.includes('Total score')) throw new Error('practice results missing breakdown');
      await page.click('[data-action="nav-title"]');
      await page.waitForSelector('.screen-card h2');
    });

    await step(`${label}: mobile chrome / layout sanity`, async () => {
      if (hasTouch) {
        const rail = await page.locator('#actions-rail').boundingBox();
        const trayVisible = await page.locator('.bottom-tray').isVisible();
        if (!trayVisible) throw new Error('bottom tray not visible on portrait mobile');
        if (!rail) throw new Error('actions rail not measurable');
      } else {
        const rail = await page.locator('#actions-rail').boundingBox();
        if (!rail || rail.width < 100) throw new Error('actions rail not docked on desktop');
      }
    });
  } finally {
    if (errors.length) {
      await context.close();
      throw new Error(`${label} pass page errors:\n` + errors.join('\n'));
    }
    await context.close();
  }
}

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  await runPass(browser, 'desktop', { width: 1280, height: 800 }, false);
  await runPass(browser, 'mobile', { width: 390, height: 844 }, true);
  console.log('\nE2E PASS — desktop and mobile playthroughs clean, no page errors');
} finally {
  if (browser) await browser.close();
  server.close();
}
