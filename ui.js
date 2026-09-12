'use strict';

// Mosaic Pieces — ui: responsive DOM shell, screens/overlays, focus
// management, accessibility mirror, settings forms, live announcements.

import { THEMES, JOURNEY, PRACTICE, CHALLENGES, LESSONS } from './content.js';
import { PALETTES, scoreComponents } from './rules.js';

const GLYPHS = ['▲', '◆', '●', '■', '★', '✚'];
export const ACHIEVEMENTS = Object.freeze([
  { key: 'first_completion', label: 'First Mosaic', desc: 'Complete your first mosaic.' },
  { key: 'rotation_master', label: 'Rotation Master', desc: 'Complete a rotation stage without hints.' },
  { key: 'streak_3', label: 'Gallery Regular', desc: 'Complete mosaics on 3 different days.' },
  { key: 'journey_20', label: 'Half the Gallery', desc: 'Complete journey stage 20.' },
  { key: 'long_haul', label: 'Patient Curator', desc: 'Spend 60 total minutes in the gallery (any assists).' }
]);

export class UI {
  constructor() {
    this.root = document.getElementById('overlay-root');
    this.live = document.getElementById('live-region');
    this.alert = document.getElementById('alert-region');
    this.hud = document.getElementById('hud');
    this.lastFocus = null;
  }

  announce(msg, assertive = false) {
    const el = assertive ? this.alert : this.live;
    el.textContent = '';
    // re-set on next tick so repeated messages are announced
    setTimeout(() => { el.textContent = msg; }, 30);
  }

  openScreen(html, { label } = {}) {
    this.lastFocus = document.activeElement;
    this.root.innerHTML = '';
    const scr = document.createElement('div');
    scr.className = 'screen';
    scr.setAttribute('role', 'dialog');
    scr.setAttribute('aria-modal', 'true');
    if (label) scr.setAttribute('aria-label', label);
    scr.innerHTML = `<div class="screen-card">${html}</div>`;
    this.root.appendChild(scr);
    const first = scr.querySelector('button, [href], input, select, [tabindex]');
    if (first) first.focus();
    return scr;
  }
  closeScreen() {
    this.root.innerHTML = '';
    if (this.lastFocus && this.lastFocus.isConnected) this.lastFocus.focus();
    this.lastFocus = null;
  }
  get screenOpen() { return this.root.childElementCount > 0; }

  // ---------- screens ----------
  titleScreen(prog) {
    const journeyPct = Math.round(100 * prog.journeyCompleted / JOURNEY.length);
    return this.openScreen(`
      <h2>Mosaic Pieces</h2>
      <p>Assemble interlocking pieces into a picture on the gallery desk — snapping, trays, rotation and optional hints.</p>
      <ul class="menu-list">
        <li><button type="button" class="btn btn-primary" data-action="nav-mode">Play</button></li>
        <li><button type="button" class="btn" data-action="start-daily">Daily challenge<small>One shared mosaic per UTC day — ranked.</small></button></li>
        <li><button type="button" class="btn" data-action="nav-journey">Journey<small>${prog.journeyCompleted}/${JOURNEY.length} stages (${journeyPct}%) — next: stage ${prog.nextJourney}.</small></button></li>
        <li><button type="button" class="btn" data-action="nav-profile">Profile &amp; achievements<small>${prog.achievements.length}/${ACHIEVEMENTS.length} achievements unlocked.</small></button></li>
        <li><button type="button" class="btn" data-action="nav-leaderboard">Leaderboards</button></li>
      </ul>`, { label: 'Title' });
  }

  modeScreen() {
    return this.openScreen(`
      <h2>Choose a mode</h2>
      <ul class="menu-list">
        <li><button type="button" class="btn" data-action="nav-learn">Learn<small>Interactive lessons — one rule at a time. ~3 min.</small></button></li>
        <li><button type="button" class="btn" data-action="nav-journey">Journey<small>40 authored stages with growing mechanics. Ranked progression.</small></button></li>
        <li><button type="button" class="btn" data-action="start-daily">Daily<small>Shared seed per UTC day. Ranked, no undo.</small></button></li>
        <li><button type="button" class="btn" data-action="nav-practice">Practice<small>Your difficulty, restart and undo, never ranked.</small></button></li>
        <li><button type="button" class="btn" data-action="nav-challenge">Challenge<small>Move limits, speed targets, altered layouts.</small></button></li>
        <li><button type="button" class="btn" data-action="nav-leaderboard">Score chase<small>Global and friends score comparison.</small></button></li>
      </ul>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-title">Back</button></div>`, { label: 'Mode select' });
  }

  learnScreen() {
    return this.openScreen(`
      <h2>Learn</h2>
      <p>Each lesson introduces one rule and asks you to perform it.</p>
      <ul class="menu-list">
        ${LESSONS.map((l, i) => `<li><button type="button" class="btn" data-action="start-lesson" data-index="${i}">${l.title}<small>${l.ruleset.label}</small></button></li>`).join('')}
      </ul>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-mode">Back</button></div>`, { label: 'Learn' });
  }

  journeyScreen(prog) {
    const btn = (s) => {
      const done = prog.journeyCompleted >= s.index;
      const unlocked = s.index <= prog.nextJourney;
      return `<li><button type="button" class="btn" data-action="start-stage" data-index="${s.index}" ${unlocked ? '' : 'disabled'}>
        ${done ? '✓ ' : ''}Stage ${s.index}${s.mastery ? ' ★' : ''}<small>${s.ruleset.label}${s.mastery ? ' — mastery' : ''}${unlocked ? '' : ' — locked'}</small></button></li>`;
    };
    return this.openScreen(`
      <h2>Journey</h2>
      <p>${prog.journeyCompleted}/${JOURNEY.length} complete. ★ marks mastery stages.</p>
      <ul class="menu-list" style="max-height:50vh;overflow-y:auto">${JOURNEY.map(btn).join('')}</ul>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-mode">Back</button></div>`, { label: 'Journey' });
  }

  practiceScreen() {
    return this.openScreen(`
      <h2>Practice</h2>
      <p>Relaxed play: restart and undo allowed, never ranked.</p>
      <ul class="menu-list">
        ${PRACTICE.map(p => `<li><button type="button" class="btn" data-action="start-practice" data-id="${p.id}">${p.label}</button></li>`).join('')}
      </ul>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-mode">Back</button></div>`, { label: 'Practice' });
  }

  challengeScreen() {
    return this.openScreen(`
      <h2>Challenge</h2>
      <ul class="menu-list">
        ${CHALLENGES.map(c => `<li><button type="button" class="btn" data-action="start-challenge" data-id="${c.id}">${c.label}<small>${c.desc}</small></button></li>`).join('')}
      </ul>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-mode">Back</button></div>`, { label: 'Challenge' });
  }

  // Mode setup: rules, expected duration, assists, ranked — before commitment.
  setupScreen(info) {
    return this.openScreen(`
      <h2>${info.title}</h2>
      <p>${info.desc}</p>
      <table class="score">
        <tr><th>Board</th><td>${info.ruleset.cols}×${info.ruleset.rows}</td></tr>
        <tr><th>Rotation</th><td>${info.ruleset.needRotation ? 'Yes' : 'No'}</td></tr>
        <tr><th>Move limit</th><td>${info.ruleset.moveLimit || 'None'}</td></tr>
        <tr><th>Time limit</th><td>${info.ruleset.timeLimitSec ? info.ruleset.timeLimitSec + ' s' : 'None'}</td></tr>
        <tr><th>Undo</th><td>${info.undo ? 'Allowed' : 'Not allowed'}</td></tr>
        <tr><th>Hints</th><td>Available (cost score)</td></tr>
        <tr><th>Ranked</th><td>${info.ranked ? (info.rankedLabel || 'Yes') : 'No'}</td></tr>
        <tr><th>Expected duration</th><td>${info.duration}</td></tr>
      </table>
      <div class="row">
        <button type="button" class="btn btn-primary" data-action="confirm-start">Start</button>
        <button type="button" class="btn btn-ghost" data-action="nav-mode">Back</button>
      </div>`, { label: 'Mode setup' });
  }

  pauseScreen(settings) {
    return this.openScreen(`
      <h2>Paused</h2>
      <div class="row"><button type="button" class="btn btn-primary" data-action="resume">Resume</button></div>
      <h3>Audio</h3>
      ${this._volumeSliders(settings)}
      <div class="row">
        <button type="button" class="btn" data-action="nav-settings">Settings &amp; accessibility</button>
        <button type="button" class="btn" data-action="nav-help">Help</button>
        <button type="button" class="btn btn-ghost" data-action="quit-round">Leave round</button>
      </div>`, { label: 'Paused' });
  }

  resultsScreen(state, extra) {
    const c = scoreComponents(state);
    const win = state.status === 'complete';
    const rows = [
      ['Pieces placed', c.placement],
      ['Completion bonus', c.completion],
      ['Efficiency bonus', c.efficiency],
      ['Hints used', -c.hintCost],
      ['Undos used', -c.undoCost],
      ['Invalid actions', -c.invalidPenalty]
    ];
    return this.openScreen(`
      <h2>${win ? 'Mosaic complete!' : 'Round over'}</h2>
      <p>${win ? 'The picture hangs on the gallery wall.' : 'Reason: ' + (state.terminalReason || 'abandoned')}</p>
      <table class="score">
        ${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v > 0 ? '+' : ''}${v}</td></tr>`).join('')}
        <tr><th>Total score</th><td><strong>${c.total}</strong></td></tr>
        <tr><th>Time</th><td>${formatTime(state.elapsedMs)}</td></tr>
        <tr><th>Moves</th><td>${state.moves}</td></tr>
        <tr><th>Tiles matching the goal image</th><td>${state.pieces.filter(p => p.placed && p.placedCell === p.id).length}/${state.pieces.length}</td></tr>
      </table>
      ${extra || ''}
      <div class="row">
        <button type="button" class="btn btn-primary" data-action="retry">Play again</button>
        ${win ? '<button type="button" class="btn" data-action="next-recommended">Next recommended</button>' : ''}
        <button type="button" class="btn btn-ghost" data-action="nav-title">Title</button>
      </div>`, { label: 'Results' });
  }

  helpScreen(bindings) {
    return this.openScreen(`
      <h2>How to play</h2>
      <p>Sort the tray pieces, read the edge colors and glyphs, and drag each piece onto its matching board cell. Pieces snap when legal. Complete connected groups to finish the picture.</p>
      <h3>Controls</h3>
      <ul>
        <li><strong>Pointer / touch:</strong> tap a piece to select, tap a glowing cell to place. Drag pieces directly. Double-tap a piece to rotate.</li>
        <li><strong>Keyboard:</strong> ${bindings}</li>
        <li>Every action gives immediate visual and sonic feedback; illegal targets explain why.</li>
      </ul>
      <h3>Scoring</h3>
      <p>+100 per placed piece, completion and efficiency bonuses; hints, undos and invalid actions cost points. Time is tracked separately so relaxed play stays valid.</p>
      <div class="row"><button type="button" class="btn btn-primary" data-action="close-screen">Close</button></div>`, { label: 'Help' });
  }

  settingsScreen(settings) {
    const chk = (k) => settings[k] ? 'checked' : '';
    return this.openScreen(`
      <h2>Settings</h2>
      <h3>Audio</h3>
      ${this._volumeSliders(settings)}
      <div class="settings-grid">
        <label>Mute all <input type="checkbox" data-setting="muted" ${chk('muted')}></label>
      </div>
      <h3>Graphics</h3>
      <div class="settings-grid">
        <label>Quality tier
          <select data-setting="quality">
            ${['high', 'medium', 'low'].map(q => `<option value="${q}" ${settings.quality === q ? 'selected' : ''}>${q}</option>`).join('')}
          </select></label>
        <label>Theme
          <select data-setting="theme">
            ${THEMES.map(t => `<option value="${t.id}" ${settings.theme === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select></label>
      </div>
      <h3>Accessibility</h3>
      <div class="settings-grid">
        <label>Reduced motion <input type="checkbox" data-setting="reducedMotion" ${chk('reducedMotion')}></label>
        <label>High contrast <input type="checkbox" data-setting="highContrast" ${chk('highContrast')}></label>
        <label>Larger text <input type="checkbox" data-setting="largeText" ${chk('largeText')}></label>
        <label>Color-vision-safe palette <input type="checkbox" data-setting="cvdPalette" ${chk('cvdPalette')}></label>
        <label>Hold-to-drag (off = toggle select) <input type="checkbox" data-setting="holdToDrag" ${chk('holdToDrag')}></label>
        <label>Left-handed layout <input type="checkbox" data-setting="leftHanded" ${chk('leftHanded')}></label>
        <label>Timing assistance (double time limits) <input type="checkbox" data-setting="timingAssist" ${chk('timingAssist')}></label>
      </div>
      <div class="row">
        <button type="button" class="btn" data-action="replay-tutorial">Replay tutorial</button>
        <button type="button" class="btn btn-primary" data-action="close-screen">Done</button>
      </div>`, { label: 'Settings' });
  }

  profileScreen(prog, displayName, meta = {}) {
    const who = meta.hosted
      ? `Signed in as <strong>${escapeHtml(displayName)}</strong> — progress syncs to your account (status sits next to the clock).`
      : `Playing as <strong>${escapeHtml(displayName)}</strong> (local guest profile; sign-in is offered by the host shell).`;
    return this.openScreen(`
      <h2>Profile</h2>
      <p>${who}</p>
      <h3>Achievements</h3>
      <ul class="menu-list">
        ${ACHIEVEMENTS.map(a => `<li><button type="button" class="btn" disabled>${prog.achievements.includes(a.key) ? '🏆 ' : '🔒 '}${a.label}<small>${a.desc}</small></button></li>`).join('')}
      </ul>
      <p>Total gallery time: ${formatTime(prog.totalTimeMs || 0)}</p>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-title">Back</button></div>`, { label: 'Profile' });
  }

  leaderboardScreen(html) {
    return this.openScreen(`
      <h2>Score chase</h2>
      ${html}
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-title">Back</button></div>`, { label: 'Leaderboards' });
  }

  _volumeSliders(settings) {
    const v = settings.volumes;
    return `<div class="settings-grid">
      ${['music', 'effects', 'ambience', 'voice'].map(b =>
        `<label>${b[0].toUpperCase() + b.slice(1)} <input type="range" min="0" max="1" step="0.05" value="${v[b]}" data-volume="${b}"></label>`).join('')}
    </div>`;
  }

  // ---------- HUD & accessibility mirror ----------
  showHud(show) { this.hud.hidden = !show; }
  updateHud(state, modeLabel, timeLeftSec) {
    document.getElementById('hud-mode').textContent = modeLabel;
    const placed = state.pieces.filter(p => p.placed).length;
    document.getElementById('hud-placed').textContent = `${placed}/${state.pieces.length} placed`;
    document.getElementById('hud-time').textContent = formatTime(state.elapsedMs);
    document.getElementById('hud-score').textContent = 'Score ' + scoreComponents(state).total;
    const lim = document.getElementById('hud-limit');
    if (state.ruleset.moveLimit > 0) {
      const left = state.ruleset.moveLimit - state.moves;
      lim.textContent = `${left} moves left`;
      lim.classList.toggle('warn', left <= 3);
    } else if (timeLeftSec != null) {
      lim.textContent = `${Math.max(0, Math.ceil(timeLeftSec))}s left`;
      lim.classList.toggle('warn', timeLeftSec <= 30);
    } else {
      lim.textContent = '';
      lim.classList.remove('warn');
    }
  }
  setObjective(text) { document.getElementById('objective-text').textContent = text; }
  setProgress(html) { document.getElementById('progress-block').innerHTML = html; }

  mirrorBoard(state, selectedId, candidateCells) {
    const palette = PALETTES[state.ruleset.theme] || PALETTES.default;
    const list = document.getElementById('piece-list');
    list.innerHTML = '';
    for (const id of state.tray) {
      const p = state.pieces.find(x => x.id === id);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.piece = String(id);
      b.disabled = p.placed;
      b.setAttribute('aria-pressed', selectedId === id ? 'true' : 'false');
      b.style.background = palette[p.colorIndex % palette.length];
      b.textContent = GLYPHS[p.colorIndex % GLYPHS.length];
      b.setAttribute('aria-label', `Piece ${id + 1}, ${GLYPHS[p.colorIndex % GLYPHS.length]} tile` +
        (p.placed ? ', placed' : (p.rot ? `, rotated ${p.rot * 90} degrees` : ', upright') + (selectedId === id ? ', selected' : '')));
      li.appendChild(b);
      list.appendChild(li);
    }
    const grid = document.getElementById('cell-grid');
    grid.style.gridTemplateColumns = `repeat(${state.ruleset.cols}, minmax(30px, 1fr))`;
    grid.innerHTML = '';
    const n = state.ruleset.cols * state.ruleset.rows;
    for (let c = 0; c < n; c++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.cell = String(c);
      const filled = state.occupied[c] !== undefined;
      b.className = filled ? 'filled' : (candidateCells.includes(c) ? 'candidate' : '');
      const x = c % state.ruleset.cols + 1, y = Math.floor(c / state.ruleset.cols) + 1;
      // the goal tile for a cell is the piece whose home cell it is
      const goal = state.pieces.find(p => p.id === c);
      const goalGlyph = goal ? GLYPHS[goal.colorIndex % GLYPHS.length] : '·';
      const here = filled ? state.pieces.find(p => p.id === state.occupied[c]) : null;
      const matches = here ? here.id === c : false;
      b.textContent = filled ? (matches ? GLYPHS[here.colorIndex % GLYPHS.length] : GLYPHS[here.colorIndex % GLYPHS.length] + '≠') : goalGlyph;
      b.setAttribute('aria-label', `Cell column ${x} row ${y}, goal ${goalGlyph} tile` +
        (filled
          ? `, holds piece ${here.id + 1}, ${matches ? 'matches the goal' : 'does not match the goal'}`
          : (candidateCells.includes(c) ? ', legal target' : '')));
      b.disabled = filled;
      grid.appendChild(b);
    }
  }

  toastAchievement(label) {
    const t = document.createElement('div');
    t.className = 'achievement-toast';
    t.textContent = '🏆 Achievement unlocked: ' + label;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  applyA11yClasses(settings) {
    document.body.classList.toggle('high-contrast', !!settings.highContrast);
    document.body.classList.toggle('large-text', !!settings.largeText);
    document.body.classList.toggle('left-handed', !!settings.leftHanded);
    document.body.dataset.theme = settings.theme || 'default';
  }
}

export function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
