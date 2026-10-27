// The game's data and the StarHermit platform, on the runtime's modules (the
// browser build's platform.js over starhermit-sdk.js plus app.js's
// localStorage):
// - the progress (progress.js: furthest Journey stage, achievements, days
//   played, gallery time, personal bests) is the game's save
//   (starhermit:storage `saves`, schema 1: on the device and in the player's
//   cloud slot); two devices' saves merge on a conflict (mergeProgress, the
//   browser build's saveconflict merge). The slot the browser build wrote
//   through the JS SDK (game:<slug>, { v: 1, savedAt, progress, settings })
//   shows as foreign: it is merged in, its options adopted, and replaced once;
// - the round in progress stays on the device (storage key "session"), as
//   the browser build's mp-session-v1 did, and offers "Welcome back";
// - the game's own options (UI theme, colour-vision-safe palette, timing
//   assistance, left-handed layout) are engine `settings` (game.<key>, synced
//   with the account); the browser build's values in the account's settings
//   KV are migrated, then all its KV keys removed (volumes, mute, graphics,
//   reduced motion, high contrast and larger text are the runtime's Options);
// - the player, the invite link, the platform's clock (the Daily's date and
//   the top bar's UTC clock), the high-score board for the Leaderboards
//   screen, and posting a finished round's total through score-script.js (a
//   practice session whose socket carries { type: 'result', scores }, as the
//   JS SDK's submitScores did) with the rank on the board.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions,
  type Leaderboard,
} from "starhermit:platform";
import { saves, settings as store, storage } from "starhermit:storage";
import { Prog, type Options, type Progress } from "./game.ts";

export let progress: Progress = Prog.normalize(null);
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

function write(opts: { replaceForeign?: boolean } = {}): void {
  try {
    saves.save(progress as unknown as JsonValue, { schema: 1, ...opts });
    lastSavedAt = saves.load()?.savedAt ?? lastSavedAt;
  } catch (e) { console.warn(`save: ${String(e)}`); }
}
/** Saves progress (device at once, the account debounced by the runtime). */
export function saveProgress(): void { write(); }
/** Merges another document into the live one; whether anything changed (then saved). */
function adopt(other: unknown): boolean {
  const next = Prog.mergeSaves(progress, other);
  if (Prog.sameProgress(next, progress)) return false;
  progress = next;
  write();
  return true;
}
saves.onConflict((localSave, remote) => ({ merged: Prog.mergeSaves(localSave?.data ?? null, remote.data) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});
/** The browser build's cloud document: merged with this device's, its options adopted, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const doc = Prog.readForeign(old.text);
  const changed = doc ? adopt(doc.progress) : false;
  if (doc) for (const [k, v] of Object.entries(doc.options)) adoptOption(k as keyof Options, v);
  write({ replaceForeign: true });
  if (changed) merged();
}

/** The top bar's save status (app.js _showSyncStatus): local (a guest) | saving | synced | offline. */
export function syncState(): "local" | "saving" | "synced" | "offline" {
  if (!player()) return "local";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "offline";
  if (st === "loading" || st === "foreign" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the round in progress (device only) -----------------------------------------------------------
export interface SessionSnapshot {
  round: { mode: string; seed: number; stageIndex?: number; daily?: unknown; lessonId?: string | null };
  state: string;
}
export function loadSession(): SessionSnapshot | null {
  try {
    const v = storage.getJson("session") as unknown as SessionSnapshot | null;
    return v && typeof v === "object" && typeof v.state === "string" && v.round ? v : null;
  } catch { return null; }
}
export function storeSession(s: SessionSnapshot | null): void {
  try {
    if (s) storage.setJson("session", s as unknown as JsonValue);
    else storage.remove("session");
  } catch (e) { console.warn(`session: ${String(e)}`); }
}

// --- the game's options -----------------------------------------------------------------------------
export const options: Options = { ...Prog.DEFAULT_OPTIONS };
const KEYS = Prog.OPTION_KEYS;
const optionListeners = new Set<() => void>();
export function onOptionsChange(fn: () => void): void { optionListeners.add(fn); }
function optionsChanged(): void { for (const fn of optionListeners) fn(); }
function readOption(key: keyof Options): void {
  let v: JsonValue | undefined;
  try { v = store.get(key); } catch { return; }
  const ok = Prog.pickOptions({ [key]: v })[key];
  if (ok !== undefined) (options as unknown as Record<string, unknown>)[key] = ok;
}
/** A migrated value, kept unless this game set the key since. */
function adoptOption(key: keyof Options, value: unknown): void {
  const v = Prog.pickOptions({ [key]: value })[key];
  if (v === undefined) return;
  try {
    if (store.get(key) !== undefined) return;
    store.set(key, v as JsonValue);
    (options as unknown as Record<string, unknown>)[key] = v;
    optionsChanged();
  } catch { /* keep the device's */ }
}
/** Changes one of the game's options (device and account). */
export function setOption<K extends keyof Options>(key: K, value: Options[K]): void {
  if (options[key] === value) return;
  options[key] = value;
  try { store.set(key, value as JsonValue); } catch (e) { console.warn(`option ${key}: ${String(e)}`); }
  optionsChanged();
}
// The browser build patched its settings object into the account's settings KV key by key (plus the language
// helper's ui.language): the game's options carry over (unless set here since), then all of them are removed.
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  for (const key of keys) if ((KEYS as string[]).includes(key)) adoptOption(key as keyof Options, store.legacy(key));
  for (const key of keys) if (Prog.BROWSER_KEYS.includes(key) || key.startsWith("ui.")) store.removeLegacy(key);
}

/** Reads the device's save and the game's options (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  progress = Prog.normalize(cur?.data ?? null);
  for (const k of KEYS) readOption(k);
  store.onChange((key) => {
    if (!(KEYS as string[]).includes(key)) return;
    readOption(key as keyof Options);
    optionsChanged();
  });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  optionsChanged();
  refreshPlayer();
  void serverTime().catch(() => undefined);
}

// --- the player and the clock ------------------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(fallback: string): string { return player()?.displayName || fallback; }
export function userId(): string | null { return player()?.userId ?? null; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = undefined;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => refreshPlayer());

/** Now in ms by the platform's clock when it has answered, else the device's. */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}
/** Today's UTC date (YYYY-MM-DD) by that clock: the Daily's seed. */
export function utcToday(): string { return new Date(nowMs()).toISOString().slice(0, 10); }

// --- leaderboards ------------------------------------------------------------------------------------
let board: Leaderboard | null | undefined;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board !== undefined) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}
export interface BoardRow { rank: number | null; name: string; score: number; me: boolean }
/** The game's board, top `limit` (guests read it too): its name and rows; null when there is none. */
export async function boardEntries(limit: number): Promise<{ name: string; rows: BoardRow[] } | null> {
  const b = await highScoreBoard();
  if (!b) return null;
  const r = await leaderboards.entries(b.id, { pageSize: limit });
  const me = player()?.userId;
  return {
    name: b.name || "",
    rows: r.items.slice(0, limit).map((e) => ({ rank: e.rank ?? null, name: e.displayName || e.username, score: e.score ?? 0, me: !!me && e.userId === me })),
  };
}

/** Signed in only: post a finished round's total through score-script.js; { posted, rank }. Never rejects. */
export async function postLeaderboard(total: number): Promise<{ posted: boolean; rank: number | null }> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
