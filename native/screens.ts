// The browser build's DOM shell (index.html + style.css + ui.js) as
// starhermit:ui, built every frame around the 3D desk: the top bar (title,
// drawer toggles, save status, UTC clock, Help, Settings), the left rail
// (objective and progress), the right rail (Rotate / Hint / Undo / Pause with
// their keys, the tray pieces and the board cells — the accessible mirror of
// the desk, played by pointer, touch, Tab and the arrows), the HUD (mode,
// placed, time, score, the move or time limit), the always-visible goal
// thumbnail, the phone's bottom tray, the drawers, the toasts, and the
// screens over the key art (title, mode select, learn, journey, practice,
// challenge, setup, pause, results, help, settings, profile, leaderboards,
// welcome back). The browser's media queries are layouts picked by the
// window's logical size: desktop (≥ 1024 px: rails at the sides), compact (the
// rails become drawers below the top bar), portrait phone (≤ 700 px wide: the
// bottom tray) and landscape phone (≤ 500 px tall: a narrow right rail, no
// left rail). Left-handed swaps the rails' sides.
import { frame, openMenu } from "starhermit:engine";
import { requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Content, Rules, type Ruleset } from "./game.ts";
import { account, N, plain, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import { GLYPHS } from "./render.ts";
import {
  ACHIEVEMENTS, app, canUndo, candidates, closeScreen, confirmSetup, copyInvite, discardSaved, firstKey, fresh, keysFor,
  modeLabel, nextJourney, nextRecommended, objectiveText, openScreen, options, paletteTheme, pause, placeSelected, quitRound, resume,
  resumeSaved, retry, rotateSelected, round, selectPiece, setupInfo, showTitle, signIn, startDaily, startPending, state, timeLeftSec,
  hint, undo, paused, pointerActivation as pointerActivationNow, type Screen,
} from "./main.ts";

// ------------------------------------------------------------------ layout and helpers
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; desktop: boolean; portrait: boolean; landscape: boolean; narrow: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const landscape = lh <= 500 && lw > lh;
  const portrait = !landscape && lw <= 700 && lh >= lw;
  return { lw, lh, sc, ox: sa.left, oy: sa.top, desktop: lw >= 1024 && !landscape, portrait, landscape, narrow: lw <= 420 };
}
const lastSize = new Map<string, number>();
function tw(text: string, style: string | (string | ui.Style)[], kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style }).width / ui.preferences().scale;
}
let firstId: string | null = null;
/** A button `width` wide (null: its text's); a label too long for it wraps inside; `sub` adds a small second line. */
interface Btn { id: string; text: string; cls?: string; disabled?: boolean; act: () => void; sub?: string; aria?: string }
function button(b: Btn, width: number | null = null): boolean {
  const cls = b.cls ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  const inner = width != null ? Math.max(20, width - 30) : null;
  const wraps = inner != null && tw(b.text, cls, "button") > inner;
  const left = cls.startsWith("menu");
  if (b.sub || wraps || b.aria) {
    opts.content = () => {
      const align: ui.Style = { text: { align: left ? "start" : "center" } };
      if (wraps) ui.style("btn-text", align).paragraph(b.text, inner!);
      else ui.style("btn-text", align, cls === "btn-primary" || cls === "menu-primary" ? { text: { size: 18 } } : {}).label(b.text);
      if (b.sub) {
        if (inner != null && tw(b.sub, "small") > inner) ui.style("small", align).paragraph(b.sub, inner);
        else ui.style("small", align).label(b.sub);
      }
    };
  }
  if (!firstId && !b.disabled) firstId = b.id;
  const hit = ui.style(cls, width != null ? { width } : {}).id(b.id).button(b.aria ?? b.text, opts);
  if (hit && !fresh(0)) b.act();
  return hit;
}
/** Buttons at their own widths in rows that wrap at `width` (style.css .row: flex-wrap, gap .5rem). */
function flow(label: string, list: Btn[], width: number, gap = 8, align: ui.Align = "start"): void {
  const widths = list.map((b) => Math.min(width, tw(b.text, b.cls ?? "btn", "button") + 4));
  const rows = wrapRows(widths, width, gap);
  let k = 0;
  ui.column(label, () => {
    rows.forEach((n, ri) => ui.row(`${label}-r${ri}`, () => {
      for (let i = 0; i < n; i++, k++) button(list[k]!, widths[k]! >= width ? width : null);
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, align, width });
}
function wrapRows(widths: number[], max: number, gap: number): number[] {
  const rows: number[] = [];
  let used = 0, n = 0;
  for (const w of widths) {
    if (n && used + gap + w > max) { rows.push(n); used = 0; n = 0; }
    used += (n ? gap : 0) + w;
    n++;
  }
  if (n) rows.push(n);
  return rows;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "p", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (tw(text, cls) <= width) u.label(text);
  else u.paragraph(text, width);
}
function heading(cls: string, text: string, width: number): void {
  if (tw(text, cls, "heading") <= width) ui.style(cls).heading(text);
  else ui.style(cls).paragraph(text, width);
}
/** Shortens `text` with an ellipsis until it fits `width` (style.css text-overflow: ellipsis). */
function ellipsize(text: string, cls: string, width: number): string {
  if (tw(text, cls) <= width) return text;
  let s = text;
  while (s.length > 1 && tw(s + "…", cls) > width) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}
/** ui.js rulesetLabel: board size plus its twist. */
export function rulesetLabel(rs: Partial<Ruleset>): string {
  const size = `${rs.cols}×${rs.rows}`;
  const twist = rs.moveLimit ? T("move limit") : rs.timeLimitSec ? T("speed") : rs.needRotation ? T("rotate") : "";
  return twist ? `${size} ${twist}` : size;
}
export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  firstId = null;
  const s = app.screen;
  if (state && !s) {
    shell(L);
  } else {
    render.setPlayfield(0, 0, 0, 0);
    // style.css .screen: the key art under a scrim (pure black under high contrast).
    draw.box(0, 0, f.width, f.height, ui.preferences().highContrast ? "screen-plain" : "screen-bg");
    if (s) card(s, L);
  }
  toasts(L, !!s);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    const target = app.focusNext === "first" ? firstId : app.focusNext;
    if (age >= 1 && target) ui.setFocus(target);
    if (age >= 3) app.focusNext = null;
  }
}

const BUILDERS: Record<Screen, (w: number, L: Layout) => void> = {
  title: titleScreen, mode: modeScreen, learn: learnScreen, journey: journeyScreen, practice: practiceScreen, challenge: challengeScreen,
  setup: setupScreen, pause: pauseScreen, results: resultsScreen, help: helpScreen, settings: settingsScreen, profile: profileScreen,
  leaderboard: leaderboardScreen, resume: resumeScreen,
};
const LABELS: Record<Screen, string> = {
  title: N("Title"), mode: N("Mode select"), learn: N("Learn"), journey: N("Journey"), practice: N("Practice"), challenge: N("Challenge"),
  setup: N("Mode setup"), pause: N("Paused"), results: N("Results"), help: N("Help"), settings: N("Settings"), profile: N("Profile"),
  leaderboard: N("Leaderboards"), resume: N("Resume session"),
};
/** A screen (ui.js openScreen .screen-card): a card at most 560 px wide and 90 % tall, scrolling inside. */
function card(s: Screen, L: Layout): void {
  const outer = Math.min(560, L.lw - 32);
  const padX = L.lw < 420 ? 18 : 26, padY = L.lw < 420 ? 18 : 22;
  const top = app.toasts.length ? 64 : 16;
  const availH = Math.min(L.lh * 0.9, L.lh - top - 16);
  const innerH = availH - 2 * padY - 4;
  const natural = lastSize.get(s) ?? 0;
  const scroll = natural > innerH;
  const inner = outer - 2 * padX - 4 - (scroll ? 14 : 0);
  ui.place(`screen-${s}`, "center", () => {
    ui.id(`card-${s}`).column(T(LABELS[s]), () => {
      const body = (): void => {
        const r = ui.column(`${s}-body`, () => BUILDERS[s](inner, L), { width: inner, spacing: 10 });
        lastSize.set(s, r.height / L.sc);
      };
      if (scroll) ui.scrollArea(`${s}-scroll`, { width: inner + 14, height: innerH }, body, fresh(3) ? { scrollTo: { top: 0 } } : undefined);
      else body();
    }, { style: "card", width: outer, padding: { top: padY, bottom: padY, start: padX, end: padX } });
  });
}
/** Back / close actions: ui.js data-action="close-screen" (back to the pause sheet in a paused round, the round, or the title). */
function closeAction(): void {
  closeScreen();
  if (paused) openScreen("pause", "btn-resume");
  else if (!state) showTitle();
}

// ------------------------------------------------------------------ title and modes
function titleScreen(w: number): void {
  heading("h2", "Mosaic Pieces", w);
  para(T("Assemble interlocking pieces into a picture on the gallery desk — snapping, trays, rotation and optional hints."), w);
  const p = platform.progress;
  const pct = Math.round(100 * p.journeyCompleted / Content.JOURNEY.length);
  ui.column("title-menu", () => {
    button({ id: "btn-play", text: T("Play"), cls: "menu-primary", act: () => openScreen("mode") }, w);
    button({ id: "btn-daily", text: T("Daily challenge"), sub: T("One shared mosaic per UTC day — ranked."), cls: "menu-btn", act: startDaily }, w);
    button({ id: "btn-journey", text: T("Journey"), sub: T("{done}/{total} stages ({pct}%) — next: stage {next}.", { done: p.journeyCompleted, total: Content.JOURNEY.length, pct, next: nextJourney() }), cls: "menu-btn", act: () => openScreen("journey") }, w);
    button({ id: "btn-profile", text: T("Profile & achievements"), sub: T("{n}/{total} achievements unlocked.", { n: p.achievements.length, total: ACHIEVEMENTS.length }), cls: "menu-btn", act: () => openScreen("profile", "btn-back") }, w);
    button({ id: "btn-leaderboard", text: T("Leaderboards"), cls: "menu-btn", act: openLeaderboard }, w);
    button({ id: "btn-settings", text: T("Settings"), sub: T("Audio, graphics and accessibility."), cls: "menu-btn", act: () => openScreen("settings", "btn-done") }, w);
    if (!platform.signedIn()) button({ id: "btn-sign-in", text: account().signIn, sub: account().signInSub, cls: "menu-btn", act: signIn }, w);
    if (platform.inviteLink()) button({ id: "btn-invite", text: account().invite, sub: account().inviteSub, cls: "menu-btn", act: copyInvite }, w);
  }, { spacing: 8, width: w });
}
function backRow(w: number, to: () => void, id = "btn-back", text = T("Back")): void {
  flow(`${id}-row`, [{ id, text, cls: "btn-ghost", act: to }], w);
}
function modeScreen(w: number): void {
  heading("h2", T("Choose a mode"), w);
  ui.column("mode-menu", () => {
    button({ id: "btn-learn", text: T("Learn"), sub: T("Interactive lessons — one rule at a time. ~3 min."), cls: "menu-btn", act: () => openScreen("learn") }, w);
    button({ id: "btn-mode-journey", text: T("Journey"), sub: T("40 authored stages with growing mechanics. Ranked progression."), cls: "menu-btn", act: () => openScreen("journey") }, w);
    button({ id: "btn-mode-daily", text: T("Daily"), sub: T("Shared seed per UTC day. Ranked, no undo."), cls: "menu-btn", act: startDaily }, w);
    button({ id: "btn-practice", text: T("Practice"), sub: T("Your difficulty, restart and undo, never ranked."), cls: "menu-btn", act: () => openScreen("practice") }, w);
    button({ id: "btn-challenge", text: T("Challenge"), sub: T("Move limits, speed targets, altered layouts."), cls: "menu-btn", act: () => openScreen("challenge") }, w);
    button({ id: "btn-chase", text: T("Score chase"), sub: T("Global and friends score comparison."), cls: "menu-btn", act: openLeaderboard }, w);
  }, { spacing: 8, width: w });
  backRow(w, showTitle);
}
function learnScreen(w: number): void {
  heading("h2", T("Learn"), w);
  para(T("Each lesson introduces one rule and asks you to perform it."), w);
  ui.column("learn-menu", () => {
    Content.LESSONS.forEach((l, i) => button({ id: `btn-lesson-${i}`, text: T(l.title), sub: rulesetLabel(l.ruleset), cls: "menu-btn", act: () => confirmSetup({ mode: "lesson", lesson: l }) }, w));
  }, { spacing: 8, width: w });
  backRow(w, () => openScreen("mode"));
}
function journeyScreen(w: number, L: Layout): void {
  heading("h2", T("Journey"), w);
  const p = platform.progress;
  para(T("{done}/{total} complete. ★ marks mastery stages.", { done: p.journeyCompleted, total: Content.JOURNEY.length }), w);
  const next = nextJourney();
  const listH = Math.max(160, Math.min(L.lh * 0.5, Content.JOURNEY.length * 62));
  ui.scrollArea("journey-list", { width: w, height: listH }, () => ui.column("journey-col", () => {
    for (const s of Content.JOURNEY) {
      const done = p.journeyCompleted >= s.index;
      const unlocked = s.index <= next;
      const sub = [rulesetLabel(s.ruleset), s.mastery ? T("mastery") : "", unlocked ? "" : T("locked")].filter(Boolean).join(" — ");
      button({
        id: `btn-stage-${s.index}`, text: `${done ? "✓ " : ""}${T("Stage {n}", { n: s.index })}${s.mastery ? " ★" : ""}`, sub, cls: "menu-btn",
        disabled: !unlocked, act: () => confirmSetup({ mode: "journey", stage: s }),
      }, w - 14);
    }
  }, { spacing: 8, width: w - 14 }), fresh(3) ? { scrollTo: { top: Math.max(0, (next - 3) * 62 * L.sc) } } : undefined);
  backRow(w, () => openScreen("mode"));
}
function practiceScreen(w: number): void {
  heading("h2", T("Practice"), w);
  para(T("Relaxed play: restart and undo allowed, never ranked."), w);
  ui.column("practice-menu", () => {
    for (const p of Content.PRACTICE) button({ id: `btn-practice-${p.id}`, text: T(p.label), cls: "menu-btn", act: () => confirmSetup({ mode: "practice", preset: p }) }, w);
  }, { spacing: 8, width: w });
  backRow(w, () => openScreen("mode"));
}
function challengeScreen(w: number): void {
  heading("h2", T("Challenge"), w);
  ui.column("challenge-menu", () => {
    for (const c of Content.CHALLENGES) button({ id: `btn-${c.id}`, text: T(c.label), sub: T(c.desc), cls: "menu-btn", act: () => confirmSetup({ mode: "challenge", challenge: c }) }, w);
  }, { spacing: 8, width: w });
  backRow(w, () => openScreen("mode"));
}
/** A table row (style.css table.score): the key at the start, the value at the end. */
function scoreRow(id: string, k: string, v: string, w: number, strong = false): void {
  const vw = tw(v, strong ? "score-k" : "score-v") + 4;
  ui.row(id, () => {
    para(k, w - vw - 28, "score-k");
    ui.spacer();
    ui.style(strong ? "score-k" : "score-v").id(`${id}-v`).label(v);
  }, { width: w, style: "score-row", align: "center" });
}
function setupScreen(w: number): void {
  const kind = app.pendingKind;
  if (!kind) return;
  const info = setupInfo(kind);
  heading("h2", info.title, w);
  para(info.desc, w);
  const rs = info.ruleset;
  ui.column("setup-table", () => {
    scoreRow("setup-board", T("Board"), `${rs.cols}×${rs.rows}`, w);
    scoreRow("setup-rotation", T("Rotation"), rs.needRotation ? T("Yes") : T("No"), w);
    scoreRow("setup-moves", T("Move limit"), rs.moveLimit ? String(rs.moveLimit) : T("None"), w);
    scoreRow("setup-time", T("Time limit"), rs.timeLimitSec ? T("{n} s", { n: rs.timeLimitSec }) : T("None"), w);
    scoreRow("setup-undo", T("Undo"), info.undo ? T("Allowed") : T("Not allowed"), w);
    scoreRow("setup-hints", T("Hints"), T("Available (cost score)"), w);
    scoreRow("setup-ranked", T("Ranked"), info.ranked ? (info.rankedLabel ?? T("Yes")) : T("No"), w);
    scoreRow("setup-duration", T("Expected duration"), info.duration, w);
  }, { width: w, spacing: 0 });
  flow("setup-actions", [
    { id: "btn-start", text: T("Start"), cls: "btn-primary", act: startPending },
    { id: "btn-setup-back", text: T("Back"), cls: "btn-ghost", act: () => openScreen("mode") },
  ], w);
}

// ------------------------------------------------------------------ pause, results, resume
function pauseScreen(w: number): void {
  heading("h2", T("Paused"), w);
  flow("pause-resume", [{ id: "btn-resume", text: T("Resume"), cls: "btn-primary", act: resume }], w);
  heading("h3", T("Audio"), w);
  para(T("Volumes and mute are in the StarHermit Options."), w, "muted");
  flow("pause-actions", [
    { id: "btn-pause-audio", text: T("Audio & graphics"), act: () => openMenu() },
    { id: "btn-pause-settings", text: T("Settings & accessibility"), act: () => openScreen("settings", "btn-done") },
    { id: "btn-pause-help", text: T("Help"), act: () => openScreen("help", "btn-close") },
    { id: "btn-leave", text: T("Leave round"), cls: "btn-ghost", act: quitRound },
  ], w);
}
function resultsScreen(w: number): void {
  const st = app.resultState;
  if (!st) return;
  const c = Rules.scoreComponents(st);
  const win = st.status === "complete";
  const reasons: Record<string, string> = { "time-limit": N("time ran out"), "move-limit": N("out of moves"), abandoned: N("abandoned") };
  const reason = st.terminalReason || "abandoned";
  heading("h2", win ? T("Mosaic complete!") : T("Round over"), w);
  para(win ? T("The picture hangs on the gallery wall.") : T("Reason: {reason}", { reason: reasons[reason] ? T(reasons[reason]!) : reason }), w, "p", "results-reason");
  const sign = (v: number): string => `${v > 0 ? "+" : ""}${v}`;
  ui.column("results-table", () => {
    scoreRow("res-placement", T("Pieces placed"), sign(c.placement), w);
    scoreRow("res-completion", T("Completion bonus"), sign(c.completion), w);
    scoreRow("res-efficiency", T("Efficiency bonus"), sign(c.efficiency), w);
    scoreRow("res-hints", T("Hints used"), sign(-c.hintCost), w);
    scoreRow("res-undos", T("Undos used"), sign(-c.undoCost), w);
    scoreRow("res-invalid", T("Invalid actions"), sign(-c.invalidPenalty), w);
    scoreRow("res-total", T("Total score"), String(c.total), w, true);
    scoreRow("res-time", T("Time"), formatTime(st.elapsedMs), w);
    scoreRow("res-moves", T("Moves"), String(st.moves), w);
    scoreRow("res-match", T("Tiles matching the goal image"), `${st.pieces.filter((p) => p.placed && p.placedCell === p.id).length}/${st.pieces.length}`, w);
  }, { width: w, spacing: 0 });
  const note = app.resultNote?.();
  if (note) para(note, w, "p", "results-note");
  const lb = app.lbText?.();
  if (lb) para(lb, w, "p", "results-lb");
  const list: Btn[] = [{ id: "btn-retry", text: T("Play again"), cls: "btn-primary", act: retry }];
  if (win) list.push({ id: "btn-next", text: T("Next recommended"), act: nextRecommended });
  list.push({ id: "btn-results-title", text: T("Title"), cls: "btn-ghost", act: showTitle });
  flow("results-actions", list, w);
}
function resumeScreen(w: number): void {
  const r = app.resumable;
  heading("h2", T("Welcome back"), w);
  if (r) {
    const st = r.state;
    para(T("While you were away your round was paused. You had placed {n}/{total} pieces in {time}.",
      { n: st.pieces.filter((p) => p.placed).length, total: st.pieces.length, time: formatTime(st.elapsedMs) }), w);
  }
  flow("resume-actions", [
    { id: "btn-resume-saved", text: T("Resume round"), cls: "btn-primary", act: resumeSaved },
    { id: "btn-discard-saved", text: T("Start fresh"), cls: "btn-ghost", act: discardSaved },
  ], w);
}

// ------------------------------------------------------------------ help, settings, profile, leaderboards
function helpScreen(w: number): void {
  heading("h2", T("How to play"), w);
  para(T("Sort the tray pieces, read the edge colors and glyphs, and drag each piece onto its matching board cell. Pieces snap when legal. Complete connected groups to finish the picture."), w);
  heading("h3", T("Controls"), w);
  const k = keysFor;
  const picks = Array.from({ length: 9 }, (_, i) => firstKey("pick" + (i + 1))).join(", ");
  const keys = T("Tab reaches the tray and board lists, {arrows} move within them, Enter selects a piece or places it, {rotate} rotates, {hint} hints, {undo} undoes, {pause} pauses, {camera} resets the camera. {picks} pick the 1st–9th tray piece.", {
    arrows: [k("left"), k("right"), k("up"), k("down")].join("/"), rotate: k("rotate"), hint: k("hint"), undo: k("undo"), pause: k("pause"), camera: k("camera"), picks,
  });
  para("• " + plain(T("<strong>Pointer / touch:</strong> tap a piece to select, tap a glowing cell to place. Drag pieces directly. Double-tap a piece to rotate.")), w);
  para("• " + plain(T("<strong>Keyboard:</strong> {keys}", { keys })), w);
  para("• " + T("With nothing focused, the arrows move a cursor over the board and {place} places the selected piece there (or picks the next tray piece).", { place: k("place") }), w);
  para("• " + T("Every action gives immediate visual and sonic feedback; illegal targets explain why."), w);
  heading("h3", T("Scoring"), w);
  para(T("+100 per placed piece, completion and efficiency bonuses; hints, undos and invalid actions cost points. Time is tracked separately so relaxed play stays valid."), w);
  flow("help-actions", [{ id: "btn-close", text: T("Close"), cls: "btn-primary", act: closeAction }], w);
}
const THEME_IDS = Content.THEMES.map((t) => t.id);
function settingsScreen(w: number): void {
  heading("h2", T("Settings"), w);
  para(T("Sound, graphics, language, reduced motion, high contrast and larger text are in the StarHermit Options."), w, "muted");
  flow("settings-options", [
    { id: "btn-options", text: T("Audio, graphics & language"), act: () => openMenu() },
    { id: "btn-rebind", text: T("Keyboard bindings"), act: () => requestRebind() },
  ], w);
  heading("h3", T("Theme"), w);
  const idx = Math.max(0, THEME_IDS.indexOf(options.theme));
  const sw = Math.min(220, w * 0.55);
  ui.row("theme-row", () => {
    para(T("Theme"), w - sw - 12, "p");
    ui.spacer();
    const pick = ui.style({ width: sw }).id("set-theme").select(T("Theme"), idx, Content.THEMES.map((t) => T(t.label)));
    if (pick !== idx) platform.setOption("theme", THEME_IDS[pick]!);
  }, { width: w, align: "center" });
  heading("h3", T("Accessibility"), w);
  const checks: [keyof typeof options, string][] = [
    ["cvdPalette", N("Color-vision-safe palette")], ["leftHanded", N("Left-handed layout")], ["timingAssist", N("Timing assistance (double time limits)")],
  ];
  ui.column("set-checks", () => {
    for (const [key, label] of checks) {
      const cur = !!options[key];
      const next = ui.id(`set-${key}`).checkbox(T(label), cur);
      if (next !== cur) platform.setOption(key, next as never);
    }
  }, { spacing: 2, width: w });
  flow("settings-actions", [
    { id: "btn-replay-tutorial", text: T("Replay tutorial"), act: () => confirmSetup({ mode: "lesson", lesson: Content.LESSONS[0]! }) },
    { id: "btn-done", text: T("Done"), cls: "btn-primary", act: closeAction },
  ], w);
}
function profileScreen(w: number): void {
  const p = platform.progress;
  heading("h2", T("Profile"), w);
  const name = platform.signedIn() ? platform.displayName(T("Player")) : (p.displayName === "Guest" ? T("Guest") : p.displayName);
  para(plain(platform.signedIn()
    ? T("Signed in as <strong>{name}</strong> — progress syncs to your account (status sits next to the clock).", { name })
    : T("Playing as <strong>{name}</strong> (local guest profile; sign-in is offered by the host shell).", { name })), w, "p", "profile-who");
  heading("h3", T("Achievements"), w);
  ui.column("achievements", () => {
    for (const a of ACHIEVEMENTS) {
      const got = p.achievements.includes(a.key);
      button({ id: `ach-${a.key}`, text: (got ? "🏆 " : "🔒 ") + T(a.label), sub: T(a.desc), cls: "menu-btn", disabled: true, act: () => undefined }, w);
    }
  }, { spacing: 8, width: w });
  para(T("Total gallery time: {time}", { time: formatTime(p.totalTimeMs || 0) }), w, "p", "profile-time");
  backRow(w, showTitle);
}
interface Board { name: string; rows: platform.BoardRow[] }
const lb = { board: null as Board | null, state: "idle" as "idle" | "loading" | "done" | "none", token: 0 };
export function openLeaderboard(): void {
  lb.board = null;
  lb.state = "loading";
  const token = ++lb.token;
  platform.boardEntries(20).then((b) => {
    if (token !== lb.token) return;
    lb.board = b;
    lb.state = b ? "done" : "none";
  }, () => { if (token === lb.token) lb.state = "none"; });
  openScreen("leaderboard", "btn-back");
}
function leaderboardScreen(w: number): void {
  heading("h2", T("Score chase"), w);
  // Platform leaderboards are script-owned: read-only, guests read them too.
  if (lb.state === "loading") para(T("Loading…"), w, "p", "lb-loading");
  else if (lb.state === "done" && lb.board) {
    heading("h3", lb.board.name || T("Platform board"), w);
    if (!lb.board.rows.length) para(T("No entries yet — be the first."), w);
    ui.column("lb-list", () => {
      lb.board!.rows.forEach((e, i) => ui.row(`lb-${i}`, () => {
        const cls = e.me ? "lb-me" : "lb-text";
        para(`${e.rank != null ? e.rank + ". " : ""}${e.name || T("Player")}`, w - 90, cls);
        ui.spacer();
        ui.style(cls).label(String(e.score));
      }, { width: w, style: "lb-row", align: "center" }));
    }, { width: w, spacing: 0 });
    const mine = lb.board.rows.find((r) => r.me);
    if (mine) para(T("Your platform best: {n}.", { n: mine.score }), w);
  } else para(T("No platform leaderboard for this game — showing personal bests only."), w);
  heading("h3", T("Personal bests"), w);
  const b = platform.progress.best;
  if (!b.daily && !b.chase) para(T("No personal bests yet."), w);
  if (b.daily) scoreRow("best-daily", T("Daily best ({date})", { date: b.daily.date || platform.utcToday() }), `${b.daily.score} · ${formatTime(b.daily.elapsedMs)}`, w);
  if (b.chase) scoreRow("best-chase", T("Chase best"), `${b.chase.score} · ${formatTime(b.chase.elapsedMs)}`, w);
  backRow(w, showTitle);
}

// ------------------------------------------------------------------ the round's shell
const SYNC: Record<string, [string, string]> = {
  synced: [N("cloud synced"), "sync"], saving: [N("saving…"), "sync-saving"], offline: [N("offline — local copy"), "sync-offline"], local: [N("local save"), "sync"],
};
function utcClock(): string { return new Date(platform.nowMs()).toISOString().slice(11, 19) + " UTC"; }

function shell(L: Layout): void {
  const f = frame();
  const tbH = L.landscape ? 54 : 62;
  const trayH = L.portrait ? 62 : 0;
  const lefty = options.leftHanded;
  const leftW = L.desktop ? 260 : 0;
  const rightW = L.desktop ? 300 : L.landscape ? 200 : 0;
  const [startW, endW] = lefty ? [rightW, leftW] : [leftW, rightW];
  const pf = { x: startW, y: tbH, w: Math.max(1, L.lw - startW - endW), h: Math.max(1, L.lh - tbH - trayH) };
  const sc = L.sc, wx = L.ox + pf.x * sc, wy = L.oy + pf.y * sc, ww = pf.w * sc, wh = pf.h * sc;
  render.setPlayfield(wx, wy, ww, wh);
  ui.target(T("Playfield"), { x: wx, y: wy, width: ww, height: wh }, { role: "label" });
  // The window outside the safe area and under the chrome: the page colour.
  draw.box(0, 0, f.width, wy, "page");
  draw.box(0, wy + wh, f.width, f.height - wy - wh, "page");
  draw.box(0, wy, wx, wh, "page");
  draw.box(wx + ww, wy, f.width - wx - ww, wh, "page");
  goalThumb(L, pf);

  topbar(L, tbH);
  if (L.desktop) {
    railBox("rail-left", lefty ? "top-end" : "top-start", tbH, leftW, pf.h, L, leftRail, T("Objective and progression"));
    railBox("rail-right", lefty ? "top-start" : "top-end", tbH, rightW, pf.h, L, rightRail, T("Actions, pieces and board"));
  } else if (L.landscape) {
    railBox("rail-right", lefty ? "top-start" : "top-end", tbH, rightW, pf.h, L, rightRail, T("Actions, pieces and board"));
  }
  hud(L, pf);
  if (L.portrait) bottomTray(L, trayH);
  if (!L.desktop && app.drawer) drawer(L, tbH);
}

function topbar(L: Layout, h: number): void {
  const compact = !L.desktop;
  const ghost = (id: string, glyph: string, aria: string, act: () => void): Btn => ({ id, text: glyph, aria, cls: "btn-ghost", act });
  const items: Btn[] = [];
  if (compact) {
    items.push(ghost("btn-drawer-left", "☰", T("Toggle objective panel"), () => { app.drawer = app.drawer === "left" ? null : "left"; }));
    if (!L.landscape) items.push(ghost("btn-drawer-right", "✚", T("Toggle actions panel"), () => { app.drawer = app.drawer === "right" ? null : "right"; }));
  }
  const help = ghost("btn-help", "?", T("Help and rules"), () => openScreen("help", "btn-close"));
  const settings = ghost("btn-top-settings", "⚙", T("Settings"), () => openScreen("settings", "btn-done"));
  const [syncKey, syncCls] = SYNC[platform.syncState()] ?? SYNC.local!;
  const syncText = T(syncKey);
  const clock = L.narrow ? "" : utcClock();
  const gap = L.narrow ? 4 : 8;
  const bw = (b: Btn): number => Math.max(44, tw(b.text, "btn-ghost", "button") + 4) + gap;
  const rightW = [...items, help, settings].reduce((a, b) => a + bw(b), 0) + tw(syncText, syncCls) + gap + (clock ? tw(clock, "clock") + gap : 0);
  const titleW = Math.max(40, L.lw - 24 - rightW - 12);
  const titleCls = L.landscape || L.portrait ? "p" : "title-text";
  ui.place("topbar", { anchor: "top-start", x: 0, y: 0 }, () => ui.id("topbar-row").row("Mosaic Pieces", () => {
    ui.style(titleCls, { text: { weight: "600" } }).label(ellipsize("Mosaic Pieces", titleCls, titleW));
    ui.spacer();
    ui.row("top-right", () => {
      for (const b of items) chromeButton(b);
      ui.style(syncCls).id("sync-status").label(syncText, { tooltip: T("Save sync status") });
      if (clock) ui.style("clock").id("clock").label(clock, { tooltip: T("Platform time") });
      chromeButton(help);
      chromeButton(settings);
    }, { spacing: gap, align: "center" });
  }, { style: "topbar", width: L.lw, height: h, align: "center" }));
}
/** A chrome button (top bar, rails, tray): acts, then hands the keys back to the board after a click or tap. */
function chromeButton(b: Btn, width: number | null = null, kbd?: string): void {
  const cls = b.cls ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.aria || kbd) {
    opts.content = () => ui.row(`${b.id}-face`, () => {
      ui.style("btn-text", cls === "btn-ghost" ? { text: { size: 18 } } : {}).label(b.text);
      if (kbd) ui.style("kbd").label(kbd);
    }, { spacing: 6, align: "center" });
  }
  const hit = ui.style(cls, width != null ? { width } : {}).id(b.id).button(b.aria ?? b.text, opts);
  if (hit && !fresh(0)) { b.act(); if (pointerActivationNow()) ui.setFocus(null); }
}

function railBox(key: string, anchor: "top-start" | "top-end", y: number, w: number, h: number, L: Layout, build: (w: number, L: Layout) => void, label: string): void {
  const natural = lastSize.get(key) ?? 0;
  const pad = 14;
  const scroll = natural > h - 24;
  const inner = w - 2 * pad - (scroll ? 14 : 0);
  ui.place(key, { anchor, x: 0, y }, () => ui.id(`${key}-box`).column(label, () => {
    const body = (): void => {
      const r = ui.column(`${key}-col`, () => build(inner, L), { width: inner, spacing: 6 });
      lastSize.set(key, r.height / L.sc);
    };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 14, height: h - 24 }, body);
    else body();
  }, { style: "rail", width: w, height: h, padding: { top: 12, bottom: 12, start: pad, end: pad } }));
}
function leftRail(w: number): void {
  heading("rail-h", T("Objective").toUpperCase(), w);
  para(objectiveText(), w, "rail-p", "objective-text");
  if (state) {
    const c = Rules.scoreComponents(state);
    para(T("Score {score} · Moves {moves} · Hints {hints}", { score: c.total, moves: state.moves, hints: state.hintsUsed }), w, "rail-p", "progress-text");
  }
}
function rightRail(w: number, L: Layout): void {
  if (!state) return;
  const st = state;
  const live = st.status === "active" && !paused;
  heading("rail-h", T("Actions").toUpperCase(), w);
  const bw = (w - 6) / 2;
  const kb = !L.landscape;
  ui.grid("action-grid", () => {
    chromeButton({ id: "btn-rotate", text: T("Rotate"), disabled: !live || st.selected == null, act: rotateSelected }, bw, kb ? firstKey("rotate") : undefined);
    chromeButton({ id: "btn-hint", text: T("Hint"), disabled: !live, act: hint }, bw, kb ? firstKey("hint") : undefined);
    chromeButton({ id: "btn-undo", text: T("Undo"), disabled: !canUndo(), act: undo }, bw, kb ? firstKey("undo") : undefined);
    chromeButton({ id: "btn-pause", text: T("Pause"), act: pause }, bw, kb ? firstKey("pause") : undefined);
  }, { columns: 2, gap: 6, width: w });
  heading("rail-h", T("Tray pieces").toUpperCase(), w);
  trayPieces(w);
  heading("rail-h", T("Board cells").toUpperCase(), w);
  boardCells(w);
}
/** The tray mirror (ui.js mirrorBoard #piece-list): a button per piece in tray order, its colour and glyph. */
function trayPieces(w: number): void {
  const st = state!;
  const palette = Rules.PALETTES[paletteTheme()] ?? Rules.PALETTES.default!;
  const size = 44, gap = 6;
  const cols = Math.max(1, Math.floor((w + gap) / (size + gap)));
  ui.id("piece-list").grid(T("Pieces in tray"), () => {
    for (const id of st.tray) {
      const p = st.pieces.find((x) => x.id === id)!;
      const glyph = GLYPHS[p.colorIndex % GLYPHS.length]!;
      const stateTxt = p.placed ? T("placed") : p.rot ? T("rotated {deg} degrees", { deg: p.rot * 90 }) : T("upright");
      const sel = !p.placed && st.selected === id;
      const label = [T("Piece {n}, {glyph} tile", { n: id + 1, glyph }), stateTxt, sel ? T("selected") : ""].filter(Boolean).join(", ");
      const hit = ui.style("piece", { width: size, height: size, background: palette[p.colorIndex % palette.length]! }).id(`piece-${id + 1}`).button(label, {
        disabled: p.placed, selected: sel, content: () => ui.style("piece-glyph", { text: { align: "center" } }).label(glyph),
      });
      if (hit && !fresh(0)) { selectPiece(id); if (pointerActivationNow()) ui.setFocus(null); }
    }
  }, { columns: cols, gap, width: cols * size + (cols - 1) * gap });
}
/** The board mirror (ui.js mirrorBoard #cell-grid): a button per cell with its goal glyph, filled cells marked. */
function boardCells(w: number): void {
  const st = state!;
  const rs = st.ruleset;
  const n = rs.cols * rs.rows;
  const gap = 4;
  const cw = Math.max(30, (w - gap * (rs.cols - 1)) / rs.cols);
  const cand = candidates();
  ui.id("cell-grid").grid(T("Board cells"), () => {
    for (let c = 0; c < n; c++) {
      const filledBy = st.occupied[c];
      const filled = filledBy !== undefined;
      const x = c % rs.cols + 1, y = Math.floor(c / rs.cols) + 1;
      const goal = st.pieces.find((p) => p.id === c);
      const goalGlyph = goal ? GLYPHS[goal.colorIndex % GLYPHS.length]! : "·";
      const here = filled ? st.pieces.find((p) => p.id === filledBy) ?? null : null;
      const matches = here ? here.id === c : false;
      const text = here ? (matches ? GLYPHS[here.colorIndex % GLYPHS.length]! : GLYPHS[here.colorIndex % GLYPHS.length]! + "≠") : goalGlyph;
      const isCand = !filled && cand.includes(c);
      const label = [T("Cell column {x} row {y}, goal {glyph} tile", { x, y, glyph: goalGlyph }),
        here ? T("holds piece {n}", { n: here.id + 1 }) : "", here ? (matches ? T("matches the goal") : T("does not match the goal")) : "",
        isCand ? T("legal target") : ""].filter(Boolean).join(", ");
      const cls = filled ? "cell-filled" : app.cursor === c ? "cell-cursor" : isCand ? "cell-cand" : "cell";
      const tcls = filled ? "cell-filled-text" : isCand ? "cell-cand-text" : "cell-text";
      const hit = ui.style(cls, { width: cw }).id(`cell-${c + 1}`).button(label, {
        disabled: filled, content: () => ui.style(tcls, { text: { align: "center" } }).label(text),
      });
      if (hit && !fresh(0)) { placeSelected(c); if (pointerActivationNow()) ui.setFocus(null); }
    }
  }, { columns: rs.cols, gap, width: cw * rs.cols + gap * (rs.cols - 1) });
}

/** The HUD (index.html #hud) at the playfield's top start, wrapping as flex-wrap did. */
function hud(L: Layout, pf: { x: number; y: number; w: number; h: number }): void {
  const st = state!;
  const items: [string, string, string][] = [
    ["hud-mode", modeLabel(), "hud-text"],
    ["hud-placed", T("{n}/{total} placed", { n: st.pieces.filter((p) => p.placed).length, total: st.pieces.length }), "hud-text"],
    ["hud-time", formatTime(st.elapsedMs), "hud-text"],
    ["hud-score", T("Score {n}", { n: Rules.scoreComponents(st).total }), "hud-text"],
  ];
  if (st.ruleset.moveLimit > 0) {
    const left = st.ruleset.moveLimit - st.moves;
    items.push(["hud-limit", T("{n} moves left", { n: left }), left <= 3 ? "hud-warn" : "hud-text"]);
  } else if (timeLeftSec != null) {
    items.push(["hud-limit", T("{n}s left", { n: Math.max(0, Math.ceil(timeLeftSec)) }), timeLeftSec <= 30 ? "hud-warn" : "hud-text"]);
  }
  const gap = L.portrait ? 8 : 14;
  const thumbW = L.lw <= 700 ? 0 : 96 + 24; // phones: the thumbnail sits below the HUD
  const maxW = Math.max(120, pf.w - 24 - thumbW - 26);
  const widths = items.map(([, t, c]) => Math.min(maxW, tw(t, c)));
  const rows = wrapRows(widths, maxW, gap);
  let k = 0;
  ui.place("hud", { anchor: "top-start", x: pf.x + 12, y: pf.y + 8 }, () => ui.id("hud-box").column(T("Game status"), () => {
    rows.forEach((n, ri) => ui.row(`hud-r${ri}`, () => {
      for (let i = 0; i < n; i++, k++) { const [id, t, c] = items[k]!; ui.style(c).id(id).label(ellipsize(t, c, maxW)); }
    }, { spacing: gap, align: "center" }));
  }, { style: "hud", spacing: 2 }));
  if (round?.mode === "lesson") hudLesson(L, pf);
}
/** The lesson's current step under the HUD on layouts whose objective rail is a closed drawer. */
function hudLesson(L: Layout, pf: { x: number; y: number; w: number; h: number }): void {
  if (L.desktop) return;
  const text = objectiveText();
  const w = Math.min(pf.w - 24, 420);
  const hudH = (lastSize.get("hud") ?? 34);
  ui.place("lesson-step", { anchor: "top-start", x: pf.x + 12, y: pf.y + 16 + hudH + (L.lw <= 700 ? 58 : 0) }, () =>
    ui.column("lesson-col", () => para(text, w - 26, "hud-text", "lesson-text"), { style: "hud", width: w }));
}
/** The always-visible goal thumbnail (index.html #goal-thumb): the wall picture may be out of frame. */
function goalThumb(L: Layout, pf: { x: number; y: number; w: number; h: number }): void {
  if (!render.goalReady) return;
  const phone = L.lw <= 700;
  const w = phone ? 72 : 96, h = phone ? 50 : 66;
  const x = pf.x + pf.w - 12 - w, y = pf.y + (phone ? 51 : 8);
  const sc = L.sc;
  const wx = L.ox + x * sc, wy = L.oy + y * sc;
  draw.box(wx, wy, w * sc, h * sc, "goal");
  const b = 2 * sc;
  draw.image(render.goalCanvas, wx + b, wy + b, w * sc - 2 * b, h * sc - 2 * b);
  ui.target(T("Goal image"), { x: wx, y: wy, width: w * sc, height: h * sc }, { role: "label" });
}
/** The portrait phone's bottom tray (index.html nav.bottom-tray). */
function bottomTray(L: Layout, h: number): void {
  const st = state!;
  const live = st.status === "active" && !paused;
  const gap = 8;
  const bw = (L.lw - 16 - 3 * gap) / 4;
  ui.place("bottom-tray", { anchor: "bottom-start", x: 0, y: 0 }, () => ui.id("tray-row").row(T("Quick actions"), () => {
    chromeButton({ id: "btn-tray-rotate", text: T("Rotate"), disabled: !live || st.selected == null, act: rotateSelected }, bw);
    chromeButton({ id: "btn-tray-hint", text: T("Hint"), disabled: !live, act: hint }, bw);
    chromeButton({ id: "btn-tray-undo", text: T("Undo"), disabled: !canUndo(), act: undo }, bw);
    chromeButton({ id: "btn-tray-pause", text: T("Pause"), act: pause }, bw);
  }, { style: "bottom-tray", width: L.lw, height: h, spacing: gap, align: "center" }));
}
/** Compact layouts: a rail slides in below the top bar with its own close button; a tap on the scrim closes it. */
function drawer(L: Layout, tbH: number): void {
  const side = app.drawer!;
  const w = Math.min(320, L.lw * 0.85);
  const onStart = (side === "left") !== options.leftHanded;
  ui.place("drawer-scrim", { anchor: onStart ? "top-end" : "top-start", x: 0, y: tbH }, () => ui.column("scrim-box", () => {
    const r = ui.widget(T("Close panel"), { role: "button", size: { width: Math.max(1, L.lw - w), height: L.lh - tbH } });
    if (r.activated && !fresh(0)) app.drawer = null;
  }, { style: "scrim", spacing: 0 }));
  const key = `drawer-${side}`;
  const h = L.lh - tbH;
  const natural = lastSize.get(key) ?? 0;
  const scroll = natural > h - 24;
  const inner = w - 28 - (scroll ? 14 : 0);
  ui.place(key, { anchor: onStart ? "top-start" : "top-end", x: 0, y: tbH }, () => ui.id(`${key}-box`).column(side === "left" ? T("Objective and progression") : T("Actions, pieces and board"), () => {
    const body = (): void => {
      const r = ui.column(`${key}-col`, () => {
        ui.row(`${key}-head`, () => {
          ui.spacer();
          chromeButton({ id: "btn-drawer-close", text: "✕", aria: T("Close panel"), cls: "btn-ghost", act: () => { app.drawer = null; } });
        }, { width: inner });
        if (side === "left") leftRail(inner);
        else rightRail(inner, L);
      }, { width: inner, spacing: 6 });
      lastSize.set(key, r.height / L.sc);
    };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 14, height: h - 24 }, body);
    else body();
  }, { style: "drawer", width: w, height: h, padding: { top: 12, bottom: 12, start: 14, end: 14 } }));
}
/** Toasts stack bottom centre in play; while a screen is open they move to the top edge (the card leaves room). */
function toasts(L: Layout, screenOpen: boolean): void {
  if (!app.toasts.length) return;
  const w = Math.min(L.lw - 24, 460);
  ui.place("toasts", screenOpen ? { anchor: "top", y: 8 } : { anchor: "bottom", y: L.portrait && state ? 78 : 16 }, () => ui.column("toast-col", () => {
    app.toasts.forEach((t, i) => ui.column(`toast-${i}`, () => para(t.text(), w - 40, "p", `toast-text-${i}`), { style: "toast" }));
  }, { spacing: 6, align: "center" }));
}
