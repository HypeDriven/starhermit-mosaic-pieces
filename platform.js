'use strict';

// Mosaic Pieces — platform adapter over the shared StarHermit SDK
// (starhermit-sdk.js, loaded by index.html as window.StarHermit). Hosted
// mode = a launch token was read (#game_token / #access_token); the SDK owns
// the token, its renewal, the one-slot `game:<slug>` cloud save, the
// per-player settings KV, controls and read-only leaderboards. Every call
// degrades to a null result instead of breaking play; localStorage stays the
// offline cache. Standalone (no token) no network request is ever made: local
// clock, local bests and achievements, no telemetry.

function sdk() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  return (w && w.StarHermit) || null;
}
const inited = new WeakSet();

export class Platform {
  constructor() {
    this.timeOffsetMs = 0; // serverNow - clientNow (signed in only)
    this.sh = sdk();
    if (this.sh && !inited.has(this.sh)) { inited.add(this.sh); this.sh.init(); }
    this.sessionId = this.sh ? this.sh.launchSessionId : null;
    this.nickname = null;
    this.onSyncStatus = null; // app hooks the visible status slot
    this.onAuth = null;       // app re-renders sign-in / invite buttons
    if (this.sh) {
      this.sh.on('saved', (ok) => this.setSyncStatus(ok ? 'synced' : 'offline'));
      this.sh.on('auth', (a) => {
        if (!a.signedIn) { this.nickname = null; this.setSyncStatus('local'); }
        if (this.onAuth) this.onAuth(a);
      });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pagehide', () => { this.flushCloudSave(); });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushCloudSave(); });
      }
    }
  }

  get hosted() { return !!(this.sh && this.sh.signedIn); }
  get userId() { return this.hosted ? String(this.sh.userId) : null; }
  get gameSlug() { return this.sh ? this.sh.slug : null; }

  // Platform clock (GET /api/v1/time, round-trip adjusted) only with a launch
  // token; standalone keeps the device clock and makes no request.
  async syncTime() {
    if (!this.hosted) return false;
    try {
      const t0 = Date.now();
      const r = await this.sh.api('/api/v1/time');
      if (r && typeof r.now === 'number') {
        this.timeOffsetMs = r.now - Math.round((t0 + Date.now()) / 2);
        return true;
      }
    } catch (_) { /* device clock */ }
    return false;
  }
  now() { return Date.now() + this.timeOffsetMs; }
  utcToday() { return new Date(this.now()).toISOString().slice(0, 10); }

  // Token renewal is owned by the SDK; kept for the app's call site.
  scheduleRefresh() {}

  // ---------- sign-in / invite ----------
  canSignIn() { return !!(this.sh && this.sh.canSignIn()); }
  signIn() { return !!(this.sh && this.sh.signIn()); }
  inviteLink() { return this.hosted ? this.sh.inviteLink() : null; }

  // ---------- account profile (nickname; never /api/v1/me) ----------
  async profileFor(userId) {
    const id = String(userId);
    const p = this.hosted ? await this.sh.profile(id) : null;
    return p ? p.displayName : 'Player ' + id.slice(0, 6);
  }
  async loadProfile() {
    if (!this.hosted) return null;
    this.nickname = await this.profileFor(this.userId);
    return this.nickname;
  }

  // ---------- cloud save (game:<slug>; localStorage stays the cache) ----------
  setSyncStatus(s) { if (this.onSyncStatus) this.onSyncStatus(s); }
  async loadCloudSave() {
    if (!this.hosted) return null;
    const doc = await this.sh.loadJSON();
    this.setSyncStatus('synced');
    return doc && typeof doc === 'object' ? doc : null;
  }
  saveCloudSoon(doc) {
    if (!this.hosted) return;
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
    const doc = this._savePending;
    this.clearPendingSave();
    if (!this.hosted || !doc) return;
    await this.sh.writeSave(JSON.stringify(doc), { keepalive: true }); // 'saved' event sets the status
  }

  // ---------- per-player settings KV ----------
  async getSettings() { return this.hosted ? this.sh.getSettings() : null; }
  patchSettings(obj) { if (this.hosted) this.sh.patchSettings(obj); }

  // ---------- controls ----------
  async loadBindings(defaults) {
    if (!this.hosted) return structuredClone(defaults);
    try { return await this.sh.loadBindings(defaults); } catch (_) { return structuredClone(defaults); }
  }

  // ---------- platform leaderboards (read-only; clients can never submit) ----------
  async gameInfo() { return this.hosted ? this.sh.getGame() : null; }
  async platformBoard(opts = {}) {
    if (!this.hosted) return { items: [], board: null };
    return this.sh.leaderboard(null, { pageSize: opts.pageSize || 20 });
  }
}
