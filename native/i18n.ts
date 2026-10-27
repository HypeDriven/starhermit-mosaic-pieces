// Localization: the browser build's tables (strings.js, English source
// strings as the keys, the nine StarHermit locales — en-GB, es-ES and fr-CA
// carry only their differences from en-US, es-419 and fr-FR; account.ts for
// the StarHermit account lines) in the interface language the runtime reports
// (preferences().language: the player's choice in Options › Language, else the
// account's preferred language or the device's). The runtime's Options replace
// the game's own Language setting (sh-language.js) and i18n.js's DOM
// re-labelling: every string is drawn through T() each frame, so a change
// shows on the next frame.
import { onPreferencesChange, preferences } from "starhermit:engine";
import { loadClassic } from "starhermit:script";
import * as ui from "starhermit:ui";
import { SH_STRINGS, type AccountStrings } from "./account.ts";

loadClassic("strings.js");
const TABLES = (globalThis as unknown as { MP_STRINGS: Record<string, Record<string, string>> }).MP_STRINGS;
export const LOCALES = ["en-US", "en-GB", "es-419", "es-ES", "de-DE", "fr-FR", "fr-CA", "pt-BR", "it-IT"];
const PARENT: Record<string, string> = { "en-GB": "en-US", "es-ES": "es-419", "fr-CA": "fr-FR" };

let locale = "en-US";
export type Vars = Record<string, string | number>;

/** The supported locale for a language tag (gfx-i18n.js pickLocale: exact, then the language's family). */
export function pickLocale(tag: string): string {
  const t = String(tag || "en-US");
  const exact = LOCALES.find((l) => l.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const [lang = "", region = ""] = t.split(/[-_]/);
  const r = region.toUpperCase();
  switch (lang.toLowerCase()) {
    case "en": return ["GB", "IE", "AU", "NZ", "ZA", "IN"].includes(r) ? "en-GB" : "en-US";
    case "es": return r === "ES" ? "es-ES" : r ? "es-419" : "es-ES";
    case "fr": return r === "CA" ? "fr-CA" : "fr-FR";
    case "pt": return "pt-BR";
    case "de": return "de-DE";
    case "it": return "it-IT";
    default: return "en-US";
  }
}

function lookup(key: string): string {
  for (let l: string | undefined = locale; l; l = PARENT[l]) {
    const t = TABLES[l];
    if (t && Object.prototype.hasOwnProperty.call(t, key)) return t[key]!;
  }
  return key;
}
/** An English source string in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string {
  const s = lookup(key);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
/** Rich text from the tables (<strong>…</strong>) as plain text. */
export function plain(s: string): string { return s.replace(/<[^>]+>/g, ""); }
/** The StarHermit account strings (sign-in, invite, toasts, leaderboard line) in the game language. */
export function account(): AccountStrings { return SH_STRINGS[locale] ?? SH_STRINGS["en-US"]!; }
export function currentLocale(): string { return locale; }

function apply(tag: string): void {
  locale = pickLocale(tag);
  ui.setLanguage(locale);
}
apply(preferences().language);
onPreferencesChange((p) => { if (pickLocale(p.language) !== locale) apply(p.language); });
