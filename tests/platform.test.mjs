// Platform adapter over the shared StarHermit SDK: launch token, profile
// name, game:<slug> cloud-save round-trip, settings KV, controls, and no
// network at all when standalone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Load the shipped SDK copy as a classic script (the package is ESM).
const sdkModule = { exports: {} };
new Function('module', 'self', fs.readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(sdkModule, globalThis);
const SDK = sdkModule.exports;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = 'h.' + b64u({ sub: 'user-123456', game_scope: 'mosaic-slug', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';

// SDK renewal timers must not keep the test process alive.
const unrefTimeout = (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; };

function fakeServer() {
  const calls = [], saves = {}, kv = {};
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push([method, url]);
    const r = (status, body) => new Response(body == null ? null : body, { status });
    if (url.includes('/cloud-saves/')) {
      const key = decodeURIComponent(url.split('/cloud-saves/')[1]);
      if (method === 'PUT') { saves[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return r(200, '{}'); }
      return saves[key] ? r(200, saves[key]) : r(404);
    }
    if (url.endsWith('/profile')) return r(200, JSON.stringify({ username: 'u', nickname: 'Tess' }));
    if (url.endsWith('/settings') && method === 'PATCH') { Object.assign(kv, JSON.parse(init.body).settings); return r(200, '{}'); }
    if (url.endsWith('/settings')) return r(200, JSON.stringify({ settings: kv }));
    if (url.endsWith('/controls')) return r(200, JSON.stringify({ actions: [{ action: 'hint', codes: ['KeyJ'] }] }));
    if (url.endsWith('/api/v1/time')) return r(200, JSON.stringify({ now: Date.now() + 60000 }));
    return r(404);
  };
  return { calls, saves, kv, fetch };
}

function install(hash, srv, hostname = 'mosaic-slug.starhermit.com') {
  const win = {
    location: { hash, search: '', pathname: '/', hostname, origin: 'https://' + hostname, href: 'https://' + hostname + '/' },
    history: { replaceState() {} },
    addEventListener() {},
  };
  win.StarHermit = SDK.create({ window: win, fetch: srv.fetch, setTimeout: unrefTimeout });
  globalThis.window = win;
  globalThis.location = win.location;
  globalThis.fetch = srv.fetch; // any direct request is counted too
  return win;
}

test('hosted: token, profile, cloud save game:<slug>, settings, controls', async () => {
  const srv = fakeServer();
  install('#game_token=' + token, srv);
  const { Platform } = await import('../platform.js?hosted');
  const p = new Platform();
  assert.equal(p.hosted, true);
  assert.equal(p.userId, 'user-123456');
  assert.equal(p.gameSlug, 'mosaic-slug');
  assert.equal(await p.loadProfile(), 'Tess');
  assert.equal(await p.syncTime(), true); // platform clock, signed in only
  assert.ok(p.timeOffsetMs > 50000);

  p.saveCloudSoon({ v: 1, progress: { journeyCompleted: 4 } });
  await p.flushCloudSave();
  assert.deepEqual(Object.keys(srv.saves), ['game:mosaic-slug']);
  assert.deepEqual(await p.loadCloudSave(), { v: 1, progress: { journeyCompleted: 4 } });

  p.patchSettings({ muted: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(srv.kv.muted, true);
  assert.deepEqual(await p.getSettings(), { muted: true });

  const b = await p.loadBindings({ hint: ['KeyH'], undo: ['KeyU'] });
  assert.deepEqual(b, { hint: ['KeyJ'], undo: ['KeyU'] });
  assert.ok(p.inviteLink().endsWith('/game-invite/user-123456/mosaic-slug'));
  assert.equal(p.canSignIn(), false);
});

test('standalone: no token means no fetch at all', async () => {
  const srv = fakeServer();
  install('', srv, 'localhost');
  const { Platform } = await import('../platform.js?standalone');
  const p = new Platform();
  assert.equal(p.hosted, false);
  assert.equal(await p.syncTime(), false); // local clock, no request
  assert.equal(p.timeOffsetMs, 0);
  for (const gone of ['req', 'daily', 'submitScore', 'leaderboard', 'unlockAchievement', 'event']) assert.equal(p[gone], undefined, gone);
  assert.equal(await p.loadProfile(), null);
  assert.equal(await p.loadCloudSave(), null);
  p.saveCloudSoon({ v: 1 });
  await p.flushCloudSave();
  p.patchSettings({ muted: true });
  assert.equal(await p.getSettings(), null);
  assert.deepEqual(await p.loadBindings({ hint: ['KeyH'] }), { hint: ['KeyH'] });
  assert.equal(p.inviteLink(), null);
  assert.equal(p.canSignIn(), false);
  assert.equal(srv.calls.length, 0);
});
