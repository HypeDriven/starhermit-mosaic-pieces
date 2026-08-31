'use strict';

// Mosaic Pieces — authoritative JavaScript Game Script.
// Serves the static distribution and the same-origin /api used for
// server time, daily content, validated leaderboards, durable
// achievements, and anonymous funnel events. No secrets, no external deps.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Rules from './rules.js';
import { dailyContent, CONTENT_VERSION } from './content.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000;
const MAX_BODY = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.opus': 'audio/ogg'
};

// ---------- tiny durable store ----------
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); } catch (_) { return fallback; }
}
function saveJson(file, value) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value));
  } catch (_) {}
}
const boards = loadJson('leaderboards.json', {});       // boardKey -> [entries]
const achievements = loadJson('achievements.json', {}); // sessionId|key -> timestamp

// ---------- naive per-IP rate limiting ----------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + 60000; }
  rec.n++;
  hits.set(ip, rec);
  return rec.n > 120;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- leaderboard validation ----------
// Score claims are validated by replaying the ordered input log through the
// deterministic rules engine with the declared seed and ruleset.
function validateSubmission(body) {
  if (!body || typeof body !== 'object') return 'malformed';
  const { board, seed, ruleset, commands, score, elapsedMs } = body;
  if (board !== 'daily' && board !== 'chase') return 'unknown board';
  if (body.contentVersion !== CONTENT_VERSION) return 'stale content version';
  if (!Number.isInteger(seed) || seed < 0) return 'bad seed';
  if (!Array.isArray(commands) || commands.length > 5000) return 'bad command log';
  if (!Number.isInteger(score) || score < 0 || score > 1000000) return 'implausible score';
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 24 * 3600 * 1000) return 'implausible duration';
  if (typeof body.name === 'string' && body.name.length > 40) return 'name too long';
  let rs;
  try { rs = Rules.normalizeRuleset(ruleset); } catch (_) { return 'bad ruleset'; }
  // daily boards must use today's (or yesterday's, for late finishers) official seed
  if (board === 'daily') {
    const today = dailyContent(new Date().toISOString().slice(0, 10));
    const yesterday = dailyContent(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
    const okSeed = seed === today.seed || seed === yesterday.seed;
    if (!okSeed) return 'seed does not match an official daily';
    if (body.date && body.date !== today.date && body.date !== yesterday.date) return 'stale daily';
  }
  let result;
  try {
    result = Rules.replay(seed, rs, body.mode === 'daily' ? 'daily' : 'challenge', commands);
  } catch (e) {
    return 'replay failed: ' + (e.code || e.message);
  }
  if (result.state.status !== 'complete') return 'round not completed';
  if (result.score !== score) return 'score mismatch';
  if (body.finalHash && body.finalHash !== result.finalHash) return 'hash mismatch';
  return null; // valid
}

function submitEntry(body) {
  const key = body.board + (body.board === 'daily' ? ':' + (body.date || new Date().toISOString().slice(0, 10)) : '');
  const list = boards[key] || [];
  // idempotent by sessionId: resubmission replaces, never duplicates
  const entry = {
    name: String(body.name || 'Guest').slice(0, 40),
    sessionId: String(body.sessionId || '').slice(0, 64),
    score: body.score,
    elapsedMs: Math.floor(body.elapsedMs),
    invalidActions: body.invalidActions | 0,
    assists: body.assists || { hints: 0, undos: 0 },
    ruleset: body.ruleset.label || '',
    contentVersion: body.contentVersion,
    seed: body.seed,
    finalHash: body.finalHash || null,
    ts: Date.now()
  };
  const idx = list.findIndex(e => e.sessionId === entry.sessionId);
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  list.sort((a, b) => Rules.compareResults(
    { score: a.score, completed: true, invalidActions: a.invalidActions, elapsedMs: a.elapsedMs, sessionId: a.sessionId },
    { score: b.score, completed: true, invalidActions: b.invalidActions, elapsedMs: b.elapsedMs, sessionId: b.sessionId }));
  boards[key] = list.slice(0, 200);
  saveJson('leaderboards.json', boards);
  return { ok: true, rank: boards[key].indexOf(entry) + 1, board: key };
}

// ---------- request handling ----------
const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;

  if (p.startsWith('/api/')) {
    if (rateLimited(ip)) return sendJson(res, 429, { error: 'rate-limited' });
    try {
      if (p === '/api/v1/time' && req.method === 'GET') {
        return sendJson(res, 200, { now: Date.now(), iso: new Date().toISOString() });
      }
      if (p === '/api/v1/daily' && req.method === 'GET') {
        return sendJson(res, 200, dailyContent(new Date().toISOString().slice(0, 10)));
      }
      if (p === '/api/v1/leaderboard' && req.method === 'GET') {
        const board = url.searchParams.get('board') || 'chase';
        const date = url.searchParams.get('date');
        const key = board + (board === 'daily' ? ':' + (date || new Date().toISOString().slice(0, 10)) : '');
        return sendJson(res, 200, { board: key, entries: (boards[key] || []).slice(0, 100) });
      }
      if (p === '/api/v1/leaderboard/submit' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const problem = validateSubmission(body);
        if (problem) return sendJson(res, 422, { error: problem });
        return sendJson(res, 200, submitEntry(body));
      }
      if (p === '/api/v1/achievements' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const key = String(body.key || '');
        if (!/^[a-z0-9_]{3,40}$/.test(key)) return sendJson(res, 422, { error: 'bad achievement key' });
        const id = String(body.sessionId || 'anon').slice(0, 64) + '|' + key;
        if (!achievements[id]) { achievements[id] = Date.now(); saveJson('achievements.json', achievements); }
        return sendJson(res, 200, { ok: true, key, already: true });
      }
      if (p === '/api/v1/event' && req.method === 'POST') {
        await readBody(req); // anonymous funnel; counted, not stored with content
        return sendJson(res, 204, {});
      }
      return sendJson(res, 404, { error: 'unknown endpoint' });
    } catch (e) {
      return sendJson(res, 400, { error: 'bad request' });
    }
  }

  // static files (GET only, traversal-safe)
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
  let rel = decodeURIComponent(p === '/' ? '/index.html' : p);
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) return sendJson(res, 403, { error: 'forbidden' });
  if (filePath.startsWith(path.join(ROOT, 'data') + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: 'not found' });
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    // hashed/immutable assets can be cached long; html/api short
    const cache = rel.endsWith('three.min.js') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`mosaic-pieces server on http://localhost:${PORT}`);
});

export { server, validateSubmission };
