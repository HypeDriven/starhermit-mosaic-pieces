'use strict';

// Mosaic Pieces — platform: same-origin /api adapter with retries,
// round-trip-adjusted server time, structured error handling, and
// anonymous funnel telemetry. Fully offline-capable: every call degrades
// to a null result instead of breaking play.

async function req(path, opts = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
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

export class Platform {
  constructor() {
    this.timeOffsetMs = 0; // serverNow - clientNow
    this.online = true;
  }
  // Synchronize with GET /api/v1/time using round-trip adjustment.
  async syncTime() {
    const t0 = Date.now();
    const r = await req('/api/v1/time');
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

  async daily() {
    const r = await req('/api/v1/daily');
    return r.data || null;
  }
  async submitScore(payload) {
    const r = await req('/api/v1/leaderboard/submit', { method: 'POST', body: JSON.stringify(payload) });
    return r.data || r; // {ok, rank} or {error}
  }
  async leaderboard(board, date) {
    const q = `?board=${encodeURIComponent(board)}${date ? '&date=' + encodeURIComponent(date) : ''}`;
    const r = await req('/api/v1/leaderboard' + q);
    return (r.data && r.data.entries) || [];
  }
  async unlockAchievement(key, sessionId) {
    const r = await req('/api/v1/achievements', { method: 'POST', body: JSON.stringify({ key, sessionId }) });
    return !r.error;
  }
  // Anonymous funnel events: start, tutorial step, round end, retry,
  // settings change, error category. No text, no personal data.
  event(name, data = {}) {
    if (!this.online) return;
    const allowed = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
    if (!allowed.includes(name)) return;
    fetch('/api/v1/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, v: 1, ...data })
    }).catch(() => {});
  }
}
