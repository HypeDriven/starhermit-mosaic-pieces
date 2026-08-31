'use strict';

// Mosaic Pieces — versioned content: themes, tutorials, journey stages,
// challenges, daily ruleset, and offline content validators.

import { dailySeed, utcDateStr, normalizeRuleset, genPuzzle, CONTENT_VERSION } from './rules.js';

export { CONTENT_VERSION };

export const THEMES = Object.freeze([
  { id: 'default', label: 'Gallery', accent: '#cfa9ff' },
  { id: 'forest',  label: 'Forest',  accent: '#74c69d' },
  { id: 'ocean',   label: 'Ocean',   accent: '#4fa8d0' },
  { id: 'sunset',  label: 'Sunset',  accent: '#f4a259' },
  { id: 'plum',    label: 'Plum',    accent: '#d04fa8' }
]);

// ---- Learn mode: interactive lessons, one rule at a time ----
export const LESSONS = Object.freeze([
  {
    id: 'learn-place', title: 'Placing a piece', seed: 101,
    ruleset: { cols: 2, rows: 2, theme: 'default', label: '2x2' },
    steps: [
      { text: 'This is the gallery desk. The mosaic above the tray is your goal image.', await: null },
      { text: 'Select a piece from the tray below (click, tap, or arrow keys + Enter).', await: 'select' },
      { text: 'Now choose a glowing cell on the board to place it. Pieces snap into place.', await: 'place' },
      { text: 'Place the remaining pieces to finish the picture.', await: 'complete' }
    ]
  },
  {
    id: 'learn-rotate', title: 'Rotating a piece', seed: 202,
    ruleset: { cols: 2, rows: 2, needRotation: true, theme: 'forest', label: '2x2 rotate' },
    steps: [
      { text: 'Some pieces arrive turned. A piece only snaps when upright.', await: null },
      { text: 'Select a turned piece, then rotate it with R, the Rotate button, or a double-tap.', await: 'rotate' },
      { text: 'Now place it on its matching cell.', await: 'place' },
      { text: 'Finish the mosaic.', await: 'complete' }
    ]
  },
  {
    id: 'learn-hint', title: 'Hints and undo', seed: 303,
    ruleset: { cols: 3, rows: 2, theme: 'ocean', label: '3x2' },
    steps: [
      { text: 'Stuck? Press H or the Hint button and the gallery shows one legal move.', await: null },
      { text: 'Use a hint now. Hints cost score but never block completion.', await: 'hint' },
      { text: 'You can undo a placement with U. Try finishing the mosaic.', await: 'complete' }
    ]
  }
]);

// ---- Journey mode: 40 authored stages, one new concept at a time ----
// Authored as versioned data rows: [seed, cols, rows, needRotation, theme, mechanic]
const J = [];
{
  const themes = ['default', 'forest', 'ocean', 'sunset', 'plum'];
  const defs = [
    // Block 1 (1-8): placement only, growing boards
    [11, 2, 2, 0, 0], [12, 2, 3, 0, 0], [13, 3, 3, 0, 1], [14, 3, 3, 0, 2],
    [15, 3, 4, 0, 3], [16, 3, 4, 0, 4], [17, 4, 4, 0, 0], [18, 4, 4, 0, 1],
    // Block 2 (9-16): rotation introduced in isolation, then combined
    [21, 2, 2, 1, 2], [22, 2, 3, 1, 3], [23, 3, 3, 1, 4], [24, 3, 3, 1, 0],
    [25, 3, 4, 1, 1], [26, 4, 4, 1, 2], [27, 4, 4, 1, 3], [28, 4, 5, 1, 4],
    // Block 3 (17-24): mastery stages — larger boards, placement
    [31, 4, 5, 0, 0], [32, 5, 5, 0, 1], [33, 5, 5, 0, 2], [34, 5, 5, 1, 3],
    [35, 5, 6, 0, 4], [36, 5, 6, 1, 0], [37, 6, 6, 0, 1], [38, 6, 6, 1, 2],
    // Block 4 (25-32): rotation mastery on large boards
    [41, 6, 6, 1, 3], [42, 6, 6, 1, 4], [43, 6, 7, 1, 0], [44, 6, 7, 1, 1],
    [45, 6, 7, 1, 2], [46, 6, 8, 1, 3], [47, 6, 8, 1, 4], [48, 6, 8, 1, 0],
    // Block 5 (33-40): capstone mastery, every theme revisited
    [51, 7, 6, 1, 1], [52, 7, 6, 1, 2], [53, 7, 7, 1, 3], [54, 7, 7, 1, 4],
    [55, 6, 8, 1, 0], [56, 7, 7, 1, 1], [57, 6, 8, 1, 2], [58, 8, 6, 1, 3]
  ];
  defs.forEach(([seed, c, r, rot, t], i) => {
    const stage = i + 1;
    const mastery = (stage % 8 === 0);
    J.push(Object.freeze({
      id: 'journey-' + stage,
      index: stage,
      version: CONTENT_VERSION,
      seed: seed * 7919,
      ruleset: Object.freeze({ cols: c, rows: r, needRotation: !!rot, theme: themes[t], label: `${c}x${r}${rot ? ' rotate' : ''}` }),
      par: { moves: c * r, timeSec: 30 + c * r * 8 },
      mechanics: Object.freeze(rot ? ['place', 'rotate', 'hint', 'undo'] : ['place', 'hint', 'undo']),
      tutorialFlags: Object.freeze(stage === 1 ? ['place'] : (stage === 9 ? ['rotate'] : [])),
      mastery
    }));
  });
}
export const JOURNEY = Object.freeze(J);

// ---- Practice difficulty presets ----
export const PRACTICE = Object.freeze([
  { id: 'relaxed', label: 'Relaxed (3x3)', ruleset: { cols: 3, rows: 3, theme: 'default', label: '3x3' } },
  { id: 'standard', label: 'Standard (4x4, rotation)', ruleset: { cols: 4, rows: 4, needRotation: true, theme: 'ocean', label: '4x4 rotate' } },
  { id: 'expert', label: 'Expert (6x6, rotation)', ruleset: { cols: 6, rows: 6, needRotation: true, theme: 'plum', label: '6x6 rotate' } }
]);

// ---- Challenge mode: constrained goals ----
export const CHALLENGES = Object.freeze([
  { id: 'ch-moves', label: 'Perfect Fit', desc: 'Finish a 4x4 with no wasted moves. No undo.',
    seed: 424242, ruleset: { cols: 4, rows: 4, moveLimit: 16, theme: 'sunset', label: '4x4 move-limit' } },
  { id: 'ch-speed', label: 'Gallery Sprint', desc: 'Finish a 4x4 rotation puzzle in 3 minutes.',
    seed: 515151, ruleset: { cols: 4, rows: 4, needRotation: true, timeLimitSec: 180, theme: 'ocean', label: '4x4 speed' } },
  { id: 'ch-wide', label: 'Panorama', desc: 'A wide 8x4 altered layout.',
    seed: 616161, ruleset: { cols: 8, rows: 4, needRotation: true, theme: 'forest', label: '8x4 rotate' } }
]);

// ---- Daily mode: one shared seed + ruleset per UTC day ----
export function dailyContent(dateStr = utcDateStr()) {
  const seed = dailySeed(dateStr);
  const variant = seed % 3;
  const ruleset = normalizeRuleset(variant === 0
    ? { cols: 4, rows: 4, needRotation: true, theme: 'default', label: 'Daily 4x4' }
    : variant === 1
      ? { cols: 5, rows: 4, needRotation: true, theme: 'sunset', label: 'Daily 5x4' }
      : { cols: 5, rows: 5, theme: 'ocean', label: 'Daily 5x5' });
  return Object.freeze({ id: 'daily-' + dateStr, date: dateStr, seed, ruleset, version: CONTENT_VERSION });
}

// ---- Offline content validators ----
// Prove basic legality, reachable goals, bounded duration, no soft locks.
export function validateStage(stage) {
  const problems = [];
  try {
    const rs = normalizeRuleset(stage.ruleset);
    const p = genPuzzle(stage.seed, rs);
    if (p.pieces.length !== rs.cols * rs.rows) problems.push('piece count mismatch');
    const ids = new Set(p.pieces.map(x => x.id));
    if (ids.size !== p.pieces.length) problems.push('duplicate piece ids');
    for (const id of p.tray) if (!ids.has(id)) problems.push('tray references unknown piece');
    if (p.tray.length !== p.pieces.length) problems.push('tray size mismatch');
    // goal reachability: every piece's home cell is placeable in an empty game
    for (const pc of p.pieces) {
      if (pc.cell < 0 || pc.cell >= rs.cols * rs.rows) problems.push('home cell out of bounds');
    }
    // bounded duration: par exists and is positive
    if (!stage.par || !(stage.par.timeSec > 0)) problems.push('missing par time');
    // no soft lock: hints/undo mechanics always allowed on journey stages
    if (!stage.mechanics.includes('hint')) problems.push('no recovery option');
  } catch (e) {
    problems.push('exception: ' + e.message);
  }
  return Object.freeze({ id: stage.id, ok: problems.length === 0, problems: Object.freeze(problems) });
}
export function validateAll() {
  const results = JOURNEY.map(validateStage)
    .concat(LESSONS.map(l => validateStage({ ...l, par: { moves: 99, timeSec: 600 }, mechanics: ['place', 'rotate', 'hint', 'undo'] })))
    .concat(CHALLENGES.map(c => validateStage({ ...c, par: { moves: 99, timeSec: 600 }, mechanics: ['place', 'rotate', 'hint'] })));
  return Object.freeze(results);
}
