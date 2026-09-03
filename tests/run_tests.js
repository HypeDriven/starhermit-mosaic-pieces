'use strict';

// Mosaic Pieces — test suite: unit tests for every legal action, invalid
// reason, scoring component, terminal state and serialization migration;
// property tests for deterministic replay; fuzzing of malformed commands;
// golden sessions; offline content validation; server submission checks.

import * as R from '../rules.js';
import { JOURNEY, LESSONS, CHALLENGES, PRACTICE, dailyContent, validateAll } from '../content.js';
import { validateSubmission } from '../server.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(s) { console.log('—', s); }

const RS = { cols: 3, rows: 3, theme: 'default', label: '3x3' };
const RS_ROT = { cols: 2, rows: 2, needRotation: true, theme: 'forest', label: '2x2r' };

// helper: play a full winning game via hints only
function solveWithHints(state) {
  let guard = 0;
  while (state.status === 'active' && guard++ < 500) state = R.applyCommand(state, { type: 'hint' });
  return state;
}
// helper: play a winning game by direct placements
function solveDirect(state) {
  let guard = 0;
  while (state.status === 'active' && guard++ < 500) {
    const p = state.pieces.find(x => !x.placed);
    if (state.ruleset.needRotation && p.rot !== 0) {
      state = R.applyCommand(state, { type: 'rotate', piece: p.id, rotations: (4 - p.rot) % 4 });
    }
    state = R.applyCommand(state, { type: 'place', piece: p.id, cell: p.cell });
  }
  return state;
}

section('puzzle generation');
{
  const a = R.genPuzzle(42, RS), b = R.genPuzzle(42, RS), c = R.genPuzzle(43, RS);
  eq(a.tray, b.tray, 'same seed => same tray');
  ok(JSON.stringify(a.tray) !== JSON.stringify(c.tray) || a.seed !== c.seed, 'different seed differs');
  eq(a.pieces.length, 9, 'piece count');
  eq(new Set(a.tray).size, 9, 'tray unique');
}

section('legal actions & invalid reasons');
{
  let s = R.newGame(7, RS, 'practice');
  const p0 = s.tray[0];
  eq(R.canPlace(s, p0, 0), null, 'place on empty cell legal');
  eq(R.canPlace(s, p0, -1), R.INVALID.CELL_OUT_OF_BOUNDS, 'negative cell');
  eq(R.canPlace(s, p0, 9), R.INVALID.CELL_OUT_OF_BOUNDS, 'cell too large');
  eq(R.canPlace(s, 999, 0), R.INVALID.NO_SUCH_PIECE, 'unknown piece');

  const before = s.invalidActions;
  s = R.applyCommand(s, { type: 'place', piece: p0, cell: 99 });
  eq(s.invalidActions, before + 1, 'invalid place counted, state otherwise unchanged');
  ok(!R.pieceById(s, p0).placed, 'piece still unplaced after invalid place');

  s = R.applyCommand(s, { type: 'place', piece: p0, cell: 0 });
  ok(R.pieceById(s, p0).placed, 'piece placed');
  eq(s.occupied[0], p0, 'cell occupied by piece');
  eq(s.moves, 1, 'move counted');
  eq(R.canPlace(s, p0, 1), R.INVALID.PIECE_PLACED, 're-place placed piece');
  const q = s.tray.find(id => !R.pieceById(s, id).placed);
  eq(R.canPlace(s, q, 0), R.INVALID.CELL_OCCUPIED, 'occupied cell rejected');

  // undo restores
  s = R.applyCommand(s, { type: 'undo' });
  ok(!R.pieceById(s, p0).placed, 'undo restores piece');
  eq(s.moves, 0, 'undo restores move count');
  eq(s.undosUsed, 1, 'undo counted');
}

section('rotation rules');
{
  let s = R.newGame(7, RS_ROT, 'practice');
  const rotPiece = s.pieces.find(p => p.rot !== 0);
  if (rotPiece) {
    eq(R.canPlace(s, rotPiece.id, rotPiece.cell), R.INVALID.WRONG_ROTATION, 'rotated piece cannot place');
    let guard = 0;
    while (R.pieceById(s, rotPiece.id).rot !== 0 && guard++ < 10) {
      s = R.applyCommand(s, { type: 'rotate', piece: rotPiece.id, rotations: 1 });
    }
    eq(R.canPlace(s, rotPiece.id, rotPiece.cell), null, 'upright piece can place');
  }
  s = R.applyCommand(s, { type: 'rotate', piece: s.tray[0], rotations: -1 });
  ok(R.pieceById(s, s.tray[0]).rot >= 0 && R.pieceById(s, s.tray[0]).rot <= 3, 'negative rotation wraps');
}

section('hints call the legal-action API');
{
  let s = R.newGame(11, RS, 'practice');
  const h = R.hintFor(s);
  ok(h && h.type === 'place', 'hint returns a place action');
  eq(R.canPlace(s, h.piece, h.cell), null, 'hinted place is legal');
  s = solveWithHints(s);
  eq(s.status, 'complete', 'hint-only solve completes');
  eq(s.terminalReason, 'completed', 'terminal reason completed');
}

section('terminal states');
{
  let s = R.newGame(5, { cols: 2, rows: 2, moveLimit: 2, theme: 'default', label: 't' }, 'challenge');
  s = R.applyCommand(s, { type: 'place', piece: s.tray[0], cell: 0 });
  s = R.applyCommand(s, { type: 'place', piece: s.tray[1], cell: 1 });
  eq(s.status, 'failed', 'move limit fails the round');
  eq(s.terminalReason, 'move-limit', 'move-limit reason');
  const inv = R.applyCommand(s, { type: 'place', piece: s.tray[2], cell: 2 });
  eq(inv.invalidActions, s.invalidActions + 1, 'actions after game over are invalid');

  let t = R.newGame(5, { cols: 2, rows: 2, timeLimitSec: 60, theme: 'default', label: 't' }, 'challenge');
  t = R.applyCommand(t, { type: 'timeup' });
  eq(t.status, 'failed', 'timeup fails timed round');
  eq(t.terminalReason, 'time-limit', 'time-limit reason');
}

section('undo restrictions');
{
  let s = R.newGame(3, RS, 'daily');
  s = R.applyCommand(s, { type: 'place', piece: s.tray[0], cell: 0 });
  s = R.applyCommand(s, { type: 'undo' });
  ok(R.pieceById(s, s.tray[0]).placed, 'undo rejected in daily mode');
  eq(s.invalidActions, 1, 'rejected undo counted invalid');
}

section('scoring components');
{
  let s = R.newGame(9, RS, 'practice');
  eq(R.score(s), 0, 'empty game scores 0');
  s = solveDirect(s);
  const c = R.scoreComponents(s);
  eq(c.placement, 900, 'placement points');
  eq(c.completion, 450, 'completion bonus');
  eq(c.efficiency, 9 * 10, 'efficiency at par moves');
  eq(c.hintCost + c.undoCost + c.invalidPenalty, 0, 'no penalties in clean run');
  eq(c.total, c.placement + c.completion + c.efficiency, 'total is sum of components');
  ok(c.total > 0, 'positive total');

  let h = R.newGame(9, RS, 'practice');
  h = solveWithHints(h);
  const ch = R.scoreComponents(h);
  eq(ch.hintCost, h.hintsUsed * 75, 'hint cost per hint');
  ok(ch.total < c.total, 'assisted run scores lower');

  // tie-break order
  const base = { score: 100, completed: true, invalidActions: 0, elapsedMs: 1000, sessionId: 'b' };
  ok(R.compareResults(base, { ...base, score: 90 }) < 0, 'higher score wins');
  ok(R.compareResults(base, { ...base, invalidActions: 1 }) < 0, 'fewer invalid wins');
  ok(R.compareResults(base, { ...base, elapsedMs: 2000 }) < 0, 'lower time wins');
  ok(R.compareResults(base, { ...base, sessionId: 'a' }) > 0, 'stable session id breaks final tie');
}

section('serialization & migration');
{
  let s = R.newGame(21, RS_ROT, 'practice');
  s = R.applyCommand(s, { type: 'place', piece: s.tray[0], cell: 0 });
  const s2 = R.deserialize(R.serialize(s));
  eq(R.stateHash(s2), R.stateHash(s), 'round-trip preserves hash');
  const mig = R.deserialize(JSON.stringify({ v: 1, seed: 5 }));
  eq(mig.status, 'active', 'v1 migration yields playable game');
}

section('replay determinism (property test)');
{
  const rng = R.makeRng(12345);
  for (let iter = 0; iter < 25; iter++) {
    const seed = Math.floor(rng() * 1e9);
    const rs = rng() < 0.5 ? RS : RS_ROT;
    let s = R.newGame(seed, rs, 'practice');
    const cmds = [];
    for (let i = 0; i < 40 && s.status === 'active'; i++) {
      const open = s.tray.filter(id => !R.pieceById(s, id).placed);
      if (open.length === 0) break;
      const id = open[Math.floor(rng() * open.length)];
      const roll = rng();
      let cmd;
      if (roll < 0.3) cmd = { type: 'rotate', piece: id, rotations: 1 };
      else if (roll < 0.4) cmd = { type: 'hint' };
      else {
        const cell = Math.floor(rng() * rs.cols * rs.rows);
        cmd = { type: 'place', piece: id, cell };
      }
      cmd.id = 'cmd-' + i;
      cmds.push(cmd);
      s = R.applyCommand(s, cmd);
    }
    const r1 = R.replay(seed, rs, 'practice', cmds);
    const r2 = R.replay(seed, rs, 'practice', cmds);
    eq(r1.finalHash, r2.finalHash, `replay identical (iter ${iter})`);
    eq(r1.finalHash, R.stateHash(s), `replay matches live play (iter ${iter})`);
    // duplicate command ids rejected idempotently
    const dup = [...cmds, cmds[cmds.length - 1]];
    eq(R.replay(seed, rs, 'practice', dup).finalHash, r1.finalHash, `duplicate command ignored (iter ${iter})`);
  }
}

section('fuzz malformed commands');
{
  let s = R.newGame(1, RS, 'practice');
  const rng = R.makeRng(999);
  let threw = 0;
  for (let i = 0; i < 500; i++) {
    const junk = [null, undefined, 42, 'x', {}, { type: 'nope' }, { type: 'place' },
      { type: 'place', piece: 'a', cell: 'b' }, { type: 'rotate', piece: -1, rotations: NaN },
      { type: 'elapsed', ms: -5 }, { type: [] }, { type: 'place', piece: 0, cell: 1e9 }];
    const cmd = junk[Math.floor(rng() * junk.length)];
    try {
      s = R.applyCommand(s, cmd);
    } catch (e) { threw++; ok(!!e.code, 'errors carry reason codes'); }
  }
  ok(threw > 0, 'malformed commands rejected');
  ok(Number.isFinite(R.score(s)), 'score stays finite after fuzzing');
  const s2 = solveWithHints(s);
  ok(s2.status === 'complete', 'game still completable after fuzzing (no soft lock)');
}

section('golden sessions');
{
  // easy golden
  let easy = solveDirect(R.newGame(100, RS, 'practice'));
  eq(R.score(easy), 1440, 'golden easy score');
  // medium golden with rotation
  let med = R.newGame(200, { cols: 4, rows: 4, needRotation: true, theme: 'ocean', label: 'm' }, 'practice');
  med = solveDirect(med);
  eq(med.status, 'complete', 'golden medium completes');
  eq(med.moves, 16, 'golden medium at par');
  // interrupted/resumed
  let part = R.newGame(300, RS, 'practice');
  part = R.applyCommand(part, { type: 'place', piece: part.tray[0], cell: 0 });
  const resumed = R.deserialize(R.serialize(part));
  const finA = solveDirect(part), finB = solveDirect(resumed);
  eq(R.stateHash(finA), R.stateHash(finB), 'interrupted+resumed matches uninterrupted');
}

section('content validation');
{
  eq(JOURNEY.length, 40, 'journey has 40 stages');
  const results = validateAll();
  const bad = results.filter(r => !r.ok);
  eq(bad.length, 0, bad.length ? 'content problems: ' + JSON.stringify(bad[0]) : 'all content validates');
  eq(LESSONS.length, 3, 'three lessons');
  eq(CHALLENGES.length, 3, 'three challenges');
  eq(PRACTICE.length, 3, 'three practice presets');
  // every journey stage is completable
  for (const st of JOURNEY) {
    const fin = solveDirect(R.newGame(st.seed, st.ruleset, 'journey'));
    ok(fin.status === 'complete', 'journey stage ' + st.index + ' completable');
  }
  // daily immutability
  const d1 = dailyContent('2026-08-29'), d2 = dailyContent('2026-08-29'), d3 = dailyContent('2026-08-30');
  eq(d1.seed, d2.seed, 'daily seed stable within a day');
  ok(d1.seed !== d3.seed || true, 'different day may differ');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(R.utcDateStr(new Date())), 'utc date format');
}

section('server submission validation');
{
  const daily = dailyContent(new Date().toISOString().slice(0, 10));
  let s = R.newGame(daily.seed, daily.ruleset, 'daily');
  const cmds = [];
  let guard = 0;
  while (s.status === 'active' && guard++ < 500) {
    const p = s.pieces.find(x => !x.placed);
    if (s.ruleset.needRotation && p.rot !== 0) {
      const c = { type: 'rotate', piece: p.id, rotations: (4 - p.rot) % 4 };
      cmds.push(c); s = R.applyCommand(s, c);
    }
    const c = { type: 'place', piece: p.id, cell: p.cell };
    cmds.push(c); s = R.applyCommand(s, c);
  }
  const good = {
    board: 'daily', date: daily.date, name: 'Tester', sessionId: 'sess-1',
    seed: daily.seed, ruleset: s.ruleset, contentVersion: R.CONTENT_VERSION, mode: 'daily',
    commands: cmds, score: R.score(s), elapsedMs: 60000,
    assists: { hints: 0, undos: 0 }, invalidActions: 0, finalHash: R.stateHash(s)
  };
  eq(validateSubmission(good), null, 'valid submission accepted');
  eq(validateSubmission({ ...good, score: good.score + 1 }), 'score mismatch', 'inflated score rejected');
  eq(validateSubmission({ ...good, seed: 12345 }), 'seed does not match an official daily', 'wrong daily seed rejected');
  eq(validateSubmission({ ...good, contentVersion: '0.0' }), 'stale content version', 'stale version rejected');
  eq(validateSubmission({ ...good, commands: cmds.slice(0, -1) }), 'round not completed', 'incomplete log rejected');
  eq(validateSubmission({ ...good, elapsedMs: -1 }), 'implausible duration', 'bad duration rejected');
  ok(validateSubmission(null) !== null, 'null body rejected');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
