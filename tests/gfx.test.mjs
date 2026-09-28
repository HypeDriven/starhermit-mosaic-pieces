// Unit tests for the graphics quality model (gfx.js) and its panel strings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, CATEGORIES, detectPreset, resolve, presetTier, choosePreset, describe } from '../gfx.js';
import { GFX_STRINGS, pickLocale } from '../gfx-i18n.js';

test('detectPreset maps GPU strings to presets', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Mali-G78'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
  assert.equal(detectPreset('Apple M2', { mobile: true }), 'balanced', 'touch devices cap Auto at Balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
});

test('resolve: auto uses the detected preset, explicit preset wins', () => {
  const a = resolve({}, 'high');
  assert.equal(a.preset, 'high');
  assert.equal(a.auto, true);
  assert.equal(a.shadows, presetTier('high', 'shadows'));
  const b = resolve({ preset: 'low' }, 'high');
  assert.equal(b.preset, 'low');
  assert.equal(b.auto, false);
  assert.equal(b.post, false, 'Low renders without a composer');
  assert.equal(b.cap, 1);
  assert.equal(resolve({ preset: 'bogus' }, 'nope').preset, 'balanced');
});

test('resolve: per-category overrides and invalid tiers', () => {
  const r = resolve({ preset: 'low', bloom: 'on', shadows: 'huge' }, 'low');
  assert.equal(r.bloom, 'on');
  assert.equal(r.shadows, 'off', 'invalid tier falls back to the preset');
  assert.equal(r.post, true, 'an override that needs post enables the composer');
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    for (const p of PRESETS) assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
  }
});

test('resolve: render scale clamps to 50–200 %, adaptive defaults on, fps off', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'high', render_scale: 1.5 }).scale, 1.5);
  assert.equal(resolve({}).adaptive, true);
  assert.equal(resolve({ adaptive: false }).adaptive, false);
  assert.equal(resolve({}).showFps, false);
  assert.equal(resolve({ show_fps: true }).showFps, true);
});

test('choosePreset clears overrides but keeps scale/adaptive/fps', () => {
  const s = choosePreset({ preset: 'low', bloom: 'on', ao: 'high', render_scale: 1.25, adaptive: false, show_fps: true }, 'ultra');
  assert.deepEqual(s, { preset: 'ultra', render_scale: 1.25, adaptive: false, show_fps: true });
  assert.deepEqual(choosePreset({ bloom: 'off' }, 'auto'), { preset: 'auto' });
});

test('describe summarises cost', () => {
  const t = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(t, /2048² shadows/);
  assert.match(t, /SMAA/);
  assert.match(t, /1280×800 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('every required locale has every panel string', () => {
  const need = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const en = GFX_STRINGS['en-US'];
  for (const loc of need) {
    const s = GFX_STRINGS[loc];
    assert.ok(s, loc);
    for (const k of Object.keys(en)) {
      if (typeof en[k] === 'object') for (const kk of Object.keys(en[k])) assert.ok(s[k][kk], `${loc}.${k}.${kk}`);
      else assert.ok(s[k], `${loc}.${k}`);
    }
    for (const p of PRESETS) assert.ok(s[p], `${loc}.${p}`);
    for (const [cat, tiers] of Object.entries(CATEGORIES)) { assert.ok(s.cat[cat]); for (const t of tiers) assert.ok(s.tier[t], `${loc}.tier.${t}`); }
  }
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(pickLocale('ja-JP'), 'en-US');
});
