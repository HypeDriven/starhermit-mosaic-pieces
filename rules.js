'use strict';

// Mosaic Pieces — rules engine.
// Pure, deterministic, DOM-free. Used by the browser client, the
// authoritative server (server.js) and the test-suite (test/run_tests.js).

export const SCHEMA_VERSION = 2;
export const CONTENT_VERSION = '1.0.0';
export const RULESET_VERSION = 1;

// ---------- deterministic random ----------
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Shared UTC-day seed for the Daily mode. Immutable once published.
export function dailySeed(utcDateStr) {
  return parseInt(fnv1a('mosaic-daily:' + utcDateStr), 16) >>> 0;
}

export function utcDateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// ---------- ruleset & level generation ----------

// A ruleset fully describes a puzzle instance.
// { cols, rows, needRotation, moveLimit (0=none), timeLimitSec (0=none), theme, label }
export function normalizeRuleset(rs) {
  if (!rs || typeof rs !== 'object') throw err('BAD_RULESET', 'ruleset missing');
  const cols = int(rs.cols, 2, 8), rows = int(rs.rows, 2, 8);
  const out = {
    cols, rows,
    needRotation: !!rs.needRotation,
    moveLimit: int(rs.moveLimit || 0, 0, 999),
    timeLimitSec: int(rs.timeLimitSec || 0, 0, 3600),
    theme: typeof rs.theme === 'string' ? rs.theme : 'default',
    label: typeof rs.label === 'string' ? rs.label : `${cols}x${rows}`
  };
  if (cols * rows > 64) throw err('BAD_RULESET', 'too many cells');
  return out;
}
function int(v, lo, hi) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < lo || n > hi) throw err('BAD_RULESET', 'integer out of bounds');
  return n;
}

// Deterministic mosaic image: palette index per cell, mirrored horizontally
// so the finished picture reads as an authored pattern, not noise.
export const PALETTES = Object.freeze({
  default: ['#8a4fd0', '#cfa9ff', '#ffd166', '#06d6a0', '#ef476f', '#118ab2'],
  forest:  ['#2d6a4f', '#74c69d', '#b7e4c7', '#ffd166', '#95d5b2', '#1b4332'],
  ocean:   ['#0b3d91', '#4fa8d0', '#cfe9ff', '#ffd166', '#118ab2', '#062a52'],
  sunset:  ['#d08a4f', '#ffe1cf', '#ef476f', '#ffd166', '#7a3b2e', '#f4a259'],
  plum:    ['#d04fa8', '#ffdff0', '#8a4fd0', '#cfa9ff', '#ffd166', '#3b2b47']
});

export function cellPaletteIndex(seed, cols, rows, x, y, paletteSize) {
  const mx = Math.min(x, cols - 1 - x); // horizontal mirror for authored look
  const h = fnv1a(`img:${seed}:${mx}:${y}`);
  return parseInt(h.slice(0, 4), 16) % paletteSize;
}

// Pieces are generated from the solved board and shuffled into a tray order.
// ids are stable integers 0..n-1 equal to their home cell index.
export function genPuzzle(seed, ruleset) {
  const rs = normalizeRuleset(ruleset);
  const n = rs.cols * rs.rows;
  const rng = makeRng((seed ^ 0x9e3779b9) >>> 0);
  const palette = PALETTES[rs.theme] || PALETTES.default;
  const pieces = [];
  for (let i = 0; i < n; i++) {
    const x = i % rs.cols, y = Math.floor(i / rs.cols);
    const pi = cellPaletteIndex(seed, rs.cols, rs.rows, x, y, palette.length);
    // correct rotation is always 0; pieces start scrambled when needRotation
    const startRot = rs.needRotation ? Math.floor(rng() * 4) : 0;
    pieces.push({ id: i, cell: i, x, y, colorIndex: pi, startRot });
  }
  // deterministic tray shuffle (Fisher-Yates on the rules stream)
  const tray = pieces.map(p => p.id);
  for (let i = tray.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tray[i], tray[j]] = [tray[j], tray[i]];
  }
  // never publish an already-solved tray order for tiny boards
  if (n <= 4 && tray.every((id, idx) => id === idx)) tray.reverse();
  return Object.freeze({ seed: seed >>> 0, ruleset: rs, pieces: Object.freeze(pieces), tray: Object.freeze(tray) });
}

// ---------- state ----------

export function newGame(seed, ruleset, mode = 'practice') {
  const p = genPuzzle(seed, ruleset);
  return freezeState({
    v: SCHEMA_VERSION,
    seed: p.seed,
    mode,
    ruleset: p.ruleset,
    pieces: p.pieces.map(pc => ({ id: pc.id, cell: pc.cell, colorIndex: pc.colorIndex, rot: pc.startRot, placed: false, placedCell: -1, placedRot: 0 })),
    tray: p.tray.slice(),
    occupied: {}, // cellIndex -> pieceId
    tick: 0,
    status: 'active',
    terminalReason: null,
    moves: 0,
    invalidActions: 0,
    hintsUsed: 0,
    undosUsed: 0,
    elapsedMs: 0,
    history: [],
    selected: null,
    commandLog: []
  });
}

function freezeState(s) {
  return s; // states are treated as immutable by convention; clone on write
}
export function cloneState(s) {
  return {
    ...s,
    ruleset: { ...s.ruleset },
    pieces: s.pieces.map(p => ({ ...p })),
    tray: s.tray.slice(),
    occupied: { ...s.occupied },
    history: s.history.map(h => ({ ...h })),
    commandLog: s.commandLog.slice()
  };
}

// ---------- errors ----------
export function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}
export const INVALID = Object.freeze({
  GAME_OVER: 'GAME_OVER',
  NO_SUCH_PIECE: 'NO_SUCH_PIECE',
  PIECE_PLACED: 'PIECE_PLACED',
  CELL_OCCUPIED: 'CELL_OCCUPIED',
  CELL_OUT_OF_BOUNDS: 'CELL_OUT_OF_BOUNDS',
  WRONG_ROTATION: 'WRONG_ROTATION',
  NOT_PLACED: 'NOT_PLACED',
  NOTHING_TO_UNDO: 'NOTHING_TO_UNDO',
  NO_HINT_AVAILABLE: 'NO_HINT_AVAILABLE',
  BAD_COMMAND: 'BAD_COMMAND'
});

// ---------- legality queries (used by play, tutorial and hints alike) ----------

export function isComplete(state) {
  return state.pieces.every(p => p.placed);
}
export function pieceById(state, id) {
  return state.pieces.find(p => p.id === id) || null;
}
export function canPlace(state, pieceId, cell) {
  if (state.status !== 'active') return INVALID.GAME_OVER;
  const p = pieceById(state, pieceId);
  if (!p) return INVALID.NO_SUCH_PIECE;
  if (p.placed) return INVALID.PIECE_PLACED;
  const n = state.ruleset.cols * state.ruleset.rows;
  if (!Number.isInteger(cell) || cell < 0 || cell >= n) return INVALID.CELL_OUT_OF_BOUNDS;
  if (state.occupied[cell] !== undefined) return INVALID.CELL_OCCUPIED;
  if (state.ruleset.needRotation && p.rot !== 0) return INVALID.WRONG_ROTATION;
  return null; // legal
}
export function legalTargetsFor(state, pieceId) {
  const out = [];
  const n = state.ruleset.cols * state.ruleset.rows;
  for (let c = 0; c < n; c++) if (canPlace(state, pieceId, c) === null) out.push(c);
  return out;
}
// A hint is simply the rules engine answering with a legal, correct placement.
export function hintFor(state) {
  if (state.status !== 'active') return null;
  for (const id of state.tray) {
    const p = pieceById(state, id);
    if (!p || p.placed) continue;
    if (state.ruleset.needRotation && p.rot !== 0) {
      return { type: 'rotate', piece: id, rotations: (4 - p.rot) % 4 };
    }
    if (canPlace(state, id, p.cell) === null) return { type: 'place', piece: id, cell: p.cell };
  }
  return null;
}
export function legalActions(state) {
  const out = [];
  if (state.status !== 'active') return Object.freeze(out);
  for (const id of state.tray) {
    const p = pieceById(state, id);
    if (p && !p.placed) {
      out.push({ type: 'rotate', piece: id });
      for (const c of legalTargetsFor(state, id)) out.push({ type: 'place', piece: id, cell: c });
    }
  }
  if (state.history.length > 0) out.push({ type: 'undo' });
  if (hintFor(state)) out.push({ type: 'hint' });
  return Object.freeze(out);
}

// ---------- command application ----------

// Mutating helper used internally on a cloned state.
function snapshotForUndo(s) {
  return {
    pieces: s.pieces.map(p => ({ ...p })),
    tray: s.tray.slice(),
    occupied: { ...s.occupied },
    moves: s.moves,
    status: s.status,
    terminalReason: s.terminalReason
  };
}
function checkTerminal(s) {
  if (s.status !== 'active') return;
  if (isComplete(s)) {
    s.status = 'complete';
    s.terminalReason = 'completed';
    return;
  }
  if (s.ruleset.moveLimit > 0 && s.moves >= s.ruleset.moveLimit) {
    s.status = 'failed';
    s.terminalReason = 'move-limit';
  }
}

// Returns a NEW state. Throws err(code) for illegal commands when
// opts.strict, otherwise records an invalid action and returns state.
export function applyCommand(prev, cmd, opts = {}) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') throw err(INVALID.BAD_COMMAND, 'malformed command');
  if (cmd.id !== undefined && (typeof cmd.id !== 'string' || cmd.id.length > 64)) throw err(INVALID.BAD_COMMAND, 'bad command id');
  const s = cloneState(prev);
  s.tick += 1;
  const invalid = (code) => {
    if (opts.strict) throw err(code, code);
    s.invalidActions += 1;
    return s;
  };

  switch (cmd.type) {
    case 'place': {
      const code = canPlace(s, cmd.piece, cmd.cell);
      if (code) return invalid(code);
      s.history.push(snapshotForUndo(s));
      const p = pieceById(s, cmd.piece);
      p.placed = true;
      p.placedCell = cmd.cell;
      p.placedRot = p.rot;
      s.occupied[cmd.cell] = p.id;
      s.moves += 1;
      s.selected = null;
      s.commandLog.push(stripCmd(cmd));
      checkTerminal(s);
      return s;
    }
    case 'rotate': {
      const p = pieceById(s, cmd.piece);
      if (s.status !== 'active') return invalid(INVALID.GAME_OVER);
      if (!p) return invalid(INVALID.NO_SUCH_PIECE);
      if (p.placed) return invalid(INVALID.PIECE_PLACED);
      const r = cmd.rotations === undefined ? 1 : Math.floor(Number(cmd.rotations));
      if (!Number.isFinite(r)) throw err(INVALID.BAD_COMMAND, 'bad rotations');
      p.rot = ((p.rot + r) % 4 + 4) % 4;
      s.commandLog.push(stripCmd(cmd));
      return s;
    }
    case 'select': {
      const p = pieceById(s, cmd.piece);
      if (s.status !== 'active') return invalid(INVALID.GAME_OVER);
      if (!p) return invalid(INVALID.NO_SUCH_PIECE);
      if (p.placed) return invalid(INVALID.PIECE_PLACED);
      s.selected = cmd.piece;
      return s;
    }
    case 'hint': {
      if (s.status !== 'active') return invalid(INVALID.GAME_OVER);
      const h = hintFor(s);
      if (!h) return invalid(INVALID.NO_HINT_AVAILABLE);
      s.hintsUsed += 1;
      s.commandLog.push(stripCmd(cmd));
      // apply the hinted action as part of the hint command
      if (h.type === 'rotate') {
        pieceById(s, h.piece).rot = 0;
      } else {
        s.history.push(snapshotForUndo(s));
        const p = pieceById(s, h.piece);
        p.placed = true; p.placedCell = h.cell; p.placedRot = p.rot;
        s.occupied[h.cell] = p.id;
        s.moves += 1;
        checkTerminal(s);
      }
      return s;
    }
    case 'undo': {
      if (s.mode === 'daily' || s.mode === 'challenge') return invalid(INVALID.NOTHING_TO_UNDO); // ranked modes: no undo
      if (s.history.length === 0) return invalid(INVALID.NOTHING_TO_UNDO);
      const snap = s.history.pop();
      s.pieces = snap.pieces;
      s.tray = snap.tray;
      s.occupied = snap.occupied;
      s.moves = snap.moves;
      s.status = snap.status;
      s.terminalReason = snap.terminalReason;
      s.undosUsed += 1;
      s.selected = null;
      s.commandLog.push(stripCmd(cmd));
      return s;
    }
    case 'timeup': {
      // authoritative clock (hosted play) declares the time limit reached
      if (s.status !== 'active') return s;
      if (s.ruleset.timeLimitSec > 0) {
        s.status = 'failed';
        s.terminalReason = 'time-limit';
        s.commandLog.push(stripCmd(cmd));
      }
      return s;
    }
    case 'elapsed': {
      const ms = Math.floor(Number(cmd.ms));
      if (!Number.isFinite(ms) || ms < 0 || ms > 24 * 3600 * 1000) throw err(INVALID.BAD_COMMAND, 'bad elapsed');
      s.elapsedMs = ms;
      return s;
    }
    default:
      throw err(INVALID.BAD_COMMAND, 'unknown command type: ' + cmd.type);
  }
}
function stripCmd(cmd) {
  const { id, ...rest } = cmd;
  void id;
  return rest;
}

// ---------- scoring ----------

export function scoreComponents(state) {
  const placedCount = state.pieces.filter(p => p.placed).length;
  const n = state.pieces.length;
  const placement = placedCount * 100;
  const completion = state.status === 'complete' ? n * 50 : 0;
  // par: perfect play needs exactly n placements; every extra move costs
  const efficiency = state.status === 'complete' ? Math.max(0, (n - state.moves) * 0) + Math.max(0, (2 * n - state.moves)) * 10 : 0;
  const hintCost = state.hintsUsed * 75;
  const undoCost = state.undosUsed * 25;
  const invalidPenalty = state.invalidActions * 10;
  const total = Math.max(0, placement + completion + efficiency - hintCost - undoCost - invalidPenalty);
  return Object.freeze({ placement, completion, efficiency, hintCost, undoCost, invalidPenalty, total });
}
export function score(state) { return scoreComponents(state).total; }

// Tie-break order: completion, fewer invalid actions, lower elapsed time, stable session id.
export function compareResults(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if ((b.completed ? 1 : 0) !== (a.completed ? 1 : 0)) return (b.completed ? 1 : 0) - (a.completed ? 1 : 0);
  if (a.invalidActions !== b.invalidActions) return a.invalidActions - b.invalidActions;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}

// ---------- serialization / replay ----------

export function serialize(state) {
  return JSON.stringify({ v: SCHEMA_VERSION, state });
}
export function deserialize(json) {
  const doc = JSON.parse(json);
  if (doc.v > SCHEMA_VERSION) throw err('BAD_VERSION', 'state from newer version');
  if (doc.v < SCHEMA_VERSION) return migrate(doc);
  return doc.state;
}
function migrate(doc) {
  // v1 stub prototype had no real puzzle state; start a fresh game instead of guessing.
  const s = newGame(doc.seed || 1, { cols: 3, rows: 3 }, 'practice');
  return s;
}
export function stateHash(state) {
  const core = {
    seed: state.seed, tick: state.tick, status: state.status,
    pieces: state.pieces.map(p => [p.id, p.placed ? p.placedCell : -1, p.rot]),
    moves: state.moves, inv: state.invalidActions, hints: state.hintsUsed, undos: state.undosUsed,
    score: score(state)
  };
  return fnv1a(JSON.stringify(core));
}

// Replay envelope: schema version, content version, seed, initial hash,
// ordered commands, periodic hashes, terminal result.
export function replay(seed, ruleset, mode, commands) {
  let state = newGame(seed, ruleset, mode);
  const initialHash = stateHash(state);
  const hashes = [initialHash];
  const seenIds = new Set();
  for (const cmd of commands) {
    if (cmd.id) {
      if (seenIds.has(cmd.id)) continue; // duplicate commands rejected idempotently
      seenIds.add(cmd.id);
    }
    state = applyCommand(state, cmd);
    hashes.push(stateHash(state));
  }
  return Object.freeze({ state, initialHash, hashes: Object.freeze(hashes), finalHash: stateHash(state), score: score(state) });
}
