// Localization coverage: every English key the engine client and the pure
// content use (T('…'), N('…')) is translated in every locale (en-GB → en-US,
// es-ES → es-419, fr-CA → fr-FR inherit), placeholders and markup survive, no
// table row is unused, and the StarHermit account strings cover the nine
// locales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadTables, codeKeys, audit, LOCALES } from './i18n-common.mjs';
import { LESSONS, CHALLENGES, PRACTICE, THEMES } from '../content.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const tables = loadTables(ROOT, 'strings.js', 'MP_STRINGS');

export function usedKeys() {
  const keys = new Set();
  const files = [...readdirSync(new URL('native/', ROOT)).filter((f) => f.endsWith('.ts')).map((f) => `native/${f}`), 'content.js'];
  for (const f of files) for (const k of codeKeys(read(f))) keys.add(k);
  return [...keys].sort();
}

test('every used key is translated in every locale; placeholders intact; no unused rows', () => {
  const used = usedKeys();
  assert.ok(used.length > 200, `only ${used.length} keys found`);
  assert.deepEqual(audit(tables, used), []);
});

test('themes, lessons, practice levels and challenges are translation keys', () => {
  const de = tables['de-DE'];
  const keys = [...THEMES.map((t) => t.label), ...LESSONS.flatMap((l) => [l.title, ...l.steps.map((s) => s.text)]),
    ...PRACTICE.map((p) => p.label), ...CHALLENGES.flatMap((c) => [c.label, c.desc])];
  for (const k of keys) assert.ok(de[k], k);
});

test('regional tables inherit and override', () => {
  assert.equal(tables['fr-CA']['Score {n}'], 'Pointage {n}');
  assert.equal(tables['es-ES'].Settings, 'Ajustes');
  assert.equal(tables['en-GB']['Color-vision-safe palette'], 'Colour-vision-safe palette');
});

test('StarHermit account strings cover all nine locales', async () => {
  const src = read('native/account.ts');
  for (const l of LOCALES) assert.ok(src.includes(`"${l}": {`), l);
  const blocks = src.split(/"[a-z]{2}-[A-Z0-9]{2,3}": \{/).slice(1);
  assert.equal(blocks.length, LOCALES.length);
  for (const b of blocks) for (const k of ['signIn', 'signInSub', 'invite', 'inviteSub', 'copied', 'copyFailed', 'signedOut', 'lbPosting', 'lbRank', 'lbPosted', 'lbFailed']) assert.match(b, new RegExp(`\\b${k}: "[^"]+"`), k);
});
