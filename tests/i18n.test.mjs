// Localization coverage: every English key the engine client and the pure
// content use (T('…'), N('…')) is translated in every locale (en-GB → en-US,
// es-ES → es-419, fr-CA → fr-FR inherit), placeholders and markup survive, no
// table row is unused, and the StarHermit account strings cover the nine
// locales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { codeKeys, audit } from './i18n-common.mjs';
import { LESSONS, CHALLENGES, PRACTICE, THEMES } from '../content.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const tables = JSON.parse(read('assets/strings.json'));

export function usedKeys() {
  const keys = new Set();
  const files = [...readdirSync(new URL('native/', ROOT)).filter((f) => f.endsWith('.ts')).map((f) => `native/${f}`), 'content.js'];
  for (const f of files) for (const k of codeKeys(read(f))) if (!k.startsWith('starhermit.')) keys.add(k);
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

test('the account lines the engine lacks cover all full locales', () => {
  for (const l of ['en-US', 'es-419', 'de-DE', 'fr-FR', 'pt-BR', 'it-IT']) for (const k of ['acct.signInSub', 'acct.inviteSub']) assert.ok(tables[l][k], `${l} ${k}`);
});
