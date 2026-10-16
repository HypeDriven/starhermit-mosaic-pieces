'use strict';

// Mosaic Pieces — ui: responsive DOM shell, screens/overlays, focus
// management, accessibility mirror, settings forms, live announcements.

import { THEMES, JOURNEY, PRACTICE, CHALLENGES, LESSONS } from './content.js';
import { PALETTES, scoreComponents } from './rules.js';
import { PRESETS, CATEGORIES, presetTier, describe } from './gfx.js';
import { gfxStrings, pickLocale, shStrings } from './gfx-i18n.js';
import { T, N, lang } from './lang.js';
const tr = T; // game strings inside functions whose local `T` is the Graphics table

// Graphics and account strings follow the game language (i18n.js).
const gfxLocale = () => pickLocale(lang());

const GLYPHS = ['▲', '◆', '●', '■', '★', '✚'];
export const ACHIEVEMENTS = Object.freeze([
  { key: 'first_completion', label: N('First Mosaic'), desc: N('Complete your first mosaic.') },
  { key: 'rotation_master', label: N('Rotation Master'), desc: N('Complete a rotation stage without hints.') },
  { key: 'streak_3', label: N('Gallery Regular'), desc: N('Complete mosaics on 3 different days.') },
  { key: 'journey_20', label: N('Half the Gallery'), desc: N('Complete journey stage 20.') },
  { key: 'long_haul', label: N('Patient Curator'), desc: N('Spend 60 total minutes in the gallery (any assists).') }
]);

/** Player-facing ruleset tag: board size plus its twist (ruleset.label stays the data id). */
export function rulesetLabel(rs) {
  const size = `${rs.cols}×${rs.rows}`;
  const twist = rs.moveLimit ? T('move limit') : rs.timeLimitSec ? T('speed') : rs.needRotation ? T('rotate') : '';
  return twist ? `${size} ${twist}` : size;
}
const esc = (s) => escapeHtml(s);

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

  /** Re-render the open screen in the current language (Settings → Language). */
  relabel() {
    if (!this.screenOpen) return;
    if (document.getElementById('settings-own')) { this._renderSettingsBoxes(); return; }
    if (this._last) this._last();
  }
  // Remembers how to rebuild the screen being opened, so relabel() can redraw it.
  _remember(fn) { this._last = fn; this._rerendering = true; try { return fn(); } finally { this._rerendering = false; } }

  openScreen(html, { label } = {}) {
    if (!this._rerendering) this._last = null; // a screen opened elsewhere (e.g. resume prompt) registers itself
    this.lastFocus = this._rerendering && this.screenOpen ? this.lastFocus : document.activeElement;
    this.root.innerHTML = '';
    const scr = document.createElement('div');
    scr.className = 'screen';
    scr.setAttribute('role', 'dialog');
    scr.setAttribute('aria-modal', 'true');
    if (label) scr.setAttribute('aria-label', label);
    scr.innerHTML = `<div class="screen-card">${html}</div>`;
    this.root.appendChild(scr);
    const first = scr.querySelector('button, [href], input, select, [tabindex]');
    // no scroll: the first button of a tall card (results on a phone) sits at the
    // bottom and would open the card scrolled past its heading
    if (first) first.focus({ preventScroll: true });
    scr.firstElementChild.scrollTop = 0;
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
    return this._remember(() => {
      const journeyPct = Math.round(100 * prog.journeyCompleted / JOURNEY.length);
      return this.openScreen(`
      <h2>Mosaic Pieces</h2>
      <p>${esc(T('Assemble interlocking pieces into a picture on the gallery desk — snapping, trays, rotation and optional hints.'))}</p>
      <ul class="menu-list">
        <li><button type="button" class="btn btn-primary" data-action="nav-mode">${esc(T('Play'))}</button></li>
        <li><button type="button" class="btn" data-action="start-daily">${esc(T('Daily challenge'))}<small>${esc(T('One shared mosaic per UTC day — ranked.'))}</small></button></li>
        <li><button type="button" class="btn" data-action="nav-journey">${esc(T('Journey'))}<small>${esc(T('{done}/{total} stages ({pct}%) — next: stage {next}.', { done: prog.journeyCompleted, total: JOURNEY.length, pct: journeyPct, next: prog.nextJourney }))}</small></button></li>
        <li><button type="button" class="btn" data-action="nav-profile">${esc(T('Profile & achievements'))}<small>${esc(T('{n}/{total} achievements unlocked.', { n: prog.achievements.length, total: ACHIEVEMENTS.length }))}</small></button></li>
        <li><button type="button" class="btn" data-action="nav-leaderboard">${esc(T('Leaderboards'))}</button></li>
        <li><button type="button" class="btn" data-action="nav-settings">${esc(T('Settings'))}<small>${esc(T('Audio, graphics and accessibility.'))}</small></button></li>
        ${this._accountItems(prog.account)}
      </ul>`, { label: T('Title') });
    });
  }

  // StarHermit account entries: sign-in (only offered on *.starhermit.com
  // without a token) and invite (only when signed in). Localized.
  _accountItems(acct = {}) {
    const S = shStrings(gfxLocale());
    const item = (action, label, sub) => `<li><button type="button" class="btn" data-action="${action}">${escapeHtml(label)}<small>${escapeHtml(sub)}</small></button></li>`;
    return (acct.signIn ? item('sh-sign-in', S.signIn, S.signInSub) : '') +
      (acct.invite ? item('sh-invite', S.invite, S.inviteSub) : '');
  }

  /** Localized StarHermit strings for the app (toasts). */
  shText(key) { return shStrings(gfxLocale())[key]; }

  toast(msg) {
    const t = document.createElement('div');
    t.className = 'achievement-toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    this._pushToast(t, 3500);
  }
  /** Toasts stack in one container (bottom centre in play). While a screen is
   *  open the stack moves to the top edge and the screen's top padding reserves
   *  its height (--toast-h, layout px of the equally zoomed stack), so a toast
   *  never covers a results heading or button. */
  _pushToast(t, ms) {
    let stack = document.querySelector('.toast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; document.body.appendChild(stack); }
    const fit = () => {
      const h = stack.offsetHeight;
      document.documentElement.style.setProperty('--toast-h', h ? `${h + 8}px` : '0px');
    };
    stack.appendChild(t); fit();
    setTimeout(() => { t.remove(); fit(); }, ms);
  }

  modeScreen() {
    return this._remember(() => this.openScreen(`
      <h2>${esc(T('Choose a mode'))}</h2>
      <ul class="menu-list">
        <li><button type="button" class="btn" data-action="nav-learn">${esc(T('Learn'))}<small>${esc(T('Interactive lessons — one rule at a time. ~3 min.'))}</small></button></li>
        <li><button type="button" class="btn" data-action="nav-journey">${esc(T('Journey'))}<small>${esc(T('40 authored stages with growing mechanics. Ranked progression.'))}</small></button></li>
        <li><button type="button" class="btn" data-action="start-daily">${esc(T('Daily'))}<small>${esc(T('Shared seed per UTC day. Ranked, no undo.'))}</small></button></li>
        <li><button type="button" class="btn" data-action="nav-practice">${esc(T('Practice'))}<small>${esc(T('Your difficulty, restart and undo, never ranked.'))}</small></button></li>
        <li><button type="button" class="btn" data-action="nav-challenge">${esc(T('Challenge'))}<small>${esc(T('Move limits, speed targets, altered layouts.'))}</small></button></li>
        <li><button type="button" class="btn" data-action="nav-leaderboard">${esc(T('Score chase'))}<small>${esc(T('Global and friends score comparison.'))}</small></button></li>
      </ul>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-title">${esc(T('Back'))}</button></div>`, { label: T('Mode select') }));
  }

  learnScreen() {
    return this._remember(() => this.openScreen(`
      <h2>${esc(T('Learn'))}</h2>
      <p>${esc(T('Each lesson introduces one rule and asks you to perform it.'))}</p>
      <ul class="menu-list">
        ${LESSONS.map((l, i) => `<li><button type="button" class="btn" data-action="start-lesson" data-index="${i}">${esc(T(l.title))}<small>${esc(rulesetLabel(l.ruleset))}</small></button></li>`).join('')}
      </ul>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-mode">${esc(T('Back'))}</button></div>`, { label: T('Learn') }));
  }

  journeyScreen(prog) {
    return this._remember(() => {
      const btn = (s) => {
        const done = prog.journeyCompleted >= s.index;
        const unlocked = s.index <= prog.nextJourney;
        const sub = [rulesetLabel(s.ruleset), s.mastery ? T('mastery') : '', unlocked ? '' : T('locked')].filter(Boolean).join(' — ');
        return `<li><button type="button" class="btn" data-action="start-stage" data-index="${s.index}" ${unlocked ? '' : 'disabled'}>
        ${done ? '✓ ' : ''}${esc(T('Stage {n}', { n: s.index }))}${s.mastery ? ' ★' : ''}<small>${esc(sub)}</small></button></li>`;
      };
      return this.openScreen(`
      <h2>${esc(T('Journey'))}</h2>
      <p>${esc(T('{done}/{total} complete. ★ marks mastery stages.', { done: prog.journeyCompleted, total: JOURNEY.length }))}</p>
      <ul class="menu-list" style="max-height:50vh;overflow-y:auto">${JOURNEY.map(btn).join('')}</ul>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-mode">${esc(T('Back'))}</button></div>`, { label: T('Journey') });
    });
  }

  practiceScreen() {
    return this._remember(() => this.openScreen(`
      <h2>${esc(T('Practice'))}</h2>
      <p>${esc(T('Relaxed play: restart and undo allowed, never ranked.'))}</p>
      <ul class="menu-list">
        ${PRACTICE.map(p => `<li><button type="button" class="btn" data-action="start-practice" data-id="${p.id}">${esc(T(p.label))}</button></li>`).join('')}
      </ul>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-mode">${esc(T('Back'))}</button></div>`, { label: T('Practice') }));
  }

  challengeScreen() {
    return this._remember(() => this.openScreen(`
      <h2>${esc(T('Challenge'))}</h2>
      <ul class="menu-list">
        ${CHALLENGES.map(c => `<li><button type="button" class="btn" data-action="start-challenge" data-id="${c.id}">${esc(T(c.label))}<small>${esc(T(c.desc))}</small></button></li>`).join('')}
      </ul>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-mode">${esc(T('Back'))}</button></div>`, { label: T('Challenge') }));
  }

  // Mode setup: rules, expected duration, assists, ranked — before commitment.
  // infoFn builds the (translated) info, so a language change re-renders it.
  setupScreen(infoFn) {
    return this._remember(() => {
      const info = infoFn();
      return this.openScreen(`
      <h2>${esc(info.title)}</h2>
      <p>${esc(info.desc)}</p>
      <table class="score">
        <tr><th>${esc(T('Board'))}</th><td>${info.ruleset.cols}×${info.ruleset.rows}</td></tr>
        <tr><th>${esc(T('Rotation'))}</th><td>${esc(info.ruleset.needRotation ? T('Yes') : T('No'))}</td></tr>
        <tr><th>${esc(T('Move limit'))}</th><td>${esc(info.ruleset.moveLimit || T('None'))}</td></tr>
        <tr><th>${esc(T('Time limit'))}</th><td>${esc(info.ruleset.timeLimitSec ? T('{n} s', { n: info.ruleset.timeLimitSec }) : T('None'))}</td></tr>
        <tr><th>${esc(T('Undo'))}</th><td>${esc(info.undo ? T('Allowed') : T('Not allowed'))}</td></tr>
        <tr><th>${esc(T('Hints'))}</th><td>${esc(T('Available (cost score)'))}</td></tr>
        <tr><th>${esc(T('Ranked'))}</th><td>${esc(info.ranked ? (info.rankedLabel || T('Yes')) : T('No'))}</td></tr>
        <tr><th>${esc(T('Expected duration'))}</th><td>${esc(info.duration)}</td></tr>
      </table>
      <div class="row">
        <button type="button" class="btn btn-primary" data-action="confirm-start">${esc(T('Start'))}</button>
        <button type="button" class="btn btn-ghost" data-action="nav-mode">${esc(T('Back'))}</button>
      </div>`, { label: T('Mode setup') });
    });
  }

  pauseScreen(settings) {
    return this._remember(() => this.openScreen(`
      <h2>${esc(T('Paused'))}</h2>
      <div class="row"><button type="button" class="btn btn-primary" data-action="resume">${esc(T('Resume'))}</button></div>
      <h3>${esc(T('Audio'))}</h3>
      ${this._volumeSliders(settings)}
      <div class="row">
        <button type="button" class="btn" data-action="nav-settings">${esc(T('Settings & accessibility'))}</button>
        <button type="button" class="btn" data-action="nav-help">${esc(T('Help'))}</button>
        <button type="button" class="btn btn-ghost" data-action="quit-round">${esc(T('Leave round'))}</button>
      </div>`, { label: T('Paused') }));
  }

  // extraFn returns extra results HTML (progress note, leaderboard line) in the current language.
  resultsScreen(state, extraFn) {
    return this._remember(() => {
      const c = scoreComponents(state);
      const win = state.status === 'complete';
      const rows = [
        [T('Pieces placed'), c.placement],
        [T('Completion bonus'), c.completion],
        [T('Efficiency bonus'), c.efficiency],
        [T('Hints used'), -c.hintCost],
        [T('Undos used'), -c.undoCost],
        [T('Invalid actions'), -c.invalidPenalty]
      ];
      const reasons = { 'time-limit': N('time ran out'), 'move-limit': N('out of moves'), abandoned: N('abandoned') };
      const reason = state.terminalReason || 'abandoned';
      const extra = typeof extraFn === 'function' ? extraFn() : (extraFn || '');
      return this.openScreen(`
      <h2>${esc(win ? T('Mosaic complete!') : T('Round over'))}</h2>
      <p>${esc(win ? T('The picture hangs on the gallery wall.') : T('Reason: {reason}', { reason: reasons[reason] ? T(reasons[reason]) : reason }))}</p>
      <table class="score">
        ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v > 0 ? '+' : ''}${v}</td></tr>`).join('')}
        <tr><th>${esc(T('Total score'))}</th><td><strong>${c.total}</strong></td></tr>
        <tr><th>${esc(T('Time'))}</th><td>${formatTime(state.elapsedMs)}</td></tr>
        <tr><th>${esc(T('Moves'))}</th><td>${state.moves}</td></tr>
        <tr><th>${esc(T('Tiles matching the goal image'))}</th><td>${state.pieces.filter(p => p.placed && p.placedCell === p.id).length}/${state.pieces.length}</td></tr>
      </table>
      ${extra || ''}
      <div class="row">
        <button type="button" class="btn btn-primary" data-action="retry">${esc(T('Play again'))}</button>
        ${win ? `<button type="button" class="btn" data-action="next-recommended">${esc(T('Next recommended'))}</button>` : ''}
        <button type="button" class="btn btn-ghost" data-action="nav-title">${esc(T('Title'))}</button>
      </div>`, { label: T('Results') });
    });
  }

  // bindingsFn returns the keyboard help line in the current language.
  helpScreen(bindingsFn) {
    return this._remember(() => this.openScreen(`
      <h2>${esc(T('How to play'))}</h2>
      <p>${esc(T('Sort the tray pieces, read the edge colors and glyphs, and drag each piece onto its matching board cell. Pieces snap when legal. Complete connected groups to finish the picture.'))}</p>
      <h3>${esc(T('Controls'))}</h3>
      <ul>
        <li>${T('<strong>Pointer / touch:</strong> tap a piece to select, tap a glowing cell to place. Drag pieces directly. Double-tap a piece to rotate.')}</li>
        <li>${T('<strong>Keyboard:</strong> {keys}', { keys: esc(typeof bindingsFn === 'function' ? bindingsFn() : bindingsFn) })}</li>
        <li>${esc(T('Every action gives immediate visual and sonic feedback; illegal targets explain why.'))}</li>
      </ul>
      <h3>${esc(T('Scoring'))}</h3>
      <p>${esc(T('+100 per placed piece, completion and efficiency bonuses; hints, undos and invalid actions cost points. Time is tracked separately so relaxed play stays valid.'))}</p>
      <div class="row"><button type="button" class="btn btn-primary" data-action="close-screen">${esc(T('Close'))}</button></div>`, { label: T('Help') }));
  }

  // The game's own settings live in three boxes (#settings-own, #gfx-own,
  // #settings-own-a11y) that a language change redraws in place; the shared
  // Language / Sound / Report sections (game-options.js) mount after #gfx-own
  // inside #gfx-section and are never redrawn.
  settingsScreen(settings, gfx) {
    this._settingsArgs = { settings, gfx };
    const scr = this._remember(() => this.openScreen(`
      <div id="settings-own"></div>
      <section id="gfx-section" class="gfx-section" aria-labelledby="gfx-h"><div id="gfx-own"></div></section>
      <div id="settings-own-a11y"></div>`, { label: T('Settings') }));
    this._renderSettingsBoxes();
    const first = scr.querySelector('button, input, select');
    if (first) first.focus({ preventScroll: true });
    return scr;
  }
  _renderSettingsBoxes() {
    const { settings, gfx } = this._settingsArgs || {};
    const top = document.getElementById('settings-own');
    if (!top || !settings) return;
    const chk = (k) => settings[k] ? 'checked' : '';
    top.innerHTML = `
      <h2>${esc(T('Settings'))}</h2>
      <h3>${esc(T('Audio'))}</h3>
      ${this._volumeSliders(settings)}
      <div class="settings-grid">
        <label>${esc(T('Mute all'))} <input type="checkbox" data-setting="muted" ${chk('muted')}></label>
      </div>`;
    document.getElementById('gfx-own').innerHTML = this._gfxSection(settings, gfx);
    document.getElementById('settings-own-a11y').innerHTML = `
      <h3>${esc(T('Accessibility'))}</h3>
      <div class="settings-grid">
        <label>${esc(T('Reduced motion'))} <input type="checkbox" data-setting="reducedMotion" ${chk('reducedMotion')}></label>
        <label>${esc(T('High contrast'))} <input type="checkbox" data-setting="highContrast" ${chk('highContrast')}></label>
        <label>${esc(T('Larger text'))} <input type="checkbox" data-setting="largeText" ${chk('largeText')}></label>
        <label>${esc(T('Color-vision-safe palette'))} <input type="checkbox" data-setting="cvdPalette" ${chk('cvdPalette')}></label>
        <label>${esc(T('Hold-to-drag (off = toggle select)'))} <input type="checkbox" data-setting="holdToDrag" ${chk('holdToDrag')}></label>
        <label>${esc(T('Left-handed layout'))} <input type="checkbox" data-setting="leftHanded" ${chk('leftHanded')}></label>
        <label>${esc(T('Timing assistance (double time limits)'))} <input type="checkbox" data-setting="timingAssist" ${chk('timingAssist')}></label>
      </div>
      <div class="row">
        <button type="button" class="btn" data-action="replay-tutorial">${esc(T('Replay tutorial'))}</button>
        <button type="button" class="btn btn-primary" data-action="close-screen">${esc(T('Done'))}</button>
      </div>`;
    // values are filled in after insertion by syncGfx()
    this.syncGfx(gfx.saved, gfx.info);
  }

  // ---------- Graphics section (localized; controls carry stable ids + data-gfx) ----------
  _gfxSection(settings, gfx) {
    const T = gfxStrings(gfxLocale());
    const info = gfx.info;
    const opt = (v, label) => `<option value="${v}">${escapeHtml(label)}</option>`;
    const cats = Object.entries(CATEGORIES).map(([cat, tiers]) => `
        <label for="gfx-cat-${cat}">${escapeHtml(T.cat[cat])}
          <select id="gfx-cat-${cat}" data-gfx="${cat}">
            ${opt('preset', T.fromPreset.replace('{tier}', T.tier[presetTier(info.resolved.preset, cat)]))}
            ${tiers.map(t => opt(t, T.tier[t])).join('')}
          </select></label>`).join('');
    const html = `
      <h3 id="gfx-h">${escapeHtml(T.graphics)}</h3>
      <div class="settings-grid">
        <label>${escapeHtml(tr('Theme'))}
          <select data-setting="theme">
            ${THEMES.map(t => `<option value="${t.id}" ${settings.theme === t.id ? 'selected' : ''}>${escapeHtml(tr(t.label))}</option>`).join('')}
          </select></label>
        <label for="gfx-preset">${escapeHtml(T.quality)}
          <select id="gfx-preset" data-gfx="preset">
            ${opt('auto', T.auto.replace('{tier}', T[info.detected]))}
            ${PRESETS.map(p => opt(p, T[p])).join('')}
          </select></label>
        <label for="gfx-scale">${escapeHtml(T.renderScale)}
          <span class="range-wrap"><input type="range" id="gfx-scale" data-gfx="render_scale" min="50" max="200" step="5" value="100"><output id="gfx-scale-val" for="gfx-scale">100%</output></span></label>
        ${cats}
        <label for="gfx-adaptive">${escapeHtml(T.adaptive)} <input type="checkbox" id="gfx-adaptive" data-gfx="adaptive"></label>
        <label for="gfx-fps">${escapeHtml(T.showFps)} <input type="checkbox" id="gfx-fps" data-gfx="show_fps"></label>
      </div>
      <p id="gfx-summary" class="gfx-summary" aria-live="off"></p>
      <p id="gfx-note" class="gfx-note" hidden></p>`;
    return html;
  }

  /** Reflect saved graphics settings + renderer info into the open Graphics section. */
  syncGfx(saved, info) {
    const sec = document.getElementById('gfx-section');
    if (!sec) return;
    const T = gfxStrings(gfxLocale());
    const s = saved || {};
    const preset = sec.querySelector('#gfx-preset');
    preset.value = PRESETS.includes(s.preset) ? s.preset : 'auto';
    const pct = Math.round((Number(s.render_scale) || 1) * 100);
    sec.querySelector('#gfx-scale').value = String(pct);
    sec.querySelector('#gfx-scale-val').textContent = pct + '%';
    for (const cat of Object.keys(CATEGORIES)) {
      const el = sec.querySelector('#gfx-cat-' + cat);
      el.options[0].textContent = T.fromPreset.replace('{tier}', T.tier[presetTier(info.resolved.preset, cat)]);
      el.value = CATEGORIES[cat].includes(s[cat]) ? s[cat] : 'preset';
    }
    sec.querySelector('#gfx-adaptive').checked = s.adaptive !== false;
    sec.querySelector('#gfx-fps').checked = !!s.show_fps;
    this.updateGfxSummary(info);
  }

  updateGfxSummary(info) {
    const el = document.getElementById('gfx-summary');
    if (!el) return;
    const T = gfxStrings(gfxLocale());
    const text = [info.gpu || T.sum.unknownGpu, describe(info.resolved, info.pixels, T.sum)].join(' · ');
    if (el.textContent !== text) el.textContent = text;
    const note = document.getElementById('gfx-note');
    const msg = !info.webgl ? T.noWebgl : info.postFailed ? T.postFailed : '';
    note.hidden = !msg;
    note.textContent = msg;
  }

  profileScreen(prog, displayNameFn, meta = {}) {
    return this._remember(() => {
      const displayName = typeof displayNameFn === 'function' ? displayNameFn() : displayNameFn;
      const who = meta.hosted
        ? T('Signed in as <strong>{name}</strong> — progress syncs to your account (status sits next to the clock).', { name: escapeHtml(displayName) })
        : T('Playing as <strong>{name}</strong> (local guest profile; sign-in is offered by the host shell).', { name: escapeHtml(displayName) });
      return this.openScreen(`
      <h2>${esc(T('Profile'))}</h2>
      <p>${who}</p>
      <h3>${esc(T('Achievements'))}</h3>
      <ul class="menu-list">
        ${ACHIEVEMENTS.map(a => `<li><button type="button" class="btn" disabled>${prog.achievements.includes(a.key) ? '🏆 ' : '🔒 '}${esc(T(a.label))}<small>${esc(T(a.desc))}</small></button></li>`).join('')}
      </ul>
      <p>${esc(T('Total gallery time: {time}', { time: formatTime(prog.totalTimeMs || 0) }))}</p>
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-title">${esc(T('Back'))}</button></div>`, { label: T('Profile') });
    });
  }

  // htmlFn returns the board HTML in the current language.
  leaderboardScreen(htmlFn) {
    return this._remember(() => this.openScreen(`
      <h2>${esc(T('Score chase'))}</h2>
      ${typeof htmlFn === 'function' ? htmlFn() : htmlFn}
      <div class="row"><button type="button" class="btn btn-ghost" data-action="nav-title">${esc(T('Back'))}</button></div>`, { label: T('Leaderboards') }));
  }

  _volumeSliders(settings) {
    const v = settings.volumes;
    const names = { music: N('Music'), effects: N('Effects'), ambience: N('Ambience'), voice: N('Voice') };
    return `<div class="settings-grid">
      ${['music', 'effects', 'ambience', 'voice'].map(b =>
        `<label>${esc(T(names[b]))} <input type="range" min="0" max="1" step="0.05" value="${v[b]}" data-volume="${b}"></label>`).join('')}
    </div>`;
  }

  // ---------- HUD & accessibility mirror ----------
  showHud(show) { this.hud.hidden = !show; const t = document.getElementById('goal-thumb'); if (t && !show) t.hidden = true; }
  updateHud(state, modeLabel, timeLeftSec) {
    document.getElementById('hud-mode').textContent = modeLabel;
    const placed = state.pieces.filter(p => p.placed).length;
    document.getElementById('hud-placed').textContent = T('{n}/{total} placed', { n: placed, total: state.pieces.length });
    document.getElementById('hud-time').textContent = formatTime(state.elapsedMs);
    document.getElementById('hud-score').textContent = T('Score {n}', { n: scoreComponents(state).total });
    const lim = document.getElementById('hud-limit');
    if (state.ruleset.moveLimit > 0) {
      const left = state.ruleset.moveLimit - state.moves;
      lim.textContent = T('{n} moves left', { n: left });
      lim.classList.toggle('warn', left <= 3);
    } else if (timeLeftSec != null) {
      lim.textContent = T('{n}s left', { n: Math.max(0, Math.ceil(timeLeftSec)) });
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
      const glyph = GLYPHS[p.colorIndex % GLYPHS.length];
      const stateTxt = p.placed ? T('placed') : (p.rot ? T('rotated {deg} degrees', { deg: p.rot * 90 }) : T('upright'));
      b.setAttribute('aria-label', [T('Piece {n}, {glyph} tile', { n: id + 1, glyph }), stateTxt, !p.placed && selectedId === id ? T('selected') : ''].filter(Boolean).join(', '));
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
      b.setAttribute('aria-label', [T('Cell column {x} row {y}, goal {glyph} tile', { x, y, glyph: goalGlyph }),
        filled ? T('holds piece {n}', { n: here.id + 1 }) : '', filled ? (matches ? T('matches the goal') : T('does not match the goal')) : '',
        !filled && candidateCells.includes(c) ? T('legal target') : ''].filter(Boolean).join(', '));
      b.disabled = filled;
      grid.appendChild(b);
    }
  }

  toastAchievement(label) {
    const t = document.createElement('div');
    t.className = 'achievement-toast';
    t.textContent = '🏆 ' + T('Achievement unlocked: {name}', { name: T(label) });
    this._pushToast(t, 4000);
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
