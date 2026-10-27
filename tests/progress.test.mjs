// The save document (progress.js): two devices' progress merges without loss
// (the browser build's saveconflict merge), records normalize, the browser
// build's cloud slot ({ v: 1, savedAt, progress, settings }) converts with its
// options, and only valid option values are kept. The engine client wires these
// to saves.onConflict / saves.foreign() in native/platform.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS, mergeProgress, mergeSaves, normalize, pickOptions, readForeign, sameProgress } from '../progress.js';

const mine = { journeyCompleted: 3, achievements: ['first_completion'], daysPlayed: ['2026-10-15'], totalTimeMs: 5000, best: { daily: { score: 900, elapsedMs: 50000, invalidActions: 0, date: '2026-10-15' } } };
const theirs = { journeyCompleted: 7, achievements: ['streak_3'], daysPlayed: ['2026-10-16'], totalTimeMs: 9000, best: { daily: { score: 800, elapsedMs: 40000, invalidActions: 0 }, chase: { score: 500, elapsedMs: 1000, invalidActions: 1 } } };

test('a conflict merges both devices: further journey, union of achievements and days, more time, better bests', () => {
  const m = mergeProgress(mine, theirs);
  assert.equal(m.journeyCompleted, 7);
  assert.deepEqual(m.achievements.sort(), ['first_completion', 'streak_3']);
  assert.deepEqual(m.daysPlayed, ['2026-10-15', '2026-10-16']);
  assert.equal(m.totalTimeMs, 9000);
  assert.equal(m.best.daily.score, 900);
  assert.equal(m.best.chase.score, 500);
  // symmetric in what it keeps
  const r = mergeProgress(theirs, mine);
  assert.equal(r.best.daily.score, 900);
  assert.equal(r.journeyCompleted, 7);
});

test('equal scores break on fewer invalid actions, then the faster time', () => {
  const a = { best: { chase: { score: 1000, elapsedMs: 9000, invalidActions: 2 } } };
  const b = { best: { chase: { score: 1000, elapsedMs: 20000, invalidActions: 0 } } };
  assert.equal(mergeProgress(a, b).best.chase.invalidActions, 0);
  const c = { best: { chase: { score: 1000, elapsedMs: 9000, invalidActions: 0 } } };
  assert.equal(mergeProgress(b, c).best.chase.elapsedMs, 9000);
});

test('normalize fills defaults and drops junk; mergeSaves is normalized and idempotent', () => {
  assert.deepEqual(normalize(null), { journeyCompleted: 0, achievements: [], daysPlayed: [], totalTimeMs: 0, displayName: 'Guest', best: {} });
  const n = normalize({ journeyCompleted: 99, achievements: ['a', 3, 'a'], daysPlayed: 'x', totalTimeMs: -4, best: { daily: { score: 'x' }, chase: { score: 5 }, other: { score: 1 } } });
  assert.equal(n.journeyCompleted, 40);
  assert.deepEqual(n.achievements, ['a']);
  assert.deepEqual(n.daysPlayed, []);
  assert.equal(n.totalTimeMs, 0);
  assert.deepEqual(n.best, { chase: { score: 5, elapsedMs: 0, invalidActions: 0 } });
  const once = mergeSaves(mine, theirs);
  assert.ok(sameProgress(mergeSaves(once, theirs), once));
  assert.ok(sameProgress(mergeSaves(once, null), once));
});

test("the browser build's cloud document converts with its game options", () => {
  const text = JSON.stringify({ v: 1, savedAt: 1790000000000, progress: theirs, settings: { volumes: { music: 0.2 }, muted: true, theme: 'ocean', cvdPalette: true, timingAssist: false, leftHanded: 'yes', reducedMotion: true } });
  const doc = readForeign(text);
  assert.equal(doc.progress.journeyCompleted, 7);
  assert.equal(doc.progress.best.chase.score, 500);
  assert.deepEqual(doc.options, { theme: 'ocean', cvdPalette: true, timingAssist: false });
  assert.equal(readForeign('not json'), null);
  assert.equal(readForeign(JSON.stringify({ v: 1 })), null);
  assert.equal(readForeign(null), null);
});

test('options keep only known themes and booleans', () => {
  assert.deepEqual(pickOptions({ theme: 'neon', cvdPalette: 1, leftHanded: true, timingAssist: false }), { leftHanded: true, timingAssist: false });
  assert.deepEqual(pickOptions({ theme: 'plum' }), { theme: 'plum' });
  assert.deepEqual(Object.keys(DEFAULT_OPTIONS).sort(), ['cvdPalette', 'leftHanded', 'theme', 'timingAssist']);
});
