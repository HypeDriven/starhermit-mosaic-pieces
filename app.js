'use strict';

// Mosaic Pieces — app: bootstrap, state machine, input, session lifecycle,
// persistence, accessibility wiring. Only this module issues validated
// commands to the rules engine; rendering consumes immutable snapshots.

import * as Rules from './rules.js';
import { LESSONS, JOURNEY, PRACTICE, CHALLENGES, dailyContent } from './content.js';
import { Renderer } from './render.js';
import { UI, ACHIEVEMENTS, formatTime, escapeHtml } from './ui.js';
import { AudioEngine } from './audio.js';
import { Platform } from './platform.js';

const LS = { settings: 'mp-settings-v1', progress: 'mp-progress-v1', session: 'mp-session-v1' };
const BOARD_KEY = { daily: 'daily', chase: 'chase' };
const BACK_ACTIONS = new Set(['nav-title', 'nav-mode', 'close-screen', 'quit-round']);

const DEFAULT_SETTINGS = {
  volumes: { music: 0.5, effects: 0.85, ambience: 0.4, voice: 0.8 },
  muted: false, quality: 'high', theme: 'default',
  reducedMotion: false, highContrast: false, largeText: false,
  cvdPalette: false, holdToDrag: false, timingAssist: false, leftHanded: false
};
const DEFAULT_PROGRESS = {
  journeyCompleted: 0, achievements: [], daysPlayed: [], totalTimeMs: 0, displayName: 'Guest',
  best: {} // board ('daily'|'chase') -> {score, elapsedMs, invalidActions, date?}
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    const doc = JSON.parse(raw);
    return { ...structuredClone(fallback), ...doc };
  } catch (_) { return structuredClone(fallback); }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

export class App {
  constructor() {
    this.ui = new UI();
    this.platform = new Platform();
    this.settings = load(LS.settings, DEFAULT_SETTINGS);
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches && localStorage.getItem(LS.settings) === null) {
      this.settings.reducedMotion = true;
    }
    this.progress = load(LS.progress, DEFAULT_PROGRESS);
    this.audio = new AudioEngine(this.settings);
    this.state = null;          // current rules snapshot (immutable)
    this.round = null;          // { mode, seed, ruleset, lesson, stageIndex, startEpoch, sessionId }
    this.renderer = null;
    this.drag = null;           // { pieceId, moved, pointerId, tapTimer }
    this.cmdCounter = 0;
    this.sessionId = 's-' + Math.random().toString(36).slice(2, 10);
    this.appliedCmdIds = new Set();
    this.paused = false;
    this.timeLeftSec = null;
    this._lastTickSec = -1;
  }

  async start() {
    this.ui.applyA11yClasses(this.settings);
    save(LS.settings, this.settings);
    const host = document.getElementById('canvas-host');
    this.renderer = new Renderer(host, { quality: this.settings.quality, reducedMotion: this.settings.reducedMotion });
    if (!this.renderer.webgl) document.getElementById('webgl-fallback').hidden = false;
    await this.platform.syncTime();
    this.platform.onSyncStatus = (s) => this._showSyncStatus(s);
    this._showSyncStatus(this.platform.hosted ? 'saving' : 'local');
    if (this.platform.hosted) {
      this.platform.scheduleRefresh();
      const remote = await this.platform.loadCloudSave();
      if (remote) this._applyRemoteSave(remote);
      this.platform.loadProfile(); // nickname shows on the profile screen
      this._persistProgress(); // mirror the (possibly merged) doc to the cloud slot
    }
    this._clock();
    setInterval(() => this._clock(), 1000);
    this._wireInput();
    // Only fall through to the title when there is no round to offer back:
    // showTitle() replaces any open overlay, which would hide the prompt.
    if (!this._resumeCheck()) this.showTitle();
    requestAnimationFrame((t) => this._loop(t));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state && this.state.status === 'active' && !this.ui.screenOpen) this.pause();
    });
    this.platform.event('start', { mode: 'boot' });
  }

  _clock() {
    const d = new Date(this.platform.now());
    document.getElementById('clock').textContent = d.toISOString().slice(11, 19) + ' UTC';
  }

  get nextJourney() { return Math.min(this.progress.journeyCompleted + 1, JOURNEY.length); }

  // ---------- screens ----------
  showTitle() {
    this._teardownRound();
    this.ui.showHud(false);
    this.ui.titleScreen({ journeyCompleted: this.progress.journeyCompleted, nextJourney: this.nextJourney, achievements: this.progress.achievements });
  }
  showMode() { this.ui.modeScreen(); }
  showLearn() { this.ui.learnScreen(); }
  showJourney() { this.ui.journeyScreen({ journeyCompleted: this.progress.journeyCompleted, nextJourney: this.nextJourney }); }
  showPractice() { this.ui.practiceScreen(); }
  showChallenge() { this.ui.challengeScreen(); }
  showHelp() {
    this.ui.helpScreen('Tab reaches the tray and board lists, arrow keys move within them, Enter selects a piece or places it, R rotates, H hints, U undoes, Esc pauses, C resets the camera. Digits 1-9 pick the nth tray piece.');
  }
  showSettings() { this.ui.settingsScreen(this.settings); }
  showProfile() {
    const name = this.platform.hosted
      ? (this.platform.nickname || 'Player ' + String(this.platform.userId || '').slice(0, 8))
      : this.progress.displayName;
    this.ui.profileScreen(this.progress, name, { hosted: this.platform.hosted });
  }
  async showLeaderboard() {
    this.ui.leaderboardScreen('<p>Loading…</p>');
    const today = this.platform.utcToday();
    if (this.platform.hosted) {
      // Platform leaderboards are script-owned: read-only, resolved to nicknames.
      let html = '';
      const info = await this.platform.gameInfo();
      if (info && info.leaderboardId) {
        const entries = await this.platform.leaderboardEntries(info.leaderboardId, { pageSize: 20 });
        const rows = await Promise.all(entries.map(async (e) => {
          const uid = e.userId != null ? String(e.userId) : (e.user_id != null ? String(e.user_id) : null);
          const name = uid != null ? await this.platform.profileFor(uid) : (e.name || 'Player');
          const me = uid != null && uid === String(this.platform.userId);
          const ms = Number(e.elapsedMs != null ? e.elapsedMs : (e.elapsed_ms || 0));
          return `<li class="${me ? 'me' : ''}"><span>${escapeHtml(name)}</span><span>${e.score} · ${formatTime(ms)}</span></li>`;
        }));
        html += `<h3>Platform board</h3>` + (rows.length === 0
          ? '<p>No entries yet — be the first.</p>'
          : `<ol class="leaderboard-list">${rows.join('')}</ol>`);
        if (info.me && info.me.bestScore != null) html += `<p>Your platform best: ${escapeHtml(String(info.me.bestScore))}.</p>`;
      } else {
        html += '<p>No platform leaderboard for this game — showing personal bests only.</p>';
      }
      html += this._bestHtml(today);
      if (this.ui.screenOpen) this.ui.leaderboardScreen(html);
      return;
    }
    const [daily, chase] = await Promise.all([
      this.platform.leaderboard(BOARD_KEY.daily, today),
      this.platform.leaderboard(BOARD_KEY.chase)
    ]);
    const list = (entries, label) => `
      <h3>${label}</h3>
      ${entries.length === 0 ? '<p>No entries yet — be the first.</p>' : `
      <ol class="leaderboard-list">${entries.slice(0, 20).map(e =>
        `<li class="${e.sessionId === this.sessionId ? 'me' : ''}"><span>${escapeHtml(e.name || 'Guest')}</span><span>${e.score} · ${formatTime(e.elapsedMs)}</span></li>`).join('')}</ol>`}`;
    if (this.ui.screenOpen) this.ui.leaderboardScreen(
      list(daily, `Daily board — ${today}`) + list(chase, 'Global all-time board') + this._bestHtml(today) +
      (this.platform.online ? '' : '<p>Offline: boards unavailable, play continues locally.</p>'));
  }
  _bestHtml(today) {
    const b = this.progress.best || {};
    const rows = [];
    if (b.daily) rows.push(`<li><span>Daily best (${escapeHtml(b.daily.date || today)})</span><span>${b.daily.score} · ${formatTime(b.daily.elapsedMs)}</span></li>`);
    if (b.chase) rows.push(`<li><span>Chase best</span><span>${b.chase.score} · ${formatTime(b.chase.elapsedMs)}</span></li>`);
    return `<h3>Personal bests</h3>` + (rows.length ? `<ol class="leaderboard-list">${rows.join('')}</ol>` : '<p>No personal bests yet.</p>');
  }

  // ---------- round lifecycle ----------
  _setupInfo(kind) {
    switch (kind.mode) {
      case 'lesson': return { title: 'Lesson: ' + kind.lesson.title, desc: 'Interactive tutorial — unranked.', ruleset: kind.lesson.ruleset, undo: true, ranked: false, duration: '~2 minutes' };
      case 'journey': { const s = kind.stage; return { title: `Journey stage ${s.index}`, desc: s.mastery ? 'Mastery stage.' : 'Authored progression stage.', ruleset: s.ruleset, undo: true, ranked: false, duration: `~${Math.round(s.par.timeSec / 60)} minutes` }; }
      case 'daily': return { title: 'Daily challenge — ' + kind.daily.date, desc: 'One shared seed for all players today. Ranked; no undo.', ruleset: kind.daily.ruleset, undo: false, ranked: true, rankedLabel: this.platform.hosted ? 'Yes — platform board (read-only)' : 'Yes — submitted for validation', duration: '~5 minutes' };
      case 'practice': return { title: 'Practice — ' + kind.preset.label, desc: 'Restart and undo freely; no effect on ratings.', ruleset: kind.preset.ruleset, undo: true, ranked: false, duration: 'At your own pace' };
      case 'challenge': return { title: 'Challenge: ' + kind.challenge.label, desc: kind.challenge.desc, ruleset: kind.challenge.ruleset, undo: false, ranked: false, duration: '~4 minutes' };
      default: return null;
    }
  }
  confirmSetup(kind) {
    this.pendingKind = kind;
    const info = this._setupInfo(kind);
    this.ui.setupScreen(info);
  }
  startPending() {
    if (!this.pendingKind) return;
    const kind = this.pendingKind;
    this.pendingKind = null;
    let seed, ruleset, mode, extra = {};
    switch (kind.mode) {
      case 'lesson': ({ seed, ruleset } = kind.lesson); mode = 'lesson'; extra.lesson = kind.lesson; break;
      case 'journey': seed = kind.stage.seed; ruleset = kind.stage.ruleset; mode = 'journey'; extra.stageIndex = kind.stage.index; break;
      case 'daily': seed = kind.daily.seed; ruleset = kind.daily.ruleset; mode = 'daily'; extra.daily = kind.daily; break;
      case 'practice': seed = (Math.random() * 0xffffffff) >>> 0; ruleset = kind.preset.ruleset; mode = 'practice'; break;
      case 'challenge': seed = kind.challenge.seed; ruleset = kind.challenge.ruleset; mode = 'challenge'; break;
      default: return;
    }
    this.startRound(mode, seed, ruleset, extra);
  }

  startRound(mode, seed, ruleset, extra = {}) {
    const rs = { ...ruleset };
    if (this.settings.timingAssist && rs.timeLimitSec) rs.timeLimitSec *= 2;
    this.ui.closeScreen();
    this.sessionId = 's-' + Math.random().toString(36).slice(2, 10);
    this.cmdCounter = 0;
    this.appliedCmdIds.clear();
    this.state = Rules.newGame(seed, rs, mode === 'lesson' ? 'practice' : mode);
    this.round = { mode, seed, ruleset: this.state.ruleset, startEpoch: performance.now(), lessonStep: 0, ...extra };
    this.paused = false;
    this.timeLeftSec = rs.timeLimitSec || null;
    this._lastTickSec = -1;
    this.renderer.opts.reducedMotion = this.settings.reducedMotion;
    this.renderer.buildPuzzle(this.state, this.settings.cvdPalette ? 'default' : this.state.ruleset.theme);
    this.renderer.update(this.state);
    this.ui.showHud(true);
    this.ui.setObjective(this._objectiveText());
    this._syncMirror();
    this._updateHud();
    this.audio.startAmbience();
    this.audio.playEvent('roundstart');
    this.platform.event('start', { mode });
    if (mode === 'lesson') this._announceLessonStep();
    else this.ui.announce(`${this._modeLabel()}. ${this.state.pieces.length} pieces. Select a piece from the tray to begin.`);
    this._saveSession();
  }

  _objectiveText() {
    if (!this.round) return 'Assemble the mosaic.';
    const rs = this.state.ruleset;
    let t = `${this._modeLabel()}: place all ${this.state.pieces.length} pieces on the ${rs.cols}×${rs.rows} board.`;
    if (rs.needRotation) t += ' Pieces must be upright (rotate with R).';
    if (rs.moveLimit) t += ` Move limit: ${rs.moveLimit}.`;
    if (rs.timeLimitSec) t += ` Time limit: ${rs.timeLimitSec}s.`;
    return t;
  }
  _modeLabel() {
    const m = this.round.mode;
    if (m === 'journey') return 'Journey stage ' + this.round.stageIndex;
    if (m === 'daily') return 'Daily challenge';
    if (m === 'lesson') return 'Lesson: ' + this.round.lesson.title;
    if (m === 'challenge') return 'Challenge';
    return 'Practice';
  }

  _teardownRound() {
    this.state = null;
    this.round = null;
    this._clearSession();
  }

  quitRound() {
    if (this.round) this.progress.totalTimeMs += this.state ? this.state.elapsedMs : 0;
    this._persistProgress();
    this.showTitle();
  }

  pause() {
    if (!this.state || this.state.status !== 'active' || this.ui.screenOpen) return;
    this.paused = true;
    this.audio.playEvent('ui');
    this.ui.pauseScreen(this.settings);
  }
  resume() {
    this.paused = false;
    if (this.round) this.round.startEpoch = performance.now() - (this.state ? this.state.elapsedMs : 0);
    this.ui.closeScreen();
    this.audio.playEvent('ui');
  }

  // ---------- commands ----------
  _cmd(cmd) {
    if (!this.state) return false;
    const id = this.sessionId + ':' + (++this.cmdCounter);
    if (this.appliedCmdIds.has(id)) return false; // idempotent double-commit guard
    this.appliedCmdIds.add(id);
    const prev = this.state;
    try {
      this.state = Rules.applyCommand(prev, { ...cmd, id });
    } catch (e) {
      this.ui.announce('Action rejected: ' + e.message, true);
      return false;
    }
    const changed = this.state !== prev;
    if (this.state.invalidActions > prev.invalidActions) {
      this.audio.playEvent('invalid');
      this.ui.announce(this._invalidReason(cmd), true);
    } else if (changed) {
      this.audio.playEvent(cmd.type === 'place' ? 'snap' : cmd.type === 'rotate' ? 'rotate' : cmd.type);
      if (cmd.type === 'place' || cmd.type === 'hint' || cmd.type === 'undo') this._afterMove(cmd);
    }
    this.renderer.update(this.state);
    this._syncMirror();
    this._updateHud();
    this._saveSession();
    this._checkLesson(cmd, prev);
    this._checkTerminal();
    return changed;
  }
  _invalidReason(cmd) {
    if (cmd.type === 'place') {
      const code = Rules.canPlace(this.state, cmd.piece, cmd.cell);
      const why = {
        PIECE_PLACED: 'That piece is already placed.',
        CELL_OCCUPIED: 'That cell is occupied.',
        CELL_OUT_OF_BOUNDS: 'That cell is off the board.',
        WRONG_ROTATION: 'The piece must be upright first — rotate it with R.',
        GAME_OVER: 'The round is over.'
      }[code];
      return why || 'That placement is not legal.';
    }
    if (cmd.type === 'undo') return 'Nothing to undo (or undo is disabled in this ranked mode).';
    if (cmd.type === 'hint') return 'No hint available right now.';
    return 'That action is not available.';
  }
  _afterMove(cmd) {
    const placed = this.state.pieces.filter(p => p.placed).length;
    if (cmd.type === 'place') this.ui.announce(`Piece placed. ${placed} of ${this.state.pieces.length}.`);
  }
  _checkTerminal() {
    if (!this.state || this.state.status === 'active') return;
    const win = this.state.status === 'complete';
    this.audio.playEvent(win ? 'complete' : 'fail');
    this.progress.totalTimeMs += this.state.elapsedMs;
    let extra = '';
    if (win) {
      extra = this._applyProgression();
      this._submitScore();
    }
    this._persistProgress();
    this._clearSession();
    setTimeout(() => this.ui.resultsScreen(this.state, extra), win && !this.settings.reducedMotion ? 700 : 100);
  }
  _applyProgression() {
    let notes = '';
    const unlock = (key) => {
      if (this.progress.achievements.includes(key)) return;
      this.progress.achievements.push(key);
      const meta = ACHIEVEMENTS.find(a => a.key === key);
      if (meta) { this.ui.toastAchievement(meta.label); this.audio.playEvent('achieve'); }
      this.platform.unlockAchievement(key, this.sessionId);
    };
    unlock('first_completion');
    const today = this.platform.utcToday();
    if (!this.progress.daysPlayed.includes(today)) this.progress.daysPlayed.push(today);
    if (this.progress.daysPlayed.length >= 3) unlock('streak_3');
    if (this.round.mode === 'journey') {
      if (this.round.stageIndex === this.progress.journeyCompleted + 1) {
        this.progress.journeyCompleted = this.round.stageIndex;
        notes = `<p>Journey progress: ${this.progress.journeyCompleted}/${JOURNEY.length} stages.</p>`;
      }
      if (this.progress.journeyCompleted >= 20) unlock('journey_20');
      if (this.state.ruleset.needRotation && this.state.hintsUsed === 0) unlock('rotation_master');
    }
    if (this.progress.totalTimeMs >= 60 * 60 * 1000) unlock('long_haul');
    return notes;
  }
  async _submitScore() {
    if (this.round.mode !== 'daily' && this.round.mode !== 'challenge' && this.round.mode !== 'journey') return;
    const board = this.round.mode === 'daily' ? BOARD_KEY.daily : BOARD_KEY.chase;
    // Personal bests are kept locally and cloud-saved on every mode; the
    // platform boards themselves are script-owned and read-only for clients.
    const result = { score: Rules.score(this.state), elapsedMs: Math.floor(this.state.elapsedMs), invalidActions: this.state.invalidActions };
    const prev = this.progress.best ? this.progress.best[board] : null;
    const better = !prev || Rules.compareResults(
      { score: result.score, completed: true, invalidActions: result.invalidActions, elapsedMs: result.elapsedMs, sessionId: this.sessionId },
      { score: prev.score, completed: true, invalidActions: prev.invalidActions || 0, elapsedMs: prev.elapsedMs || 0, sessionId: '' }) < 0;
    if (better) {
      this.progress.best = { ...(this.progress.best || {}) };
      this.progress.best[board] = board === 'daily'
        ? { date: this.round.daily.date, score: result.score, elapsedMs: result.elapsedMs, invalidActions: result.invalidActions }
        : { score: result.score, elapsedMs: result.elapsedMs, invalidActions: result.invalidActions };
    }
    if (this.platform.hosted) {
      this._persistProgress();
      if (better) this.ui.announce(`New personal best: ${result.score}.`);
      return;
    }
    if (!this.platform.localDev) return; // offline against no dev server: best already kept above
    const payload = {
      board,
      date: this.round.daily ? this.round.daily.date : undefined,
      name: this.progress.displayName,
      sessionId: this.sessionId,
      seed: this.round.seed,
      ruleset: this.round.ruleset,
      contentVersion: Rules.CONTENT_VERSION,
      mode: this.round.mode,
      commands: this.state.commandLog,
      score: result.score,
      elapsedMs: result.elapsedMs,
      assists: { hints: this.state.hintsUsed, undos: this.state.undosUsed },
      invalidActions: result.invalidActions,
      finalHash: Rules.stateHash(this.state)
    };
    const r = await this.platform.submitScore(payload);
    if (r && r.ok) this.ui.announce(`Score submitted. Rank ${r.rank}.`);
    else if (r && r.error) this.ui.announce('Score not submitted: ' + r.error);
  }

  // ---------- tutorial ----------
  _announceLessonStep() {
    const lesson = this.round.lesson;
    const step = lesson.steps[this.round.lessonStep];
    if (!step) return;
    this.ui.setObjective('Lesson: ' + step.text);
    this.ui.announce(step.text);
    this.platform.event('tutorial-step', { step: this.round.lessonStep });
  }
  _checkLesson(cmd, prev) {
    if (!this.round || this.round.mode !== 'lesson') return;
    const lesson = this.round.lesson;
    const step = lesson.steps[this.round.lessonStep];
    if (!step || !step.await) return;
    const done =
      (step.await === 'select' && cmd.type === 'select' && this.state.selected !== null) ||
      (step.await === 'place' && cmd.type === 'place' && this.state.invalidActions === prev.invalidActions) ||
      (step.await === 'rotate' && cmd.type === 'rotate') ||
      (step.await === 'hint' && cmd.type === 'hint') ||
      (step.await === 'complete' && this.state.status === 'complete');
    if (done && step.await !== 'complete') {
      this.round.lessonStep++;
      this._announceLessonStep();
    }
  }
  nextRecommended() {
    if (this.round.mode === 'journey' && this.nextJourney <= JOURNEY.length) {
      this.confirmSetup({ mode: 'journey', stage: JOURNEY[this.nextJourney - 1] });
    } else {
      this.showMode();
    }
  }
  retry() {
    if (!this.round) return this.showTitle();
    const { mode, seed, ruleset, lesson, stageIndex, daily } = this.round;
    this.platform.event('retry', { mode });
    const extra = {};
    if (lesson) extra.lesson = lesson;
    if (stageIndex) extra.stageIndex = stageIndex;
    if (daily) extra.daily = daily;
    this.startRound(mode, mode === 'practice' ? (Math.random() * 0xffffffff) >>> 0 : seed, ruleset, extra);
  }

  // ---------- session persistence / reconnect ----------
  _saveSession() {
    if (!this.state || this.state.status !== 'active') return;
    save(LS.session, {
      round: { mode: this.round.mode, seed: this.round.seed, ruleset: this.round.ruleset, stageIndex: this.round.stageIndex, daily: this.round.daily, lessonId: this.round.lesson ? this.round.lesson.id : null },
      state: Rules.serialize(this.state)
    });
  }
  _clearSession() { try { localStorage.removeItem(LS.session); } catch (_) {} }

  // ---------- progress/settings persistence: localStorage + cloud mirror ----------
  _cloudDoc() { return { v: 1, savedAt: Date.now(), progress: this.progress, settings: this.settings }; }
  _persistProgress() {
    save(LS.progress, this.progress);
    this.platform.saveCloudSoon(this._cloudDoc());
  }
  _persistSettings() {
    save(LS.settings, this.settings);
    this.platform.saveCloudSoon(this._cloudDoc());
  }
  _applyRemoteSave(remote) {
    // Conflict resolution: the remote (account) copy wins.
    try {
      this.platform.clearPendingSave(); // a pre-load snapshot must not clobber remote
      if (remote.progress && typeof remote.progress === 'object') {
        this.progress = { ...structuredClone(DEFAULT_PROGRESS), ...remote.progress };
        save(LS.progress, this.progress);
      }
      if (remote.settings && typeof remote.settings === 'object') {
        this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...remote.settings };
        save(LS.settings, this.settings);
        this._applySettings();
        this.ui.applyA11yClasses(this.settings);
      }
    } catch (_) {}
  }
  _showSyncStatus(s) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    const labels = { synced: 'cloud synced', saving: 'saving…', offline: 'offline — local copy', local: 'local save' };
    el.textContent = labels[s] || s;
    el.dataset.state = s;
  }
  _resumeCheck() {
    let doc = null;
    try { doc = JSON.parse(localStorage.getItem(LS.session) || 'null'); } catch (_) {}
    if (!doc || !doc.state) return false;
    try {
      const state = Rules.deserialize(doc.state);
      if (state.status !== 'active') return false;
      const scr = this.ui.openScreen(`
        <h2>Welcome back</h2>
        <p>While you were away your round was paused. You had placed ${state.pieces.filter(p => p.placed).length}/${state.pieces.length} pieces in ${formatTime(state.elapsedMs)}.</p>
        <div class="row">
          <button type="button" class="btn btn-primary" data-action="resume-saved">Resume round</button>
          <button type="button" class="btn btn-ghost" data-action="discard-saved">Start fresh</button>
        </div>`, { label: 'Resume session' });
      scr.addEventListener('click', (e) => {
        const a = e.target.closest('[data-action]');
        if (!a) return;
        if (a.dataset.action === 'resume-saved') {
          this.ui.closeScreen();
          this.state = state;
          this.round = { mode: doc.round.mode, seed: doc.round.seed, ruleset: state.ruleset, startEpoch: performance.now() - state.elapsedMs, stageIndex: doc.round.stageIndex, daily: doc.round.daily, lesson: LESSONS.find(l => l.id === doc.round.lessonId) || null, lessonStep: 0 };
          this.paused = false;
          // a timed round keeps its remaining time across the interruption
          this.timeLeftSec = state.ruleset.timeLimitSec
            ? Math.max(0, state.ruleset.timeLimitSec - state.elapsedMs / 1000)
            : null;
          this._lastTickSec = -1;
          this.renderer.buildPuzzle(this.state, this.settings.cvdPalette ? 'default' : state.ruleset.theme);
          this.renderer.update(this.state);
          this.ui.showHud(true);
          this.ui.setObjective(this._objectiveText());
          this._syncMirror();
          this._updateHud();
          this.audio.startAmbience();
        } else if (a.dataset.action === 'discard-saved') {
          this._clearSession();
          this.showTitle();
        }
      });
      return true;
    } catch (_) { this._clearSession(); }
    return false;
  }

  // ---------- HUD / mirror ----------
  _updateHud() {
    if (!this.state) return;
    this.ui.updateHud(this.state, this._modeLabel(), this.timeLeftSec);
    const c = Rules.scoreComponents(this.state);
    this.ui.setProgress(`<p>Score ${c.total} · Moves ${this.state.moves} · Hints ${this.state.hintsUsed}</p>`);
  }
  _syncMirror() {
    if (!this.state) return;
    const candidates = this.state.selected != null ? Rules.legalTargetsFor(this.state, this.state.selected) : [];
    this.ui.mirrorBoard(this.state, this.state.selected, candidates);
    this.renderer.showLegalTargets(this.state, candidates);
    const canAct = this.state.status === 'active' && !this.paused;
    // the rail and the mobile bottom tray both expose these actions
    const setDisabled = (action, off) => {
      for (const b of document.querySelectorAll(`[data-action="${action}"]`)) b.disabled = off;
    };
    setDisabled('rotate', !canAct || this.state.selected == null);
    setDisabled('hint', !canAct);
    setDisabled('undo', !canAct || this.state.history.length === 0 || this.state.mode === 'daily' || this.state.mode === 'challenge');
  }

  // ---------- input ----------
  _wireInput() {
    document.body.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (el) { this._action(el.dataset.action, el.dataset); return; }
      const pb = e.target.closest('#piece-list button[data-piece]');
      if (pb && !pb.disabled) { this._selectPiece(Number(pb.dataset.piece)); return; }
      const cb = e.target.closest('#cell-grid button[data-cell]');
      if (cb && !cb.disabled) { this._placeSelected(Number(cb.dataset.cell)); return; }
    });
    document.body.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.volume) {
        this.settings.volumes[t.dataset.volume] = Number(t.value);
        this.audio.applyVolumes();
        this._persistSettings();
      } else if (t.dataset && t.dataset.setting) {
        const k = t.dataset.setting;
        this.settings[k] = t.type === 'checkbox' ? t.checked : t.value;
        this._applySettings();
        this.platform.event('settings-change', { key: k });
      }
    });
    document.body.addEventListener('keydown', (e) => this._arrowNav(e));
    window.addEventListener('keydown', (e) => this._key(e));
    const host = document.getElementById('canvas-host');
    host.addEventListener('pointerdown', (e) => this._pointerDown(e));
    host.addEventListener('pointermove', (e) => this._pointerMove(e));
    host.addEventListener('pointerup', (e) => this._pointerUp(e));
    host.addEventListener('pointercancel', (e) => this._pointerCancel(e));
    host.addEventListener('dblclick', (e) => {
      if (!this._canPlay()) return;
      const hit = this._pick(e);
      if (hit && hit.kind === 'piece') this._cmd({ type: 'rotate', piece: hit.pieceId, rotations: 1 });
    });
  }
  _applySettings() {
    this._persistSettings();
    this.ui.applyA11yClasses(this.settings);
    this.audio.settings = this.settings;
    this.audio.applyVolumes();
    this.renderer.setQuality(this.settings.quality);
    this.renderer.opts.reducedMotion = this.settings.reducedMotion;
  }

  _canPlay() { return this.state && this.state.status === 'active' && !this.paused && !this.ui.screenOpen; }

  _selectPiece(id) {
    if (!this._canPlay()) return;
    const piece = Rules.pieceById(this.state, id);
    if (!piece || piece.placed) { // explain instead of banking an invalid action
      this.ui.announce('That piece is already placed.', true);
      this.audio.playEvent('invalid');
      return;
    }
    if (this.state.selected === id) { // second click rotates (toggle behavior)
      this._cmd({ type: 'rotate', piece: id, rotations: 1 });
      return;
    }
    if (this._cmd({ type: 'select', piece: id })) { // _cmd already plays the select cue
      this.ui.announce(`Piece ${id + 1} selected. ${Rules.legalTargetsFor(this.state, id).length} legal cells highlighted.`);
    }
  }
  _placeSelected(cell) {
    if (!this._canPlay() || this.state.selected == null) {
      if (this.state && this.state.selected == null) this.ui.announce('Select a tray piece first.', true);
      return;
    }
    const code = Rules.canPlace(this.state, this.state.selected, cell);
    if (code) { // known-illegal target: explain, do not penalise the misclick
      this.ui.announce(this._invalidReason({ type: 'place', piece: this.state.selected, cell }), true);
      this.audio.playEvent('invalid');
      return;
    }
    this._cmd({ type: 'place', piece: this.state.selected, cell });
  }

  _pick(e) {
    const host = document.getElementById('canvas-host');
    const rect = host.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    return this.renderer.pick(this.state, nx, ny);
  }
  _pointerDown(e) {
    if (!this._canPlay()) return;
    const hit = this._pick(e);
    if (hit && hit.kind === 'piece') {
      this.drag = { pieceId: hit.pieceId, moved: false, x0: e.clientX, y0: e.clientY, t0: performance.now(), pointerId: e.pointerId };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }
  _pointerMove(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const dx = e.clientX - this.drag.x0, dy = e.clientY - this.drag.y0;
    if (!this.drag.moved && Math.hypot(dx, dy) > 8) {
      this.drag.moved = true;
      if (this.state.selected !== this.drag.pieceId) this._cmd({ type: 'select', piece: this.drag.pieceId });
      this.audio.playEvent('pickup');
    }
    if (this.drag.moved) {
      const host = document.getElementById('canvas-host');
      const rect = host.getBoundingClientRect();
      this.renderer.moveDragged(this.drag.pieceId, ((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    }
  }
  _pointerUp(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const drag = this.drag;
    this.drag = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    if (!this._canPlay()) { this.renderer.update(this.state); return; }
    const hit = this._pick(e);
    if (drag.moved) {
      if (hit && hit.kind === 'cell') {
        if (this.state.selected !== drag.pieceId) this._cmd({ type: 'select', piece: drag.pieceId });
        this._placeSelected(hit.cell);
      }
      this.renderer.update(this.state); // settle into the cell, or back to the tray
    } else {
      // tap: select piece / place on cell; short tap vs long press by time
      if (hit && hit.kind === 'piece') this._selectPiece(hit.pieceId);
      else if (hit && hit.kind === 'cell') this._placeSelected(hit.cell);
    }
  }
  _pointerCancel(e) {
    if (this.drag && e.pointerId === this.drag.pointerId) {
      this.drag = null;
      if (this.state) this.renderer.update(this.state); // cancel safely on lost capture
    }
  }

  // Directional navigation inside the accessible tray/board mirrors, as the
  // help card promises. Rows are ruleset.cols wide on the board grid.
  _arrowNav(e) {
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 };
    if (!(e.key in deltas) || !e.target.closest) return;
    const container = e.target.closest('#cell-grid') || e.target.closest('#piece-list');
    if (!container) return;
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    const cols = (container.id === 'cell-grid' && this.state) ? this.state.ruleset.cols : 1;
    const step = deltas[e.key] * (vertical ? cols : 1);
    const buttons = [...container.querySelectorAll('button')];
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    for (let j = i + step; j >= 0 && j < buttons.length; j += step) {
      if (!buttons[j].disabled) { buttons[j].focus(); break; }
    }
    e.preventDefault();
  }

  _key(e) {
    if (e.key === 'Escape') {
      if (this.paused) this.resume();
      // Title, mode-select and results have no board behind them: closing
      // them would leave an empty screen with no way back into the game.
      else if (this.ui.screenOpen) { if (this.state && this.state.status === 'active') this.ui.closeScreen(); }
      else this.pause();
      e.preventDefault();
      return;
    }
    if (!this._canPlay()) return;
    const k = e.key.toLowerCase();
    if (k === 'r' && this.state.selected != null) { this._cmd({ type: 'rotate', piece: this.state.selected, rotations: 1 }); e.preventDefault(); }
    else if (k === 'h') { this._cmd({ type: 'hint' }); e.preventDefault(); }
    else if (k === 'u') { this._cmd({ type: 'undo' }); e.preventDefault(); }
    else if (k === 'c') { if (this.state) this.renderer._frameCamera(this.state); e.preventDefault(); }
    else if (/^[1-9]$/.test(k)) {
      // quick-select: nth unplaced tray piece
      const open = this.state.tray.filter(id => !Rules.pieceById(this.state, id).placed);
      const id = open[Number(k) - 1];
      if (id !== undefined) this._selectPiece(id);
    }
  }

  _action(action, ds) {
    // back/close actions get the softer, lower "menu-back" cue
    this.audio.playEvent(BACK_ACTIONS.has(action) ? 'back' : 'ui');
    switch (action) {
      case 'nav-title': this.showTitle(); break;
      case 'nav-mode': this.showMode(); break;
      case 'nav-learn': this.showLearn(); break;
      case 'nav-journey': this.showJourney(); break;
      case 'nav-practice': this.showPractice(); break;
      case 'nav-challenge': this.showChallenge(); break;
      case 'nav-help': this.showHelp(); break;
      case 'nav-settings': this.showSettings(); break;
      case 'nav-profile': this.showProfile(); break;
      case 'nav-leaderboard': this.showLeaderboard(); break;
      case 'close-screen': this.ui.closeScreen(); if (this.paused) this.ui.pauseScreen(this.settings); break;
      case 'start-lesson': this.confirmSetup({ mode: 'lesson', lesson: LESSONS[Number(ds.index)] }); break;
      case 'start-stage': this.confirmSetup({ mode: 'journey', stage: JOURNEY[Number(ds.index) - 1] }); break;
      case 'start-practice': this.confirmSetup({ mode: 'practice', preset: PRACTICE.find(p => p.id === ds.id) }); break;
      case 'start-challenge': this.confirmSetup({ mode: 'challenge', challenge: CHALLENGES.find(c => c.id === ds.id) }); break;
      case 'start-daily': {
        const d = dailyContent(this.platform.utcToday());
        this.confirmSetup({ mode: 'daily', daily: d });
        break;
      }
      case 'confirm-start': this.startPending(); break;
      case 'pause': this.pause(); break;
      case 'resume': this.resume(); break;
      case 'quit-round': this.quitRound(); break;
      case 'retry': this.retry(); break;
      case 'next-recommended': this.nextRecommended(); break;
      case 'rotate': if (this._canPlay() && this.state.selected != null) this._cmd({ type: 'rotate', piece: this.state.selected, rotations: 1 }); else this.ui.announce('Select a piece first.', true); break;
      case 'hint': if (this._canPlay()) this._cmd({ type: 'hint' }); break;
      case 'undo': if (this._canPlay()) this._cmd({ type: 'undo' }); break;
      case 'toggle-left-rail': document.getElementById('objective-rail').classList.toggle('open'); break;
      case 'toggle-right-rail': document.getElementById('actions-rail').classList.toggle('open'); break;
      case 'replay-tutorial': this.ui.closeScreen(); this.confirmSetup({ mode: 'lesson', lesson: LESSONS[0] }); break;
      default: break;
    }
  }

  // ---------- gamepad: focus navigation + primary/secondary/pause ----------
  _pollGamepad() {
    if (!navigator.getGamepads) return;
    const gp = navigator.getGamepads()[0];
    if (!gp) { this._gpPrev = null; return; }
    const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const prev = this._gpPrev || {};
    const edge = (i) => pressed(i) && !prev[i];
    const axisX = gp.axes[0] || 0, axisY = gp.axes[1] || 0;
    const axEdge = (dir, v) => Math.abs(v) > 0.6 && Math.abs(prev['ax' + dir] || 0) <= 0.6;
    if (this._canPlay()) {
      const rs = this.state.ruleset;
      const n = rs.cols * rs.rows;
      if (this.gpCell == null) this.gpCell = 0;
      if (edge(14) || axEdge('x', axisX) && axisX < 0) this.gpCell = (this.gpCell - 1 + n) % n;
      if (edge(15) || axEdge('x', axisX) && axisX > 0) this.gpCell = (this.gpCell + 1) % n;
      if (edge(12) || axEdge('y', axisY) && axisY < 0) this.gpCell = (this.gpCell - rs.cols + n) % n;
      if (edge(13) || axEdge('y', axisY) && axisY > 0) this.gpCell = (this.gpCell + rs.cols) % n;
      if (edge(0)) { // primary: select next piece, or place at cursor
        if (this.state.selected == null) {
          const open = this.state.tray.filter(id => !Rules.pieceById(this.state, id).placed);
          if (open.length) this._selectPiece(open[0]);
        } else this._placeSelected(this.gpCell);
      }
      if (edge(1)) { // secondary: deselect / rotate
        if (this.state.selected != null) this._cmd({ type: 'rotate', piece: this.state.selected, rotations: 1 });
      }
      if (edge(2)) this._cmd({ type: 'hint' });
      if (edge(3)) this._cmd({ type: 'undo' });
      if (edge(9)) this.pause();
      this._updateHud();
    } else if (edge(9) && this.paused) {
      this.resume();
    }
    this._gpPrev = gp.buttons.map(b => b.pressed);
    this._gpPrev.axx = axisX; this._gpPrev.axy = axisY;
  }

  // ---------- main loop ----------
  _loop(t) {
    requestAnimationFrame((tt) => this._loop(tt));
    if (document.hidden) return; // background tabs render nothing
    this._pollGamepad();
    if (this.state && this.state.status === 'active' && !this.paused) {
      const elapsed = performance.now() - this.round.startEpoch;
      if (Math.floor(elapsed / 250) !== Math.floor(this.state.elapsedMs / 250)) {
        this.state = Rules.applyCommand(this.state, { type: 'elapsed', ms: Math.floor(elapsed) });
        this._updateHud();
      }
      if (this.timeLeftSec != null) {
        const left = this.round.ruleset.timeLimitSec - elapsed / 1000;
        this.timeLeftSec = left;
        const sec = Math.ceil(left);
        if (sec <= 10 && sec !== this._lastTickSec && sec > 0) { this.audio.playEvent('tick'); this._lastTickSec = sec; }
        if (left <= 0) this._cmd({ type: 'timeup' });
      }
    }
    if (this.state) this.renderer.render();
  }
}
