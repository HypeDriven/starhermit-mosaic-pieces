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
  const calls = [], saves = {}, kv = {}, versions = {};
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const headers = init.headers || {};
    calls.push([method, url, headers['If-Match']]);
    const r = (status, body) => new Response(body == null ? null : body, { status });
    if (url.includes('/cloud-saves/')) {
      const rest = decodeURIComponent(url.split('/cloud-saves/')[1]);
      if (rest.endsWith('/info')) {
        const key = rest.slice(0, -5);
        return r(200, JSON.stringify(saves[key] ? { exists: true, etag: `"v${versions[key]}"` } : { exists: false }));
      }
      const key = rest;
      if (method === 'PUT') {
        // writes are conditional on the version the client last read (ETag)
        const cur = saves[key] ? `"v${versions[key]}"` : null;
        if (headers['If-Match'] && headers['If-Match'] !== cur) return r(412, JSON.stringify({ error: 'precondition failed', etag: cur }));
        if (headers['If-None-Match'] === '*' && saves[key]) return r(412, JSON.stringify({ error: 'precondition failed', etag: cur }));
        saves[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        versions[key] = (versions[key] || 0) + 1;
        return r(200, JSON.stringify({ etag: `"v${versions[key]}"` }));
      }
      return saves[key] ? r(200, saves[key]) : r(404);
    }
    if (url.endsWith('/profile')) return r(200, JSON.stringify({ username: 'u', nickname: 'Tess' }));
    if (url.endsWith('/settings') && method === 'PATCH') { Object.assign(kv, JSON.parse(init.body).settings); return r(200, '{}'); }
    if (url.endsWith('/settings')) return r(200, JSON.stringify({ settings: kv }));
    if (url.endsWith('/controls')) return r(200, JSON.stringify({ actions: [{ action: 'hint', codes: ['KeyJ'] }] }));
    if (url.endsWith('/api/v1/time')) return r(200, JSON.stringify({ now: Date.now() + 60000 }));
    return r(404);
  };
  // Another device writes the slot (bumps the version behind this client's back).
  const writeElsewhere = (key, doc) => { saves[key] = zipStored(JSON.stringify(doc)); versions[key] = (versions[key] || 0) + 1; };
  return { calls, saves, kv, fetch, writeElsewhere };
}

/* A minimal stored (uncompressed) zip with one save.json entry, as the platform serves it. */
function zipStored(text) {
  const data = Buffer.from(text, 'utf8');
  const name = Buffer.from('save.json');
  let c = ~0;
  for (const b of data) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  const crc = (~c) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function install(hash, srv, hostname = '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com') {
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
  for (const gone of ['req', 'daily', 'leaderboard', 'unlockAchievement', 'event']) assert.equal(p[gone], undefined, gone);
  assert.deepEqual(await p.submitScore(1200), { posted: false, rank: null }); // no request standalone
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

test('hosted: a save conflict reloads the cloud copy, merges it (onConflict) and saves the merge', async () => {
  const srv = fakeServer();
  install('#game_token=' + token, srv);
  const { Platform, mergeProgress } = await import('../platform.js?conflict');
  const p = new Platform();
  assert.equal(await p.loadCloudSave(), null); // empty slot: the first write is If-None-Match: *
  let mine = { journeyCompleted: 3, achievements: ['first_completion'], daysPlayed: ['2026-10-15'], totalTimeMs: 5000, best: { daily: { score: 900, elapsedMs: 50000, invalidActions: 0 } } };
  p.saveCloudSoon({ v: 1, progress: mine });
  await p.flushCloudSave();
  srv.writeElsewhere('game:mosaic-slug', { v: 1, progress: { journeyCompleted: 7, achievements: ['streak_3'], daysPlayed: ['2026-10-16'], totalTimeMs: 9000, best: { daily: { score: 800, elapsedMs: 40000, invalidActions: 0 }, chase: { score: 500, elapsedMs: 1000, invalidActions: 1 } } } });
  let merged = null;
  p.onConflict = (remote) => { merged = mergeProgress(mine, remote.progress); return { v: 1, progress: merged }; };
  p.saveCloudSoon({ v: 1, progress: mine });
  await p.flushCloudSave(); // refused (412) → resolveConflict reloads, merges, writes
  for (let i = 0; i < 20 && !srv.calls.filter((c) => c[0] === 'PUT').slice(2).length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(merged.journeyCompleted, 7);
  assert.deepEqual(merged.achievements.sort(), ['first_completion', 'streak_3']);
  assert.deepEqual(merged.daysPlayed, ['2026-10-15', '2026-10-16']);
  assert.equal(merged.totalTimeMs, 9000);
  assert.equal(merged.best.daily.score, 900);
  assert.equal(merged.best.chase.score, 500);
  const puts = srv.calls.filter((c) => c[0] === 'PUT');
  assert.equal(puts.at(-1)[2], '"v2"');
  assert.deepEqual((await p.loadCloudSave()).progress, merged);
});
