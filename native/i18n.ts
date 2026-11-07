// Localization: the engine's string tables (assets/strings.json, generated from
// the browser build's tables: English source strings as the keys, the nine
// StarHermit locales, en-GB, es-ES and fr-CA carrying only their differences) in
// the interface language the runtime reports (the player's choice in Options ›
// Language, else the account's preferred language or the device's). The
// runtime's Options replace the game's own Language setting (sh-language.js) and
// i18n.js's DOM re-labelling: every string is drawn through T() each frame, so a
// change shows on the next frame. Account lines are the engine's `starhermit.*`
// keys; the two the engine lacks are `acct.*`.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
/** An English source string in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return strings.t(String(key), vars ?? undefined); }
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
/** Rich text from the tables (<strong>…</strong>) as plain text. */
export function plain(s: string): string { return s.replace(/<[^>]+>/g, ""); }
export function currentLocale(): string { return strings.locale; }
