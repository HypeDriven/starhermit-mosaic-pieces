'use strict';

// Mosaic Pieces — audio: procedural WebAudio buses, event mapping,
// independent volume sliders, seeded pitch variants, background behavior.

import { makeRng } from './rules.js';

const BUS = ['music', 'effects', 'ambience', 'voice'];

// Authored one-shot samples (sfx/<name>.opus) backing existing events;
// synthesis below remains the fallback while a sample loads or is missing.
const SFX = {
  select: 'piece-select',
  pickup: 'piece-pickup',
  place: 'piece-place',
  snap: 'piece-snap',
  rotate: 'piece-rotate',
  invalid: 'invalid-move',
  hint: 'hint-reveal',
  undo: 'undo-move',
  complete: 'round-complete',
  fail: 'round-fail',
  tick: 'timer-tick',
  ui: 'ui-click'
};

export class AudioEngine {
  constructor(settings) {
    this.settings = settings; // { volumes: {music,effects,ambience,voice}, muted }
    this.ctx = null;
    this.gains = {};
    this.rng = makeRng(0xa0d10);
    this._musicNodes = null;
    this._started = false;
    this._sfxBuffers = {}; // name -> decoded AudioBuffer
    this._sfxState = {};   // name -> 'loading' | 'ready' | 'failed'
    this.enabled = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) this.ctx.suspend().catch(() => {});
        else if (!this.settings.muted) this.ctx.resume().catch(() => {});
      });
    }
  }
  _ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      for (const b of BUS) {
        const g = this.ctx.createGain();
        g.gain.value = this.settings.volumes[b] ?? 0.8;
        g.connect(this.master);
        this.gains[b] = g;
      }
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.muted ? 0 : 1;
    for (const b of BUS) if (this.gains[b]) this.gains[b].gain.value = this.settings.volumes[b] ?? 0.8;
  }
  // Lazily fetch/decode/cache sfx/<name>.opus after the user-gesture unlock.
  _loadSample(name) {
    if (this._sfxState[name]) return;
    this._sfxState[name] = 'loading';
    fetch(`sfx/${name}.opus`)
      .then(r => { if (!r.ok) throw new Error('sfx ' + r.status); return r.arrayBuffer(); })
      .then(raw => this.ctx.decodeAudioData(raw))
      .then(buf => { this._sfxBuffers[name] = buf; this._sfxState[name] = 'ready'; })
      .catch(() => { this._sfxState[name] = 'failed'; }); // keep synthesis fallback
  }
  // Play the mapped sample through the effects bus; false while loading/failed.
  _playSample(name) {
    if (this._sfxState[name] === 'ready') {
      const src = this.ctx.createBufferSource();
      src.buffer = this._sfxBuffers[name];
      src.connect(this.gains.effects);
      src.start();
      return true;
    }
    this._loadSample(name);
    return false;
  }
  // Short original transients tied to logical events.
  playEvent(name) {
    const ctx = this._ensure();
    if (!ctx || this.settings.muted) return;
    if (SFX[name] && this._playSample(SFX[name])) return;
    const t = ctx.currentTime;
    const variant = 0.94 + this.rng() * 0.12; // seeded pitch variant
    const blip = (bus, freq, dur, type = 'sine', gain = 0.25, when = 0) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq * variant;
      g.gain.setValueAtTime(0.0001, t + when);
      g.gain.exponentialRampToValueAtTime(gain, t + when + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + when + dur);
      o.connect(g); g.connect(this.gains[bus]);
      o.start(t + when); o.stop(t + when + dur + 0.05);
    };
    switch (name) {
      case 'select':   blip('effects', 660, 0.09, 'triangle', 0.18); break;
      case 'pickup':   blip('effects', 520, 0.1, 'triangle', 0.2); break;
      case 'place':    blip('effects', 392, 0.14, 'sine', 0.3); blip('effects', 587, 0.18, 'sine', 0.22, 0.06); break;
      case 'snap':     blip('effects', 880, 0.06, 'square', 0.1); blip('effects', 392, 0.16, 'sine', 0.3, 0.02); break;
      case 'rotate':   blip('effects', 700, 0.07, 'sawtooth', 0.1); break;
      case 'invalid':  blip('effects', 160, 0.18, 'square', 0.16); break;
      case 'hint':     blip('effects', 523, 0.12, 'sine', 0.2); blip('effects', 784, 0.2, 'sine', 0.18, 0.09); break;
      case 'undo':     blip('effects', 440, 0.1, 'triangle', 0.18); blip('effects', 330, 0.14, 'triangle', 0.16, 0.07); break;
      case 'complete': [523, 659, 784, 1046].forEach((f, i) => blip('effects', f, 0.3, 'sine', 0.25, i * 0.12)); break;
      case 'fail':     [330, 262, 196].forEach((f, i) => blip('effects', f, 0.3, 'sine', 0.22, i * 0.14)); break;
      case 'tick':     blip('effects', 990, 0.05, 'square', 0.08); break;
      case 'ui':       blip('effects', 600, 0.05, 'triangle', 0.12); break;
      default: break;
    }
  }
  // Quiet adaptive ambience: two slow detuned sines; starts on first user gesture.
  startAmbience() {
    const ctx = this._ensure();
    if (!ctx || this._started) return;
    this._started = true;
    const mk = (freq, gain) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g); g.connect(this.gains.ambience);
      o.start();
      return o;
    };
    this._musicNodes = [mk(110, 0.05), mk(165.2, 0.035), mk(220.7, 0.02)];
  }
  stopAmbience() {
    if (this._musicNodes) for (const n of this._musicNodes) { try { n.stop(); } catch (_) {} }
    this._musicNodes = null; this._started = false;
  }
}
