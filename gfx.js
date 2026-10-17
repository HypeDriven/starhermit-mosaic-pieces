'use strict';

// Mosaic Pieces — graphics quality model: presets, per-category overrides,
// StarHermit hardware-level detection, per-preset budgets and a cost summary. Pure (no three.js, no DOM) so the
// settings panel, the renderer and the unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category -> allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],   // room-environment image-based lighting + glazed clearcoat
  detail: ['plain', 'detailed'], // procedural wood grain, stone slab, glaze and gilt textures
  particles: ['off', 'on']       // drifting dust in the lamp light, placement sparkles
};

// Each preset is a row of tiers plus a pixel-ratio cap and a render scale.
const TABLE = {
  low:      { cap: 1,   scale: 1, shadows: 'off',    ao: 'off',  bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', detail: 'plain',    particles: 'off' },
  balanced: { cap: 1.5, scale: 1, shadows: 'low',    ao: 'off',  bloom: 'on',  grade: 'on',  antialias: 'fxaa', reflections: 'on',  detail: 'detailed', particles: 'on' },
  high:     { cap: 2,   scale: 1, shadows: 'medium', ao: 'on',   bloom: 'on',  grade: 'on',  antialias: 'smaa', reflections: 'on',  detail: 'detailed', particles: 'on' },
  ultra:    { cap: 2,   scale: 1, shadows: 'high',   ao: 'high', bloom: 'on',  grade: 'on',  antialias: 'msaa', reflections: 'on',  detail: 'detailed', particles: 'on' }
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from 0,
// Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Pieces, cells, hit
 * areas and rules are identical on every preset — only visuals change.
 *   material  tile shading: lambert (Low) / standard (Balanced) / physical glazed clear coat (High, Ultra;
 *             with Reflections on)
 *   tile      tile-face canvas texture size in px (glyph and orientation tick at every size)
 *   texture   procedural stone-slab size in px (Detail on; desk wood 2× wide, tray felt half)
 *   dust      drifting dust motes in the lamp light (Particles on), scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low:      { material: 'lambert',  tile: 128, texture: 256,  dust: 40,  bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', tile: 256, texture: 256,  dust: 70,  bloomRes: 0.5, aoRes: 0.5 },
  high:     { material: 'physical', tile: 256, texture: 512,  dust: 110, bloomRes: 0.5, aoRes: 0.5 },
  ultra:    { material: 'physical', tile: 512, texture: 1024, dust: 180, bloomRes: 1,   aoRes: 1 }
};
export const DUST_MAX = 360;

/** A preset's concrete budget for a hardware level (the dust count scales ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.dust = Math.min(DUST_MAX, Math.round(b.dust * k));
  return b;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const preset = PRESETS.includes(s.preset) ? s.preset : (PRESETS.includes(detected) ? detected : 'balanced');
  const row = TABLE[preset];
  const out = {
    preset,
    auto: !PRESETS.includes(s.preset),
    cap: row.cap,
    scale: row.scale * clamp(Number(s.render_scale) || 1, 0.5, 2)
  };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // The composer runs only when something needs it; otherwise the canvas renders directly (with its own MSAA).
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Saved settings after picking a preset: overrides are cleared, scale/adaptive/fps kept. */
export function choosePreset(saved, preset) {
  const s = saved || {};
  const out = { preset: PRESETS.includes(preset) ? preset : 'auto' };
  for (const k of ['render_scale', 'adaptive', 'show_fps']) if (k in s) out[k] = s[k];
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

const EN_WORDS = { noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion', bloom: 'bloom', reflections: 'reflections', noAa: 'no anti-aliasing' };

/** Short cost summary, e.g. "2048² shadows · ambient occlusion · bloom · SMAA · 1280×800 px". */
export function describe(r, pixels, words = EN_WORDS) {
  const w = { ...EN_WORDS, ...words };
  const parts = [
    r.shadows === 'off' ? w.noShadows : w.shadows.replace('{n}', SHADOW_MAP[r.shadows]),
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoHigh : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.reflections === 'on' ? w.reflections : null,
    r.antialias === 'off' ? w.noAa : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
