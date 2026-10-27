// Mosaic Pieces on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (rules.js), the content (content.js) and
// the save document (progress.js) are the browser build's pure modules, shared
// with the dev server.js and the Node tests; this module is what its app.js
// did around them: the screens (title, mode select, learn, journey, practice,
// challenge, setup, pause, results, help, settings, profile, leaderboards,
// welcome back), the round (the single validated command path with its
// idempotent command ids, the explanations for illegal targets, the round
// clock and time limits with the last-ten-seconds tick, the lesson steps,
// progression, achievements, personal bests, posting ranked rounds to the
// high-score board), the round that survives leaving, and input: the
// keyboard and gamepad actions with the board cursor, the tray and board-cell
// buttons, taps, clicks and drags on the 3D desk.
//
// Time is the runtime's fixed steps: the round clock advances by them while a
// round is active and unpaused, so a hidden window or slow frames never cost
// time and play scripts replay exactly.
import "./i18n.ts";
import {
  clipboard, frame, onFixedUpdate, onPreferencesChange, onQuit, onRender, onResume, onStart, onSuspend, onUpdate, preferences,
} from "starhermit:engine";
import { bindings, onAction, onPointerButton, onPointerMove, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import * as audio from "./audio.ts";
import { Content, Rules, type Challenge, type Command, type Daily, type Lesson, type PracticePreset, type Ruleset, type Stage, type State } from "./game.ts";
import { account, N, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTheme, initStyles } from "./style.ts";

export type Screen = "title" | "mode" | "learn" | "journey" | "practice" | "challenge" | "setup" | "pause" | "results" | "help"
  | "settings" | "profile" | "leaderboard" | "resume";
export type Kind =
  | { mode: "lesson"; lesson: Lesson }
  | { mode: "journey"; stage: Stage }
  | { mode: "daily"; daily: Daily }
  | { mode: "practice"; preset: PracticePreset }
  | { mode: "challenge"; challenge: Challenge };
export interface Round {
  mode: string; seed: number; ruleset: Ruleset; lesson: Lesson | null; stageIndex: number | null; daily: Daily | null;
  lessonStep: number; lessonStepAt: number; sessionId: string;
  /** The content's ruleset before timing assistance doubled its limit (Play again starts from it). */
  base: Ruleset;
}
type Text = () => string;

export const ACHIEVEMENTS = [
  { key: "first_completion", label: N("First Mosaic"), desc: N("Complete your first mosaic.") },
  { key: "rotation_master", label: N("Rotation Master"), desc: N("Complete a rotation stage without hints.") },
  { key: "streak_3", label: N("Gallery Regular"), desc: N("Complete mosaics on 3 different days.") },
  { key: "journey_20", label: N("Half the Gallery"), desc: N("Complete journey stage 20.") },
  { key: "long_haul", label: N("Patient Curator"), desc: N("Spend 60 total minutes in the gallery (any assists).") },
];

export const app = {
  /** The open screen (null: the round shows). */
  screen: null as Screen | null,
  /** Frame the screen opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  /** Compact layouts: the open drawer. */
  drawer: null as null | "left" | "right",
  toasts: [] as { text: Text; until: number }[],
  pendingKind: null as Kind | null,
  /** The results' extra lines (journey progress) and leaderboard line, in the current language. */
  resultNote: null as Text | null,
  lbText: null as Text | null,
  resultState: null as State | null,
  /** The saved round the "Welcome back" screen offers. */
  resumable: null as null | { snap: platform.SessionSnapshot; state: State },
  /** The board cursor (keyboard arrows / gamepad), -1 hidden. */
  cursor: -1,
};
export const options = platform.options;
const now = (): number => frame().time;
export const fresh = (n = 1): boolean => frame().frame - app.openedFrame <= n;

export function announce(text: string, assertive = false): void {
  if (text) ui.announce(text.slice(0, 480), assertive ? { politeness: "assertive" } : undefined);
}
export function toast(text: Text, secs = 3.5): void { app.toasts.push({ text, until: now() + secs }); }

/** ui.openScreen: a screen replaces the open one, its first button focused. */
export function openScreen(s: Screen, focus: string | null = null): void {
  app.drawer = null;
  app.screen = s;
  app.openedFrame = frame().frame;
  app.focusNext = focus ?? "first";
  ui.setFocus(null);
}
export function closeScreen(): void {
  app.screen = null;
  app.openedFrame = frame().frame;
  app.focusNext = null;
  ui.setFocus(null);
}

// ------------------------------------------------------------------ keys
const KEY_GLYPHS: Record<string, string> = { "Arrow Left": "←", "Arrow Right": "→", "Arrow Up": "↑", "Arrow Down": "↓", Escape: "Esc" };
/** app.js _keys: an action's effective keys, e.g. "R" (keyLabel). */
export function keysFor(action: string): string {
  let list: readonly { device: string; label: string }[] = [];
  try { list = bindings(action); } catch { list = []; }
  const names = list.filter((b) => b.device === "keyboard").map((b) => KEY_GLYPHS[b.label] ?? b.label);
  return [...new Set(names)].join("/") || "—";
}
/** The first key of an action (the rail's <kbd> labels). */
export function firstKey(action: string): string { return keysFor(action).split("/")[0] ?? ""; }

// ------------------------------------------------------------------ the round
export let state: State | null = null;
export let round: Round | null = null;
export let paused = false;
export let timeLeftSec: number | null = null;
let lastTickSec = -1;
/** The round clock in ms (fixed steps while active); the state's elapsedMs follows it every quarter second. */
let clockMs = 0;
let cmdCounter = 0;
const appliedCmdIds = new Set<string>();
/** The results screen opens at this time after a round ends (the win's settle). */
let resultsAt: number | null = null;

export const nextJourney = (): number => Math.min(platform.progress.journeyCompleted + 1, Content.JOURNEY.length);
const newSessionId = (): string => "s-" + Math.random().toString(36).slice(2, 10);
export function canPlay(): boolean { return !!state && state.status === "active" && !paused && !app.screen; }
export function paletteTheme(): string { return options.cvdPalette ? "default" : state?.ruleset.theme ?? "default"; }

export function showTitle(): void {
  teardownRound();
  openScreen("title", "btn-play");
}
function teardownRound(): void {
  state = null;
  round = null;
  paused = false;
  resultsAt = null;
  app.cursor = -1;
  render.clearPuzzle();
  platform.storeSession(null);
}

export function setupInfo(kind: Kind): { title: string; desc: string; ruleset: Partial<Ruleset>; undo: boolean; ranked: boolean; rankedLabel?: string; duration: string } {
  switch (kind.mode) {
    case "lesson": return { title: T("Lesson: {title}", { title: T(kind.lesson.title) }), desc: T("Interactive tutorial — unranked."), ruleset: kind.lesson.ruleset, undo: true, ranked: false, duration: T("~{n} minutes", { n: 2 }) };
    case "journey": { const s = kind.stage; return { title: T("Journey stage {n}", { n: s.index }), desc: s.mastery ? T("Mastery stage.") : T("Authored progression stage."), ruleset: s.ruleset, undo: true, ranked: false, duration: T("~{n} minutes", { n: Math.round(s.par.timeSec / 60) }) }; }
    case "daily": return { title: T("Daily challenge — {date}", { date: kind.daily.date }), desc: T("One shared seed for all players today. Ranked; no undo."), ruleset: kind.daily.ruleset, undo: false, ranked: true, rankedLabel: platform.signedIn() ? T("Yes — platform board (read-only)") : T("Yes — submitted for validation"), duration: T("~{n} minutes", { n: 5 }) };
    case "practice": return { title: T("Practice — {level}", { level: T(kind.preset.label) }), desc: T("Restart and undo freely; no effect on ratings."), ruleset: kind.preset.ruleset, undo: true, ranked: false, duration: T("At your own pace") };
    case "challenge": return { title: T("Challenge: {name}", { name: T(kind.challenge.label) }), desc: T(kind.challenge.desc), ruleset: kind.challenge.ruleset, undo: false, ranked: false, duration: T("~{n} minutes", { n: 4 }) };
  }
}
export function confirmSetup(kind: Kind): void {
  app.pendingKind = kind;
  openScreen("setup", "btn-start");
}
export function startDaily(): void { confirmSetup({ mode: "daily", daily: Content.dailyContent(platform.utcToday()) }); }
export function startPending(): void {
  const kind = app.pendingKind;
  if (!kind) return;
  app.pendingKind = null;
  switch (kind.mode) {
    case "lesson": startRound("lesson", kind.lesson.seed, kind.lesson.ruleset as Ruleset, { lesson: kind.lesson }); break;
    case "journey": startRound("journey", kind.stage.seed, kind.stage.ruleset, { stageIndex: kind.stage.index }); break;
    case "daily": startRound("daily", kind.daily.seed, kind.daily.ruleset, { daily: kind.daily }); break;
    case "practice": startRound("practice", (Math.random() * 0xffffffff) >>> 0, kind.preset.ruleset as Ruleset); break;
    case "challenge": startRound("challenge", kind.challenge.seed, kind.challenge.ruleset as Ruleset); break;
  }
}

function startRound(mode: string, seed: number, ruleset: Ruleset, extra: { lesson?: Lesson; stageIndex?: number; daily?: Daily } = {}): void {
  const rs = { ...ruleset };
  if (options.timingAssist && rs.timeLimitSec) rs.timeLimitSec *= 2;
  closeScreen();
  cmdCounter = 0;
  appliedCmdIds.clear();
  state = Rules.newGame(seed, rs, mode === "lesson" ? "practice" : mode);
  round = {
    mode, seed, ruleset: state.ruleset, lesson: extra.lesson ?? null, stageIndex: extra.stageIndex ?? null, daily: extra.daily ?? null,
    lessonStep: 0, lessonStepAt: 0, sessionId: newSessionId(), base: ruleset,
  };
  clockMs = 0;
  paused = false;
  resultsAt = null;
  timeLeftSec = rs.timeLimitSec || null;
  lastTickSec = -1;
  app.cursor = -1;
  render.buildPuzzle(state, paletteTheme());
  syncMirror();
  audio.startAmbience();
  audio.playEvent("roundstart");
  if (mode === "lesson") announceLessonStep();
  else announce(T("{mode}. {n} pieces. Select a piece from the tray to begin.", { mode: modeLabel(), n: state.pieces.length }));
  saveSession();
}

export function objectiveText(): string {
  if (!round || !state) return T("Assemble the mosaic.");
  if (round.mode === "lesson" && round.lesson) {
    const step = round.lesson.steps[round.lessonStep];
    if (step) return T("Lesson: {title}", { title: T(step.text) });
  }
  const rs = state.ruleset;
  let t = T("{mode}: place all {n} pieces on the {cols}×{rows} board.", { mode: modeLabel(), n: state.pieces.length, cols: rs.cols, rows: rs.rows });
  if (rs.needRotation) t += " " + T("Pieces must be upright (rotate with R).");
  if (rs.moveLimit) t += " " + T("Move limit: {n}.", { n: rs.moveLimit });
  if (rs.timeLimitSec) t += " " + T("Time limit: {n}s.", { n: rs.timeLimitSec });
  return t;
}
export function modeLabel(): string {
  const r = round;
  if (!r) return "";
  if (r.mode === "journey") return T("Journey stage {n}", { n: r.stageIndex ?? 1 });
  if (r.mode === "daily") return T("Daily challenge");
  if (r.mode === "lesson") return T("Lesson: {title}", { title: T(r.lesson?.title ?? "") });
  if (r.mode === "challenge") return T("Challenge");
  return T("Practice");
}

export function quitRound(): void {
  if (round && state) platform.progress.totalTimeMs += state.elapsedMs;
  platform.saveProgress();
  showTitle();
}
export function pause(): void {
  if (!state || state.status !== "active" || app.screen) return;
  paused = true;
  audio.playEvent("ui");
  openScreen("pause", "btn-resume");
  saveSession();
}
export function resume(): void {
  paused = false;
  closeScreen();
  audio.playEvent("ui");
}

// ------------------------------------------------------------------ commands
/** app.js _cmd: the one validated command path (idempotent ids), then feedback, the mirror, the lesson, the end. */
export function cmd(c: Command): boolean {
  if (!state) return false;
  const id = round!.sessionId + ":" + (++cmdCounter);
  if (appliedCmdIds.has(id)) return false; // idempotent double-commit guard
  appliedCmdIds.add(id);
  const prev = state;
  try {
    state = Rules.applyCommand(prev, { ...c, id });
  } catch (e) {
    announce(T("Action rejected: {reason}", { reason: e instanceof Error ? e.message : String(e) }), true);
    return false;
  }
  const changed = state !== prev;
  if (state.invalidActions > prev.invalidActions) {
    audio.playEvent("invalid");
    announce(invalidReason(c), true);
  } else if (changed) {
    audio.playEvent(c.type === "place" ? "snap" : c.type === "rotate" ? "rotate" : c.type);
    if (c.type === "place") {
      const placed = state.pieces.filter((p) => p.placed).length;
      announce(T("Piece placed. {n} of {total}.", { n: placed, total: state.pieces.length }));
    }
  }
  syncMirror();
  saveSession();
  checkLesson(c, prev);
  checkTerminal();
  return changed;
}
export function invalidReason(c: Command): string {
  if (c.type === "place" && state) {
    const code = Rules.canPlace(state, c.piece!, c.cell!);
    const why = ({
      PIECE_PLACED: N("That piece is already placed."),
      CELL_OCCUPIED: N("That cell is occupied."),
      CELL_OUT_OF_BOUNDS: N("That cell is off the board."),
      WRONG_ROTATION: N("The piece must be upright first — rotate it with R."),
      GAME_OVER: N("The round is over."),
    } as Record<string, string>)[code ?? ""];
    return why ? T(why) : T("That placement is not legal.");
  }
  if (c.type === "undo") return T("Nothing to undo (or undo is disabled in this ranked mode).");
  if (c.type === "hint") return T("No hint available right now.");
  return T("That action is not available.");
}
/** The legal targets of the selected piece glow; the 3D view follows the snapshot. */
export function syncMirror(): void {
  if (!state) return;
  const candidates = state.selected != null ? Rules.legalTargetsFor(state, state.selected) : [];
  render.sync(state);
  render.showLegalTargets(candidates);
  render.setCursor(app.cursor);
}
export function candidates(): number[] { return state && state.selected != null ? Rules.legalTargetsFor(state, state.selected) : []; }
export function canUndo(): boolean { return !!state && state.status === "active" && !paused && state.history.length > 0 && state.mode !== "daily" && state.mode !== "challenge"; }

function checkTerminal(): void {
  if (!state || state.status === "active" || !round) return;
  const win = state.status === "complete";
  audio.playEvent(win ? "complete" : "fail");
  platform.progress.totalTimeMs += state.elapsedMs;
  app.resultNote = null;
  app.lbText = null;
  if (win) {
    app.resultNote = applyProgression();
    submitScore();
    postToLeaderboard(Rules.score(state));
  }
  platform.saveProgress();
  platform.storeSession(null);
  app.resultState = state;
  resultsAt = now() + (win && !preferences().reducedMotion ? 0.7 : 0.1);
}
/** Signed in only: post a completed journey, daily or challenge round to the high-score board; the results show the rank. */
function postToLeaderboard(total: number): void {
  if (!platform.signedIn() || !round || !["journey", "daily", "challenge"].includes(round.mode)) return;
  const token = {};
  lbToken = token;
  app.lbText = () => account().lbPosting;
  void platform.postLeaderboard(total).then((r) => {
    if (token !== lbToken) return;
    app.lbText = () => (!r.posted ? account().lbFailed : r.rank ? account().lbRank.replace("{rank}", String(r.rank)) : account().lbPosted);
  });
}
let lbToken: object | null = null;
function applyProgression(): Text | null {
  const p = platform.progress;
  let notes: Text | null = null;
  const unlock = (key: string): void => {
    if (p.achievements.includes(key)) return;
    p.achievements.push(key);
    const meta = ACHIEVEMENTS.find((a) => a.key === key);
    if (meta) {
      toast(() => "🏆 " + T("Achievement unlocked: {name}", { name: T(meta.label) }), 4);
      audio.playEvent("achieve");
      announce(T("Achievement unlocked: {name}", { name: T(meta.label) }));
    }
  };
  unlock("first_completion");
  const today = platform.utcToday();
  if (!p.daysPlayed.includes(today)) { p.daysPlayed.push(today); p.daysPlayed.sort(); }
  if (p.daysPlayed.length >= 3) unlock("streak_3");
  if (round!.mode === "journey") {
    if (round!.stageIndex === p.journeyCompleted + 1) {
      p.journeyCompleted = round!.stageIndex;
      const done = p.journeyCompleted;
      notes = () => T("Journey progress: {n}/{total} stages.", { n: done, total: Content.JOURNEY.length });
    }
    if (p.journeyCompleted >= 20) unlock("journey_20");
    if (state!.ruleset.needRotation && state!.hintsUsed === 0) unlock("rotation_master");
  }
  if (p.totalTimeMs >= 60 * 60 * 1000) unlock("long_haul");
  return notes;
}
/** Personal bests (daily board, chase board for journey and challenge), kept locally and in the cloud save. */
function submitScore(): void {
  const r = round!, st = state!;
  if (r.mode !== "daily" && r.mode !== "challenge" && r.mode !== "journey") return;
  const board = r.mode === "daily" ? "daily" : "chase";
  const result = { score: Rules.score(st), elapsedMs: Math.floor(st.elapsedMs), invalidActions: st.invalidActions };
  const p = platform.progress;
  const prev = p.best[board];
  const better = !prev || Rules.compareResults(
    { score: result.score, completed: true, invalidActions: result.invalidActions, elapsedMs: result.elapsedMs, sessionId: r.sessionId },
    { score: prev.score, completed: true, invalidActions: prev.invalidActions || 0, elapsedMs: prev.elapsedMs || 0, sessionId: "" }) < 0;
  if (!better) return;
  p.best = { ...p.best, [board]: board === "daily" ? { date: r.daily?.date ?? platform.utcToday(), ...result } : result };
  announce(T("New personal best: {n}.", { n: result.score }));
}

// ------------------------------------------------------------------ tutorial
function announceLessonStep(): void {
  const lesson = round?.lesson;
  const step = lesson?.steps[round!.lessonStep];
  if (!step) return;
  round!.lessonStepAt = state?.elapsedMs ?? 0;
  announce(T(step.text));
}
/** Informational steps (nothing to await) move on by themselves after a short read (3.2 s of round time). */
function autoAdvanceLesson(): void {
  if (!round || round.mode !== "lesson" || !round.lesson || !state) return;
  const step = round.lesson.steps[round.lessonStep];
  if (!step || step.await) return;
  if (state.elapsedMs - round.lessonStepAt >= 3200) {
    round.lessonStep++;
    announceLessonStep();
  }
}
function checkLesson(c: Command, prev: State): void {
  if (!round || round.mode !== "lesson" || !round.lesson || !state) return;
  const step = round.lesson.steps[round.lessonStep];
  if (!step || !step.await) return;
  const done =
    (step.await === "select" && c.type === "select" && state.selected !== null) ||
    (step.await === "place" && c.type === "place" && state.invalidActions === prev.invalidActions) ||
    (step.await === "rotate" && c.type === "rotate") ||
    (step.await === "hint" && c.type === "hint") ||
    (step.await === "complete" && state.status === "complete");
  if (done && step.await !== "complete") {
    round.lessonStep++;
    announceLessonStep();
  }
}
export function nextRecommended(): void {
  if (round?.mode === "journey" && nextJourney() <= Content.JOURNEY.length) confirmSetup({ mode: "journey", stage: Content.JOURNEY[nextJourney() - 1]! });
  else openScreen("mode");
}
export function retry(): void {
  if (!round) { showTitle(); return; }
  const { mode, seed, ruleset, lesson, stageIndex, daily } = round;
  const extra: { lesson?: Lesson; stageIndex?: number; daily?: Daily } = {};
  if (lesson) extra.lesson = lesson;
  if (stageIndex) extra.stageIndex = stageIndex;
  if (daily) extra.daily = daily;
  // from the content's ruleset: timing assistance doubles its limit once, not again on every retry
  startRound(mode, mode === "practice" ? (Math.random() * 0xffffffff) >>> 0 : seed, round.base ?? ruleset, extra);
}

// ------------------------------------------------------------------ session persistence / resume
function saveSession(): void {
  if (!state || state.status !== "active" || !round) return;
  platform.storeSession({
    round: { mode: round.mode, seed: round.seed, stageIndex: round.stageIndex ?? undefined, daily: round.daily ?? undefined, lessonId: round.lesson?.id ?? null } as platform.SessionSnapshot["round"],
    state: Rules.serialize(state),
  });
}
function resumeCheck(): boolean {
  const doc = platform.loadSession();
  if (!doc) return false;
  try {
    const st = Rules.deserialize(doc.state);
    if (st.status !== "active") { platform.storeSession(null); return false; }
    app.resumable = { snap: doc, state: st };
    openScreen("resume", "btn-resume-saved");
    return true;
  } catch { platform.storeSession(null); return false; }
}
export function resumeSaved(): void {
  const r = app.resumable;
  if (!r) return;
  app.resumable = null;
  const doc = r.snap;
  closeScreen();
  state = r.state;
  cmdCounter = 0;
  appliedCmdIds.clear();
  round = {
    mode: doc.round.mode, seed: doc.round.seed, ruleset: state.ruleset,
    lesson: Content.LESSONS.find((l) => l.id === doc.round.lessonId) ?? null,
    stageIndex: doc.round.stageIndex ?? null, daily: (doc.round.daily as Daily | undefined) ?? null,
    lessonStep: 0, lessonStepAt: state.elapsedMs, sessionId: newSessionId(), base: state.ruleset,
  };
  clockMs = state.elapsedMs;
  paused = false;
  resultsAt = null;
  // a timed round keeps its remaining time across the interruption
  timeLeftSec = state.ruleset.timeLimitSec ? Math.max(0, state.ruleset.timeLimitSec - state.elapsedMs / 1000) : null;
  lastTickSec = -1;
  app.cursor = -1;
  render.buildPuzzle(state, paletteTheme());
  syncMirror();
  audio.startAmbience();
}
export function discardSaved(): void { app.resumable = null; platform.storeSession(null); showTitle(); }

// ------------------------------------------------------------------ actions on pieces and cells
export function selectPiece(id: number): void {
  if (!canPlay() || !state) return;
  const piece = Rules.pieceById(state, id);
  if (!piece || piece.placed) { // explain instead of banking an invalid action
    announce(T("That piece is already placed."), true);
    audio.playEvent("invalid");
    return;
  }
  if (state.selected === id) { cmd({ type: "rotate", piece: id, rotations: 1 }); return; } // second click rotates
  if (cmd({ type: "select", piece: id })) {
    announce(T("Piece {n} selected. {cells} legal cells highlighted.", { n: id + 1, cells: Rules.legalTargetsFor(state, id).length }));
  }
}
export function placeSelected(cell: number): void {
  if (!canPlay() || !state || state.selected == null) {
    if (state && state.selected == null) announce(T("Select a tray piece first."), true);
    return;
  }
  const code = Rules.canPlace(state, state.selected, cell);
  if (code) { // known-illegal target: explain, do not penalise the misclick
    announce(invalidReason({ type: "place", piece: state.selected, cell }), true);
    audio.playEvent("invalid");
    return;
  }
  cmd({ type: "place", piece: state.selected, cell });
}
export function rotateSelected(): void {
  if (canPlay() && state && state.selected != null) cmd({ type: "rotate", piece: state.selected, rotations: 1 });
  else announce(T("Select a piece first."), true);
}
export function hint(): void { if (canPlay()) cmd({ type: "hint" }); }
export function undo(): void { if (canPlay()) cmd({ type: "undo" }); }
function openPieces(): number[] { return state ? state.tray.filter((id) => !Rules.pieceById(state!, id)!.placed) : []; }

// ------------------------------------------------------------------ the platform
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  let ok = false;
  try { clipboard.writeText(link); ok = true; } catch { ok = false; }
  toast(ok ? () => account().copied : () => account().copyFailed);
}

// ------------------------------------------------------------------ input
// Keys and pad buttons (starhermit.txt control.* / engine.gamepad.*). With a widget focused (Tab), the arrows and
// Enter are the UI's (moving through the tray and board-cell buttons, as the browser build's list navigation did);
// otherwise they move the board cursor and place on it, and the pad's South picks the next tray piece first.
const BOARD_KEYS = new Set(["left", "right", "up", "down", "place"]);
onAction((e) => {
  if (!e.pressed) return;
  if (e.action === "pause") {
    if (fresh(0)) return;
    if (paused) resume();
    // Title, mode select and results have no board behind them: closing them would leave an empty screen.
    else if (app.screen) { if (state && state.status === "active") closeScreen(); }
    else if (app.drawer) app.drawer = null;
    else pause();
    return;
  }
  if (!canPlay() || !state) return;
  if (BOARD_KEYS.has(e.action) && e.source !== "pointer" && ui.focused() !== null) return;
  const rs = state.ruleset, n = rs.cols * rs.rows;
  const moveCursor = (d: number): void => { app.cursor = app.cursor < 0 ? 0 : (app.cursor + d + n) % n; render.setCursor(app.cursor); announceCursor(); };
  switch (e.action) {
    case "rotate": if (state.selected != null) cmd({ type: "rotate", piece: state.selected, rotations: 1 }); break;
    case "hint": cmd({ type: "hint" }); break;
    case "undo": cmd({ type: "undo" }); break;
    case "camera": render.resetCamera(); break;
    case "left": moveCursor(-1); break;
    case "right": moveCursor(1); break;
    case "up": moveCursor(-rs.cols); break;
    case "down": moveCursor(rs.cols); break;
    case "place":
      if (state.selected == null) { const open = openPieces(); if (open.length) selectPiece(open[0]!); }
      else { if (app.cursor < 0) { app.cursor = 0; render.setCursor(0); } placeSelected(app.cursor); }
      break;
    default:
      if (/^pick[1-9]$/.test(e.action)) { // quick-select: nth unplaced tray piece
        const id = openPieces()[Number(e.action.slice(4)) - 1];
        if (id !== undefined) selectPiece(id);
      }
  }
});
function announceCursor(): void {
  if (!state || app.cursor < 0) return;
  const c = app.cursor, cols = state.ruleset.cols;
  announce(T("Cursor on column {x} row {y}.", { x: c % cols + 1, y: Math.floor(c / cols) + 1 }));
}

// Pointer and touch on the 3D desk (app.js _pointerDown/_pointerMove/_pointerUp): every press on the playfield
// starts a gesture; a press on a tray piece that moves over 8 px becomes a drag (the piece is selected and follows
// the pointer, released on a cell it is placed there), anything else resolves as a tap on release (a piece
// selects, a selected piece rotates, a cell takes the selected piece). Presses are queued and decided once the
// frame's UI is built, so a press on a widget is the widget's.
interface Press { kind: "down" | "move" | "up" | "cancel"; x: number; y: number }
const queued: Press[] = [];
let down: null | { pieceId: number | null; moved: boolean; x0: number; y0: number } = null;
let lastTouch = -10;
let pointerUpFrame = -10;
/** A pointer button or finger lifted this frame or the last (a click or tap activates on its release). */
export function pointerActivation(): boolean { return frame().frame - pointerUpFrame <= 1; }
onPointerButton((e) => {
  if (!e.pressed) pointerUpFrame = frame().frame;
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  queued.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y });
});
onPointerMove((x, y) => { if (down && now() - lastTouch >= 0.6) queued.push({ kind: "move", x, y }); });
onTouch((e) => {
  if (!e.primary || e.control) return;
  lastTouch = now();
  if (e.phase === "end") pointerUpFrame = frame().frame;
  queued.push({ kind: e.phase === "start" ? "down" : e.phase === "move" ? "move" : e.phase === "end" ? "up" : "cancel", x: e.x, y: e.y });
});
function deskInput(): void {
  for (const q of queued.splice(0)) {
    if (q.kind === "cancel") { if (down) { down = null; render.endDrag(); if (state) render.sync(state); } continue; }
    if (q.kind === "down") {
      down = null;
      if (!canPlay() || !state || app.drawer || ui.pointerOver() || !render.insidePlayfield(q.x, q.y)) continue;
      const hit = render.pick(state, q.x, q.y);
      down = { pieceId: hit && hit.kind === "piece" ? hit.pieceId : null, moved: false, x0: q.x, y0: q.y };
      continue;
    }
    if (q.kind === "move") {
      const d = down;
      if (!d || d.pieceId == null || !state) continue;
      if (!d.moved && Math.hypot(q.x - d.x0, q.y - d.y0) / frame().scale > 8) {
        d.moved = true;
        if (state.selected !== d.pieceId) cmd({ type: "select", piece: d.pieceId });
        audio.playEvent("pickup");
      }
      if (d.moved) render.moveDragged(d.pieceId, q.x, q.y);
      continue;
    }
    const d = down;
    down = null;
    if (!d) continue;
    render.endDrag();
    if (!canPlay() || !state) { if (state) render.sync(state); continue; }
    const hit = render.pick(state, q.x, q.y, d.moved ? d.pieceId : null);
    if (d.moved) {
      if (hit && hit.kind === "cell") {
        if (state.selected !== d.pieceId) cmd({ type: "select", piece: d.pieceId! });
        placeSelected(hit.cell);
      }
      render.sync(state); // settle into the cell, or back to the tray
    } else if (hit && hit.kind === "piece") selectPiece(hit.pieceId);
    else if (hit && hit.kind === "cell") placeSelected(hit.cell);
    ui.setFocus(null);
  }
}

// ------------------------------------------------------------------ lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
let paletteKey = "";
/** Settings › colour-vision-safe palette rebuilds the tiles in the default palette (as a new round did). */
function applyPalette(): void {
  const k = paletteTheme();
  if (k === paletteKey) return;
  const had = paletteKey !== "";
  paletteKey = k;
  if (had && state) { render.buildPuzzle(state, k); syncMirror(); }
}

onStart(() => {
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  if (!resumeCheck()) showTitle();
});
platform.onOptionsChange(() => applyPalette());
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
onSessionEnded(() => toast(() => account().signedOut));
// A hidden window pauses an active round (app.js visibilitychange) and holds the sound.
onSuspend(() => {
  if (state && state.status === "active" && !app.screen) pause();
  saveSession();
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => audio.setSuspended(false));
onQuit(() => { saveSession(); platform.flush(); });

// The round clock (app.js _loop): elapsed time in quarter seconds, the time limit with its last-ten-seconds tick.
onFixedUpdate((dt) => {
  if (!state || state.status !== "active" || paused || app.screen) return;
  clockMs += dt * 1000;
  if (Math.floor(clockMs / 250) !== Math.floor(state.elapsedMs / 250)) state = Rules.applyCommand(state, { type: "elapsed", ms: Math.floor(clockMs) });
  if (round && round.ruleset.timeLimitSec) {
    const left = round.ruleset.timeLimitSec - clockMs / 1000;
    timeLeftSec = left;
    const sec = Math.ceil(left);
    if (sec <= 10 && sec !== lastTickSec && sec > 0) { audio.playEvent("tick"); lastTickSec = sec; }
    if (left <= 0) cmd({ type: "timeup" });
  }
  autoAdvanceLesson();
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyPalette();
  applyTheme(options.theme, ui.preferences().highContrast);
  audio.update();
  const t = now();
  app.toasts = app.toasts.filter((x) => x.until >= t);
  if (resultsAt !== null && t >= resultsAt) {
    resultsAt = null;
    openScreen("results", "btn-retry");
  }
});
onRender(() => {
  drawScreens();
  deskInput();
  render.update(frameDt);
});
