'use strict';

// Mosaic Pieces — the save document and the game's own options, pure and
// DOM-free (native/platform.ts on the engine, tests/progress.test.mjs in Node).
//
// The progress record is the browser build's (app.js DEFAULT_PROGRESS):
// furthest journey stage, achievements, the UTC days a mosaic was finished,
// total gallery time, the local profile's name and the personal bests per
// board ('daily' | 'chase'). Two copies merge so neither side loses anything
// (mergeProgress: the browser build's saveconflict merge, unchanged). The
// browser build's cloud slot held { v: 1, savedAt, progress, settings }
// (readForeign); its settings carry the game's own options (theme, colour-vision
// palette, timing assistance, left-handed layout) — volumes, mute, graphics,
// reduced motion, high contrast and larger text are the runtime's Options now.

import { compareResults } from './rules.js';

export const DEFAULT_PROGRESS = Object.freeze({
  journeyCompleted: 0, achievements: [], daysPlayed: [], totalTimeMs: 0, displayName: 'Guest',
  best: {} // board ('daily'|'chase') -> {score, elapsedMs, invalidActions, date?}
});

const THEME_IDS = ['default', 'forest', 'ocean', 'sunset', 'plum'];
export const DEFAULT_OPTIONS = Object.freeze({ theme: 'default', cvdPalette: false, timingAssist: false, leftHanded: false });
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
/** Every key the browser build mirrored into the account's settings KV (removed once migrated). */
export const BROWSER_KEYS = ['volumes', 'muted', 'theme', 'reducedMotion', 'highContrast', 'largeText', 'cvdPalette', 'holdToDrag',
  'timingAssist', 'leftHanded', 'graphics', 'ui.language'];

const num = (x) => (Number.isFinite(x) ? x : 0);
const strings = (a) => (Array.isArray(a) ? a.filter((s) => typeof s === 'string') : []);

function cleanBest(b) {
  const out = {};
  if (!b || typeof b !== 'object') return out;
  for (const board of ['daily', 'chase']) {
    const r = b[board];
    if (!r || typeof r !== 'object' || !Number.isFinite(r.score)) continue;
    const e = { score: r.score, elapsedMs: num(r.elapsedMs), invalidActions: num(r.invalidActions) };
    if (typeof r.date === 'string') e.date = r.date;
    out[board] = e;
  }
  return out;
}

/** A well-formed progress record from anything (null → the defaults). */
export function normalize(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    journeyCompleted: Math.max(0, Math.min(40, Math.floor(num(p.journeyCompleted)))),
    achievements: [...new Set(strings(p.achievements))],
    daysPlayed: [...new Set(strings(p.daysPlayed))].sort(),
    totalTimeMs: Math.max(0, num(p.totalTimeMs)),
    displayName: typeof p.displayName === 'string' && p.displayName ? p.displayName : 'Guest',
    best: cleanBest(p.best),
  };
}

/** Merge two progress records (this device's and another device's save) so
 *  neither side's progress is lost: further journey, union of achievements and
 *  days, larger total time, better personal bests. */
export function mergeProgress(local, remote) {
  const a = local || {};
  const b = remote || {};
  const best = { ...(b.best || {}) };
  for (const [board, mine] of Object.entries(a.best || {})) {
    const theirs = best[board];
    const better = !theirs || !mine ? (mine || theirs)
      : compareResults(
        { score: mine.score, completed: true, invalidActions: mine.invalidActions || 0, elapsedMs: mine.elapsedMs || 0, sessionId: 'a' },
        { score: theirs.score, completed: true, invalidActions: theirs.invalidActions || 0, elapsedMs: theirs.elapsedMs || 0, sessionId: 'b' }) <= 0 ? mine : theirs;
    best[board] = better;
  }
  return {
    ...b, ...a,
    journeyCompleted: Math.max(num(a.journeyCompleted), num(b.journeyCompleted)),
    achievements: [...new Set([...(a.achievements || []), ...(b.achievements || [])])],
    daysPlayed: [...new Set([...(a.daysPlayed || []), ...(b.daysPlayed || [])])].sort(),
    totalTimeMs: Math.max(num(a.totalTimeMs), num(b.totalTimeMs)),
    best,
  };
}

/** Both copies merged and normalized (the engine save's conflict handler). */
export function mergeSaves(local, remote) {
  return normalize(mergeProgress(normalize(local), normalize(remote)));
}
export function sameProgress(a, b) { return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)); }

/** Only valid option values (unknown keys and bad values left out). */
export function pickOptions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.theme === 'string' && THEME_IDS.includes(raw.theme)) out.theme = raw.theme;
  for (const k of ['cvdPalette', 'timingAssist', 'leftHanded']) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  return out;
}

/** The browser build's cloud document ({ v: 1, savedAt, progress, settings }, JSON text): its progress and options, or null. */
export function readForeign(text) {
  if (typeof text !== 'string' || !text) return null;
  let doc;
  try { doc = JSON.parse(text); } catch (_) { return null; }
  if (!doc || typeof doc !== 'object' || !doc.progress || typeof doc.progress !== 'object') return null;
  return { progress: normalize(doc.progress), options: pickOptions(doc.settings) };
}
