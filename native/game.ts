// The browser build's pure game modules — the deterministic rules (rules.js:
// puzzle generation, legality, commands, hints, scoring, serialization,
// replay), the versioned content (content.js: themes, lessons, Journey stages,
// practice presets, challenges, the Daily) and the save document
// (progress.js) — imported unchanged (allowJs) and typed here with the shapes
// this client reads.
import * as RulesJs from "../rules.js";
import * as ContentJs from "../content.js";
import * as ProgressJs from "../progress.js";

export interface Ruleset { cols: number; rows: number; needRotation: boolean; moveLimit: number; timeLimitSec: number; theme: string; label: string }
export interface Piece { id: number; cell: number; colorIndex: number; rot: number; placed: boolean; placedCell: number; placedRot: number }
export interface State {
  v: number; seed: number; mode: string; ruleset: Ruleset; pieces: Piece[]; tray: number[]; occupied: Record<number, number>;
  tick: number; status: "active" | "complete" | "failed"; terminalReason: string | null; moves: number; invalidActions: number;
  hintsUsed: number; undosUsed: number; elapsedMs: number; history: unknown[]; selected: number | null; commandLog: unknown[];
}
export interface Command { type: string; piece?: number; cell?: number; rotations?: number; ms?: number; id?: string }
export interface Hint { type: "rotate" | "place"; piece: number; cell?: number; rotations?: number }
export interface Score { placement: number; completion: number; efficiency: number; hintCost: number; undoCost: number; invalidPenalty: number; total: number }
export interface Result { score: number; completed: boolean; invalidActions: number; elapsedMs: number; sessionId: string }

interface RulesApi {
  PALETTES: Record<string, string[]>;
  newGame(seed: number, ruleset: Partial<Ruleset>, mode?: string): State;
  applyCommand(prev: State, cmd: Command, opts?: { strict?: boolean }): State;
  canPlace(s: State, piece: number, cell: number): string | null;
  legalTargetsFor(s: State, piece: number): number[];
  hintFor(s: State): Hint | null;
  pieceById(s: State, id: number): Piece | null;
  scoreComponents(s: State): Score;
  score(s: State): number;
  compareResults(a: Result, b: Result): number;
  serialize(s: State): string;
  deserialize(json: string): State;
}

export interface Lesson { id: string; title: string; seed: number; ruleset: Partial<Ruleset>; steps: { text: string; await: string | null }[] }
export interface Stage { id: string; index: number; seed: number; ruleset: Ruleset; par: { moves: number; timeSec: number }; mastery: boolean }
export interface PracticePreset { id: string; label: string; ruleset: Partial<Ruleset> }
export interface Challenge { id: string; label: string; desc: string; seed: number; ruleset: Partial<Ruleset> }
export interface Daily { id: string; date: string; seed: number; ruleset: Ruleset }
export interface ThemeDef { id: string; label: string; accent: string }
interface ContentApi {
  THEMES: ThemeDef[];
  LESSONS: Lesson[];
  JOURNEY: Stage[];
  PRACTICE: PracticePreset[];
  CHALLENGES: Challenge[];
  dailyContent(date: string): Daily;
}

export interface Best { score: number; elapsedMs: number; invalidActions: number; date?: string }
export interface Progress {
  journeyCompleted: number; achievements: string[]; daysPlayed: string[]; totalTimeMs: number; displayName: string;
  best: { daily?: Best; chase?: Best };
}
export interface Options { theme: string; cvdPalette: boolean; timingAssist: boolean; leftHanded: boolean }
interface ProgressApi {
  DEFAULT_OPTIONS: Options;
  OPTION_KEYS: (keyof Options)[];
  BROWSER_KEYS: string[];
  normalize(raw: unknown): Progress;
  mergeSaves(local: unknown, remote: unknown): Progress;
  sameProgress(a: unknown, b: unknown): boolean;
  pickOptions(raw: unknown): Partial<Options>;
  readForeign(text: string | null | undefined): { progress: Progress; options: Partial<Options> } | null;
}

export const Rules = RulesJs as unknown as RulesApi;
export const Content = ContentJs as unknown as ContentApi;
export const Prog = ProgressJs as unknown as ProgressApi;
