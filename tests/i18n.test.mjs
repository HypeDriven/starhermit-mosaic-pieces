// Localization coverage: every English key the markup and code use is
// translated in every locale (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR
// inherit), placeholders survive, the language follows sh-language.js and
// switches live, and the Graphics and StarHermit strings cover the nine locales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTables, codeKeys, htmlKeys, audit, bootI18n, LOCALES } from './i18n-common.mjs';
import { gfxStrings, shStrings } from '../gfx-i18n.js';
import { LESSONS, CHALLENGES, PRACTICE, THEMES } from '../content.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

function usedKeys() {
  const keys = new Set(htmlKeys(read('index.html')));
  for (const f of ['app', 'ui', 'platform', 'content']) codeKeys(read(`${f}.js`), ['tr']).forEach((k) => keys.add(k));
  return [...keys].sort();
}

test('every used key is translated in every locale; placeholders intact', () => {
  const used = usedKeys();
  assert.ok(used.length > 200, 'keys found: ' + used.length);
  assert.deepEqual(audit(loadTables(ROOT, 'strings.js', 'MP_STRINGS'), used), []);
});

test('every lesson, challenge, practice and theme text is a translation key', () => {
  const de = loadTables(ROOT, 'strings.js', 'MP_STRINGS')['de-DE'];
  const keys = [...LESSONS.flatMap((l) => [l.title, ...l.steps.map((s) => s.text)]), ...CHALLENGES.flatMap((c) => [c.label, c.desc]),
    ...PRACTICE.map((p) => p.label), ...THEMES.map((t) => t.label)];
  for (const k of keys) assert.ok(de[k], 'de-DE missing ' + k);
});

test('the locale follows sh-language and switches live', () => {
  const { I18N, events, doc } = bootI18n(ROOT, { strings: 'strings.js', i18n: 'i18n.js', global: 'MPI18N', languages: ['de-DE'] });
  assert.equal(I18N.lang, 'de-DE');
  assert.equal(doc.documentElement.lang, 'de-DE');
  assert.equal(I18N.T('Rotate'), 'Drehen');
  I18N.language.setChoice('fr-CA');
  assert.equal(I18N.lang, 'fr-CA');
  assert.equal(events.at(-1), 'fr-CA');
  assert.equal(I18N.T('Score {n}', { n: 3 }), 'Pointage 3');
  assert.equal(I18N.T('Rotate'), 'Pivoter');
  I18N.language.setChoice('es-ES');
  assert.equal(I18N.T('Settings'), 'Ajustes');
});

test('Graphics and StarHermit strings cover all nine locales', () => {
  const shKeys = Object.keys(shStrings('en-US'));
  for (const l of LOCALES) {
    assert.ok(gfxStrings(l).graphics, l);
    for (const k of shKeys) assert.ok(shStrings(l)[k], `${l} ${k}`);
  }
});
