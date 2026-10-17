// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts the Relaxed practice round and keeps placing tiles through the visible tray and cell buttons
// (opening the actions drawer on phones) — tiles fly and settle, sparkles burst, dust drifts in the
// picture light. A finished mosaic is retried from the results screen.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('.screen [data-action="nav-settings"]', { timeout: 20000 });
  await page.click('.screen [data-action="nav-settings"]');
  await page.waitForSelector('#gfx-section #gfx-preset');
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('[data-action="close-screen"]');
  await page.waitForSelector('.screen-card h2');
}

async function step(page, mobile) {
  const st = await page.evaluate(() => {
    const app = window.__mosaic;
    if (!app.state || app.state.status !== 'active') return { status: app.state ? app.state.status : null };
    const p = app.state.pieces.find((x) => !x.placed);
    return { status: 'active', needRotation: !!app.state.ruleset.needRotation, piece: p ? { id: p.id, cell: p.cell, rot: p.rot } : null };
  });
  if (st.status === 'complete' || st.status === 'failed') {
    const retry = page.locator('[data-action="retry"]');
    if (await retry.count()) await retry.first().click({ timeout: 3000 });
    return;
  }
  if (st.status !== 'active' || !st.piece) return;
  const rail = page.locator('#actions-rail');
  const toggle = page.locator('[data-action="toggle-right-rail"]');
  const drawer = mobile && (await toggle.isVisible());
  if (drawer && !(await rail.evaluate((el) => el.classList.contains('open')))) await toggle.click();
  await page.locator(`#piece-list button[data-piece="${st.piece.id}"]`).click({ timeout: 3000 });
  if (st.needRotation && st.piece.rot !== 0) {
    for (let r = 0; r < (4 - st.piece.rot) % 4; r++) await page.locator('#btn-rotate').click();
  }
  await page.locator(`#cell-grid button[data-cell="${st.piece.cell}"]`).click({ timeout: 3000 });
  // close the drawer so the board is in view while the tile settles
  if (drawer && (await rail.evaluate((el) => el.classList.contains('open')))) await toggle.click().catch(() => {});
}

export async function start(page, { mobile } = {}) {
  await page.click('[data-action="nav-mode"]');
  await page.click('[data-action="nav-practice"]');
  await page.click('[data-action="start-practice"][data-id="relaxed"]');
  await page.click('[data-action="confirm-start"]');
  await page.waitForFunction(() => window.__mosaic.state?.status === 'active', null, { timeout: 15000 });
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try { await step(page, mobile); } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(500).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
