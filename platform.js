'use strict';

// Mosaic Pieces — platform adapter. Hosted (StarHermit) mode: launch-token
// auth read from the URL fragment, Bearer on every call, 45-minute token
// refresh, account nickname, one-slot zip+base64 cloud save with debounced
// flush, and read-only platform leaderboards. Local dev mode (the game's own
// server.js) keeps the replay-validated submit/read routes and funnel events.
// Fully offline-capable: every call degrades to a null result instead of
// breaking play; localStorage stays the offline cache.

// ---------- minimal ZIP writer/reader (stored entries only, no compression) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const local = out.length;
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
export { zipStore, unzipFirstEntry, bytesToBase64, base64ToBytes };

// ---------- launch token ----------
function decodeJwtPayload(token) {
  // base64url decode only — the platform verifies; the client just reads claims
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
  } catch (_) { return null; }
}

function readLaunchToken() {
  // The platform delivers the token in the URL fragment: #game_token=<jwt>
  // (&session_id=<guid>). Read once, then strip it from the address bar.
  if (typeof window === 'undefined' || typeof location === 'undefined') return { token: null, sessionId: null };
  const fromHash = () => {
    const h = location.hash || '';
    if (!h || h.length < 2) return null;
    const params = new URLSearchParams(h.slice(1));
    const t = params.get('game_token');
    if (!t) return null;
    return { token: t, sessionId: params.get('session_id') };
  };
  const hit = fromHash();
  if (hit) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    return hit;
  }
  // Query-param fallbacks are for local dev only (never on *.starhermit.com).
  if (!/(^|\.)starhermit\.com$/.test(location.hostname)) {
    const q = new URLSearchParams(location.search);
    const t = q.get('token') || q.get('launch');
    if (t) return { token: t, sessionId: null };
  }
  return { token: null, sessionId: null };
}

const SAVE_ENTRY = 'save.json';
const REFRESH_MS = 45 * 60 * 1000; // token lifetime is 60 min; refresh ahead of it
const REFRESH_RETRY_MS = 60 * 1000;

export class Platform {
  constructor() {
    this.timeOffsetMs = 0; // serverNow - clientNow
    this.online = true;
    this.localDev = typeof location === 'undefined' || !/(^|\.)starhermit\.com$/.test(location.hostname);
    const launch = readLaunchToken();
    this.token = launch.token;
    this.sessionId = launch.sessionId;
    const claims = this.token ? decodeJwtPayload(this.token) : null;
    this.userId = claims && claims.sub != null ? String(claims.sub) : null;
    this.gameSlug = claims && claims.game_scope != null ? String(claims.game_scope) : null;
    this.hosted = !!this.token; // hosted mode activates iff a token was read
    this.nickname = null;
    this._profileCache = new Map();
    this._saveTimer = null;
    this._savePending = null;
    this.onSyncStatus = null; // app hooks the visible status slot
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => { this.flushCloudSave(); });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushCloudSave(); });
      }
    }
  }

  _headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...(extra || {}) };
    if (this.token) h['Authorization'] = 'Bearer ' + this.token;
    return h;
  }

  async req(path, opts = {}, timeoutMs = 5000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(path, {
        ...opts,
        signal: ctrl.signal,
        headers: this._headers(opts.headers)
      });
      const body = await res.json().catch(() => null);
      if (res.status === 429) return { error: 'rate-limited', retryable: true };
      if (!res.ok) return { error: (body && body.error) || ('http-' + res.status), retryable: res.status >= 500 };
      return { data: body };
    } catch (e) {
      return { error: 'offline', retryable: true };
    } finally {
      clearTimeout(t);
    }
  }

  // Synchronize with GET /api/v1/time using round-trip adjustment. The time
  // endpoint belongs to the game's own dev server; hosted mode keeps the
  // device clock (offset 0) so no on-platform 404 is logged.
  async syncTime() {
    if (!this.localDev) { this.online = true; return true; }
    const t0 = Date.now();
    const r = await this.req('/api/v1/time');
    if (r.data && typeof r.data.now === 'number') {
      const t1 = Date.now();
      this.timeOffsetMs = r.data.now - Math.round((t0 + t1) / 2);
      this.online = true;
    } else {
      this.online = false;
    }
    return this.online;
  }
  now() { return Date.now() + this.timeOffsetMs; }
  utcToday() { return new Date(this.now()).toISOString().slice(0, 10); }

  // ---------- token refresh ----------
  scheduleRefresh() {
    if (!this.hosted || !this.gameSlug || typeof setInterval === 'undefined') return;
    setInterval(() => this._refreshToken(), REFRESH_MS);
  }
  async _refreshToken() {
    if (!this.hosted || !this.gameSlug) return;
    const r = await this.req('/api/v1/games/' + encodeURIComponent(this.gameSlug) + '/launch-token', { method: 'POST' }, 10000);
    if (r.data && typeof r.data.token === 'string' && r.data.token) {
      this.token = r.data.token;
      return;
    }
    setTimeout(() => this._refreshToken(), REFRESH_RETRY_MS);
  }

  // ---------- account profile (nickname; never /api/v1/me, never usernames) ----------
  async profileFor(userId) {
    const id = String(userId);
    if (this._profileCache.has(id)) return this._profileCache.get(id);
    let name = null;
    if (this.hosted) {
      const r = await this.req('/api/v1/users/' + encodeURIComponent(id) + '/profile');
      if (r.data && r.data.nickname) name = String(r.data.nickname);
    }
    if (!name) name = 'Player ' + id.slice(0, 8);
    this._profileCache.set(id, name);
    return name;
  }
  async loadProfile() {
    if (!this.hosted || !this.userId) return null;
    this.nickname = await this.profileFor(this.userId);
    return this.nickname;
  }

  // ---------- cloud save (one slot, zip+base64; localStorage stays the cache) ----------
  _savePath() { return '/api/v1/me/cloud-saves/' + encodeURIComponent(this.gameSlug); }
  setSyncStatus(s) { if (this.onSyncStatus) this.onSyncStatus(s); }

  async loadCloudSave() {
    if (!this.hosted || !this.gameSlug) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(this._savePath(), { headers: this._headers(), signal: ctrl.signal });
      if (res.status === 404) { this.setSyncStatus('synced'); return null; } // no save yet
      if (!res.ok) throw new Error('http-' + res.status);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
      this.setSyncStatus('synced');
      return doc && typeof doc === 'object' ? doc : null;
    } catch (_) {
      this.setSyncStatus('offline');
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  saveCloudSoon(doc) {
    if (!this.hosted || !this.gameSlug) return;
    this._savePending = doc;
    this.setSyncStatus('saving');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { this.flushCloudSave(); }, 2000);
  }
  clearPendingSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._savePending = null;
  }
  async flushCloudSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    const doc = this._savePending;
    this._savePending = null;
    if (!this.hosted || !this.gameSlug || !doc) return;
    try {
      const bytes = zipStore(SAVE_ENTRY, new TextEncoder().encode(JSON.stringify(doc)));
      const res = await fetch(this._savePath(), {
        method: 'PUT',
        keepalive: true, // best effort when the page hides mid-flush
        headers: this._headers(),
        body: JSON.stringify({ dataBase64: bytesToBase64(bytes) })
      });
      this.setSyncStatus(res.ok ? 'synced' : 'offline');
    } catch (_) {
      this.setSyncStatus('offline');
    }
  }

  // ---------- platform leaderboards (read-only; clients can never submit) ----------
  async gameInfo() {
    if (!this.hosted || !this.gameSlug) return null;
    const r = await this.req('/api/v1/games/' + encodeURIComponent(this.gameSlug));
    return r.data || null;
  }
  async leaderboardEntries(leaderboardId, { friendsOnly = false, page = 0, pageSize = 20 } = {}) {
    const q = '?friendsOnly=' + (friendsOnly ? '1' : '0') + '&page=' + page + '&pageSize=' + pageSize;
    const r = await this.req('/api/v1/leaderboards/' + encodeURIComponent(leaderboardId) + '/entries' + q);
    if (r.data && Array.isArray(r.data.entries)) return r.data.entries;
    return Array.isArray(r.data) ? r.data : [];
  }

  // ---------- local dev only: the game's own server.js routes ----------
  // These are the replay-validated its-backend surface; on *.starhermit.com
  // they do not exist, so hosted mode never calls them (no on-platform 404s).
  async daily() {
    if (!this.localDev) return null;
    const r = await this.req('/api/v1/daily');
    return r.data || null;
  }
  async submitScore(payload) {
    if (!this.localDev) return { ok: false, error: 'read-only on the platform' };
    const r = await this.req('/api/v1/leaderboard/submit', { method: 'POST', body: JSON.stringify(payload) });
    return r.data || r; // {ok, rank} or {error}
  }
  async leaderboard(board, date) {
    if (!this.localDev) return [];
    const q = `?board=${encodeURIComponent(board)}${date ? '&date=' + encodeURIComponent(date) : ''}`;
    const r = await this.req('/api/v1/leaderboard' + q);
    return (r.data && r.data.entries) || [];
  }
  async unlockAchievement(key, sessionId) {
    // Achievements are local on the platform (part of the cloud-saved doc);
    // the POST below only reaches the game's own dev server.
    if (!this.localDev) return true;
    const r = await this.req('/api/v1/achievements', { method: 'POST', body: JSON.stringify({ key, sessionId }) });
    return !r.error;
  }
  // Anonymous funnel events: start, tutorial step, round end, retry,
  // settings change, error category. No text, no personal data. Dev only.
  event(name, data = {}) {
    if (!this.localDev || !this.online) return;
    const allowed = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
    if (!allowed.includes(name)) return;
    fetch('/api/v1/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, v: 1, ...data })
    }).catch(() => {});
  }
}
