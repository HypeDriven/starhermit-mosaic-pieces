# Mosaic Pieces — Game Design Document

**Status:** running specification. Describes the game as it ships today.
**Genre:** single-player assembly puzzle (tile placement with optional rotation).
**Players:** 1, plus asynchronous score comparison through validated leaderboards.
**Session length:** 40 s (a 2×2 lesson) to ~8 minutes (a 7×7 capstone stage).
**Platforms:** desktop and mobile browsers, portrait and landscape.
**Rendering:** Three.js r170 (`three.min.js`, bundled) drawing a gallery-desk diorama, with a
complete semantic-HTML mirror of the board and tray that is fully playable on its own.

## 1. Overview

You are a restorer at a gallery desk. A wooden tray holds the scrambled ceramic tiles of a
mosaic; a slab in front of you holds the empty board. Pick up a tile, turn it upright if it
arrived spun, and set it into a cell. Every tile has exactly one home cell, and the board is
finished when all of them are down.

### File map

| Path | Responsibility |
|---|---|
| `index.html` | Static shell: topbar, objective rail, canvas stage, actions rail, bottom tray, overlay root, two live regions. |
| `main.js` | Bootstrap. Constructs `App`, exposes it as `window.__mosaic` (the e2e hook), starts on DOM ready. |
| `app.js` | State machine, command issuing, input (pointer/keyboard/gamepad), session persistence, progression, score submission. The only module that mutates game state. |
| `rules.js` | Pure deterministic rules engine: RNG, puzzle generation, legality queries, `applyCommand`, scoring, serialization, replay. DOM-free; shared by client, server and tests. |
| `content.js` | Versioned content: themes, 3 lessons, 40 journey stages, 3 practice presets, 3 challenges, daily ruleset, offline validators. |
| `render.js` | Three.js scene: desk, wall, frame, board slab, cell ghosts, tray strip, extruded piece meshes, picking, quality tiers. |
| `ui.js` | Overlay screens, HUD, the accessible tray/board mirror, settings forms, live announcements, achievements list. |
| `audio.js` | WebAudio: four buses, sample playback from `sfx/`, synthesised fallbacks, ambience drone. |
| `platform.js` | Same-origin `/api/v1` adapter with timeouts, round-trip-corrected server time, offline degradation. |
| `server.js` | Node HTTP server: static distribution + `/api/v1` time, daily, leaderboards (replay-validated), achievements, funnel events. |
| `style.css` | Themed shell, three responsive breakpoints, safe-area insets, accessibility classes. |
| `data/` | Server-side durable store (`achievements.json`, `leaderboards.json`). Never served. |
| `assets/` | Generated imagery (see §15). |
| `sfx/` | 15 Opus clips plus `manifest.txt` (canonical), `manifest.json` (generator input), `manifest.md`. |
| `tests/` | `run_tests.js` (unit/property/fuzz), `e2e.mjs` (real-UI playthrough), `smoke_browser.js`, `review-fixes.mjs`. |

## 2. Vision and design pillars

**1. The board is the picture.** Colour and glyph are the only information a tile carries, and the
solved arrangement is an authored mirrored pattern, not noise (`cellPaletteIndex` mirrors x about
the board centre). *Rules in:* palettes that stay legible under a single warm key light; a goal
image rendered from the same palette. *Rules out:* photographic jigsaw scans, interlocking edge
shapes that must be matched by silhouette, and any tile whose identity depends on its neighbours.

**2. Every rule the game knows, the game will tell you.** Hints, lessons and legal-target
highlighting all call the same functions play does (`legalTargetsFor`, `hintFor`, `canPlace`).
*Rules in:* an always-available hint that performs a real legal move; an explanation string for
every rejection. *Rules out:* a separate "tutorial mode" implementation of the rules, and silent
refusals.

**3. A misclick is not a mistake.** Known-illegal targets are explained and refused *before* they
become commands (`_selectPiece`, `_placeSelected` pre-check and return); only genuinely
inconsistent commands bank an invalid action. *Rules in:* a scoring penalty for invalid actions
that honest play never incurs. *Rules out:* punishing fat fingers on a 44 px touch target.

**4. Two boards, one truth.** The Three.js diorama and the DOM tray/cell lists are two views of the
same immutable snapshot; either alone completes a round. *Rules in:* a WebGL-free path that is a
first-class way to play, not a degraded one. *Rules out:* any action reachable only by raycast.

**5. Relaxed play stays valid.** Time and assists are tracked and displayed separately from score,
and undo exists everywhere except the two ranked modes. *Rules out:* a global timer on Practice,
and hint counts that hide inside a single unexplained number.

## 3. Player experience

**Target player:** someone who wants a tidy, finishable spatial puzzle in a few minutes, on a phone
in portrait or on a desktop with the keyboard.

**First 60 seconds.** The title overlay opens over the key art with **Play** focused and dominant.
Play → mode select → **Learn** → *Placing a piece* → a setup card stating board size, rotation,
limits, undo, ranked status and expected duration → **Start**. The 2×2 lesson deals four tiles; the
objective rail and the polite live region carry step 1 ("This is the gallery desk…"). The lesson
advances only when the player performs the action it asked for (`_checkLesson`): select, then
place, then finish. A first completion fires the results card with a full component breakdown and
unlocks *First Mosaic*.

**Typical session.** One daily, or two or three journey stages. Progress is written to
`localStorage` after every command, so a closed tab is offered back on the next visit ("Welcome
back", with the piece count and elapsed time).

**Emotional beat.** The snap. A legal placement plays `piece-snap`, the tile lerps into its cell at
0.22 damping, the score in the HUD rises by 100, and the mirror cell flips to `filled` — four
acknowledgements of one input, none of them longer than a frame or two.

## 4. Core loop and rules contract

All rules live in `rules.js` and are re-executed verbatim by `server.js` when a score is submitted.

### Entities

- **Ruleset** (`normalizeRuleset`): `{cols, rows, needRotation, moveLimit, timeLimitSec, theme, label}`.
  `cols`/`rows` are 2–8 and `cols*rows ≤ 64`; out-of-range values throw `BAD_RULESET`.
- **Piece** — `{id, cell, colorIndex, rot, placed, placedCell, placedRot}`. `id` equals the home
  cell index, so piece *i* belongs in cell *i*. `rot` is 0–3 quarter-turns.
- **State** — pieces, `tray` (draw order), `occupied` (cell → pieceId), `tick`, `status`,
  `terminalReason`, `moves`, `invalidActions`, `hintsUsed`, `undosUsed`, `elapsedMs`, `history`,
  `selected`, `commandLog`. Treated as immutable; `applyCommand` clones and returns a new state.

### Generation (`genPuzzle`)

1. `cellPaletteIndex(seed, cols, rows, x, y, paletteSize)` hashes `img:<seed>:<min(x, cols-1-x)>:<y>`
   with FNV-1a and takes the first 16 bits modulo the palette size — the horizontal mirror is what
   makes the finished picture read as designed rather than random.
2. If `needRotation`, each piece draws a starting rotation 0–3 from the seeded stream.
3. The tray is Fisher-Yates shuffled on the same stream. For boards of 4 cells or fewer, a tray that
   came out already in solved order is reversed, so no puzzle ships pre-solved.

### Commands

| Command | Legality (owner) | Effect |
|---|---|---|
| `select {piece}` | active round, piece exists and is unplaced | sets `state.selected`; not written to the command log |
| `rotate {piece, rotations=1}` | active round, piece unplaced | `rot = (rot + rotations) mod 4` |
| `place {piece, cell}` | `canPlace`: active, piece exists and unplaced, cell in bounds and free, and `rot === 0` when `needRotation` | pushes an undo snapshot, fills the cell, `moves += 1`, clears the selection |
| `hint {}` | active, `hintFor` finds a move | `hintsUsed += 1`, then *performs* the move — the first tray piece that is spun is straightened, otherwise the first piece that fits its home cell is placed |
| `undo {}` | history non-empty **and** mode is not `daily` or `challenge` | pops the snapshot, `undosUsed += 1` |
| `timeup {}` | `timeLimitSec > 0` | `status = failed`, reason `time-limit` |
| `elapsed {ms}` | `0 ≤ ms ≤ 24 h` | sets `elapsedMs`; not logged |

Malformed commands (`BAD_COMMAND`) always throw. Rule violations throw only under `opts.strict`
(the tests use it); otherwise they increment `invalidActions` and are appended to `commandLog`, so a
replay reproduces the same invalid count and the same score.

### Resolution order

`applyCommand` clones → `tick += 1` → dispatch → mutate → log → `checkTerminal`. `checkTerminal`
sets `complete` when every piece is placed, else `failed`/`move-limit` when `moves ≥ moveLimit`.
The client wraps this in `App._cmd`, which additionally: rejects duplicate command ids, plays the
matching cue, announces the outcome, re-renders both boards, saves the session, advances the lesson
and checks for terminal state.

### Scoring (`scoreComponents`)

```
placement      = placedPieces × 100
completion     = complete ? n × 50 : 0
efficiency     = complete ? max(0, 2n − moves) × 10 : 0
hintCost       = hintsUsed × 75
undoCost       = undosUsed × 25
invalidPenalty = invalidActions × 10
total          = max(0, placement + completion + efficiency − hintCost − undoCost − invalidPenalty)
```

**Worked example** — Practice *Relaxed*, a 3×3 board (n = 9), finished in 9 placements with one
hint, one undo and no invalid actions. The undo removed a placement that was then re-placed, so
`moves` is 10:

```
placement      9 × 100                = 900
completion     9 × 50                 = 450
efficiency     max(0, 18 − 10) × 10   =  80
hintCost       1 × 75                 = −75
undoCost       1 × 25                 = −25
invalidPenalty 0                      =   0
total                                 = 1330
```

Perfect play on the same board (9 moves, no assists) scores 900 + 450 + 90 = **1440**.

### Terminal states and tie-breaks

`complete` (reason `completed`), `failed` (`move-limit` or `time-limit`). Leaving a round is not a
terminal state: it discards the session. `compareResults` orders by score desc, then completion,
then fewer invalid actions, then lower `elapsedMs`, then `sessionId` for stability.

### Determinism

`makeRng` is a 32-bit mulberry-style generator; `fnv1a` provides content hashing. `dailySeed(date)`
is `fnv1a('mosaic-daily:' + date)` as an unsigned 32-bit integer, so every client derives the same
daily without asking the server. `stateHash` folds seed, tick, status, per-piece placement, move and
assist counts and the score into one FNV-1a digest; `replay(seed, ruleset, mode, commands)` rebuilds
a state from scratch, dropping duplicate command ids, and returns hashes plus the final score.

## 5. Modes and progression

| Mode | Content | Ranked | Undo | Notes |
|---|---|---|---|---|
| Learn | 3 lessons (`LESSONS`): place, rotate, hint+undo | no | yes | 2×2, 2×2 rotate, 3×2. Runs on the `practice` rules mode; step gating in `_checkLesson`. |
| Journey | 40 stages (`JOURNEY`) | submitted to the `chase` board | yes | Sequential unlock: stage *n* requires *n−1* complete. |
| Daily | `dailyContent(utcDate)` | yes, `daily` board | **no** | Seed and ruleset derived from the UTC date; three variants by `seed % 3`: 4×4 rotate, 5×4 rotate, 5×5. |
| Practice | 3 presets: Relaxed 3×3, Standard 4×4 rotate, Expert 6×6 rotate | no | yes | Fresh random seed on every start and every retry. |
| Challenge | 3 goals: *Perfect Fit* (4×4, 16-move limit), *Gallery Sprint* (4×4 rotate, 180 s), *Panorama* (8×4 rotate) | `chase` board | **no** | Fixed seeds, so results are comparable. |
| Score chase | Leaderboard viewer | — | — | Reads the daily board for today and the all-time `chase` board. |

**Difficulty curve.** Journey is five blocks of eight. Block 1 (1–8) is placement only on boards
growing 2×2 → 4×4. Block 2 (9–16) introduces rotation in isolation on a 2×2, then recombines it with
the larger boards already learned. Block 3 (17–24) returns to placement mastery at 4×5 → 6×6 and
mixes rotation back in. Blocks 4–5 (25–40) are rotation on 6×6 → 7×7 and 6×8 panoramas. Every eighth
stage is flagged `mastery` and marked ★ in the menu. `tutorialFlags` marks stage 1 (`place`) and
stage 9 (`rotate`) as the concept-introducing stages. Each stage carries a `par` of
`{moves: cols×rows, timeSec: 30 + cells × 8}`.

**Daily immutability.** The seed is a pure function of the date. `server.js` accepts submissions
only for today's or yesterday's official seed, so a late finisher is not punished and a fabricated
seed is rejected.

**Unlocks.** Five achievements (`ACHIEVEMENTS` in `ui.js`), unlocked in `_applyProgression`:
`first_completion`, `rotation_master` (a rotation journey stage with zero hints), `streak_3` (three
distinct UTC days played), `journey_20`, `long_haul` (60 total minutes). Unlocks toast on screen,
persist locally, and POST to `/api/v1/achievements`.

**Content validation.** `validateStage` / `validateAll` prove, offline, that every stage generates
the right number of pieces with unique ids, that the tray references only real pieces, that every
home cell is in bounds, that a par time exists, and that a recovery mechanic (hint) is allowed —
i.e. that no authored stage can soft-lock. `npm test` runs it over all 46 content rows.

## 6. Controls and interaction

| Input | Desktop | Mobile |
|---|---|---|
| Select a tile | click the mesh, or a tray button in the rail | tap the mesh, or a tray button in the drawer |
| Place | click a highlighted cell, or a mirror cell button | tap a cell, or a mirror cell button |
| Drag | press and move > 8 px, release over a cell | same; `touch-action: none` on the canvas |
| Rotate | `R`, the Rotate button, double-click a tile, or re-click the selected tile | Rotate button (rail or bottom tray), double-tap, or re-tap the selected tile |
| Hint | `H` or the Hint button | Hint button |
| Undo | `U` or the Undo button | Undo button |
| Pause | `Esc` or the Pause button | Pause button |
| Reset camera | `C` | — |
| Quick select | digits `1`–`9` pick the *n*th unplaced tray piece | — |
| Navigate mirrors | `Tab` into the list, arrows within (board arrows step by `cols`, skipping disabled cells) | same with an external keyboard |
| Gamepad | D-pad/left stick moves a cell cursor; A select/place, B rotate, X hint, Y undo, Start pause/resume | — |

**Input locking.** `_canPlay()` gates every gameplay input on: a state exists, it is `active`, the
game is not paused, and no overlay is open. There is no animation lock — the settle animation is
purely cosmetic and the next command may be issued on the following frame. Pointer drags take
pointer capture and restore the piece to its rules-derived position on `pointercancel`.

**Double-commit protection.** Every command carries `sessionId:counter`; `App` refuses an id it has
already applied and `replay` skips duplicates, so a repeated tap can never place twice.

**Feedback per input.** Selection lifts the mesh 0.55 units, sets `aria-pressed`, ringed markers
appear on every legal cell, and the polite region announces the count. Placement snaps, scores and
announces "*n* of *m*". Rejection plays `invalid-move` and pushes a specific sentence to the
assertive region ("That cell is occupied", "The piece must be upright first — rotate it with R").

## 7. Screens and UI flow

```
boot → [saved active session?] → resume prompt ─┬─ resume → active
                                                └─ discard → title
title ─ Play → mode select ─┬─ learn → setup → active
                            ├─ journey → setup → active
                            ├─ daily → setup → active
                            ├─ practice → setup → active
                            ├─ challenge → setup → active
                            └─ score chase (leaderboards)
active ⇄ pause ─┬─ settings → (back to pause)
                ├─ help → (back to pause)
                └─ leave round → title
active → results ─┬─ play again → active
                  ├─ next recommended → setup (next journey stage) or mode select
                  └─ title
```

One overlay at a time (`UI.openScreen` replaces `#overlay-root`). Each is `role="dialog"`,
`aria-modal`, labelled, and focuses its first control; closing restores the previously focused
element. `Esc` resumes from pause, closes an overlay only when a live round is behind it, and
otherwise pauses — the title, mode select and results are never dismissed into an empty screen.

**Layouts.**
- **≥1024 px:** three-column grid — 260 px objective/progress rail, elastic canvas stage, 300 px
  actions/tray/board rail. Prose is capped at 70 characters.
- **<1024 px:** rails become fixed off-canvas drawers toggled by the two topbar buttons; the stage
  takes the full width.
- **Portrait ≤700 px:** the four primary actions dock into a persistent bottom tray inside the
  bottom safe-area inset; the topbar and HUD shrink.
- **Landscape ≤500 px tall:** the left rail is hidden, the right rail docks at 200 px, the bottom
  tray is suppressed, and 44 px targets are re-asserted.

Safe-area insets are applied to the topbar (top), bottom tray (bottom, left, right) and HUD (top,
left). **Never cut off:** the HUD counters, the four action buttons, the tray list, and the primary
button of any overlay. Overlay cards cap at `min(560px, 94vw)` by `90vh` and scroll internally.

## 8. Art direction

**Palette.** Shell themes (`style.css`) — Gallery `--bg:#2b2f3a --panel:#343947 --line:#5a6172
--text:#eceef2 --accent:#cfa9ff --btn:#8a4fd0`; Forest `#2b3a2f/#34473a/#b7e4c7/#2d6a4f`; Ocean
`#2b3547/#344056/#cfe9ff/#0b6d91`; Sunset `#473b2b/#564834/#ffe1cf/#a05a2e`; Plum
`#3b2b47/#463456/#ffdff0/#8f3a72`. Tile palettes (`PALETTES` in `rules.js`) are six colours each,
e.g. Gallery `#8a4fd0 #cfa9ff #ffd166 #06d6a0 #ef476f #118ab2`. Legal-target rings and candidate
cells are `#7dff9a`; the move/time warning is `#ffb35c`. High contrast overrides everything to pure
black/white with `#ff0` accents and `#005fcc` buttons.

**Shape language.** Rounded squares throughout: tiles are extruded rounded rects (0.2 corner, 0.28
depth, bevelled) and cell ghosts are the same silhouette flattened to 10 % white. Each palette index
also carries a glyph — `▲ ◆ ● ■ ★ ✚` — drawn on the tile face and repeated in the DOM mirror, so
colour is never the only channel. A white tick on the tile's top edge makes rotation readable by
shape alone.

**Typography.** System UI stack throughout. Rail headings are 0.8 rem uppercase with 0.08 em
tracking; numerals in the HUD, score tables and leaderboards use `tabular-nums`. Large-text mode
scales the root to 120 %.

**Motion.** Pieces critically damp toward their rules-derived target at 0.22 per frame in position
and rotation, and toward a 0.55-unit lift when selected. Rotation takes the shorter angular path.
Nothing blocks input, and any state change re-targets mid-flight.

**Hero.** The lit board slab. One warm directional key (`#fff2e0`, intensity 2.4, soft PCF shadows)
against a cool hemisphere fill grounds the tiles with contact shadows on a walnut desk; the scene
clears to `#1d2028`.

**Reduced motion.** `reducedMotion` sets the damping to 1.0 — pieces teleport to their exact end
state — and shortens the results delay from 700 ms to 100 ms. The CSS media query additionally
kills every transition and animation. It is enabled automatically on first run when the OS asks for
it.

**Visual assets the design calls for.** (1) A photographic key-art plate of a restorer's desk strewn
with glazed tiles, sitting behind every overlay so the menus feel located in the fiction. (2) A
plaster gallery-wall plate for the scene's back wall and for the no-WebGL panel. Both are listed in
§15. Nothing in either image carries text.

## 9. Audio direction

**Mix philosophy.** Ceramic and wood, quiet and dry. Every cue is under 400 ms except the two
round-end phrases and the achievement flourish. Nothing loops except a near-subliminal drone.

**Buses.** `music`, `effects`, `ambience`, `voice`, each a `GainNode` on a master gain, each with an
independent slider in Settings and on the pause card (defaults 0.5 / 0.85 / 0.4 / 0.8). Mute zeroes
the master. The context suspends on `visibilitychange` and resumes on return.

**Ambience.** Three detuned sine drones (110 / 165.2 / 220.7 Hz at 0.05 / 0.035 / 0.02 gain) start
on the first round, standing in for the room tone of a quiet gallery. There is no music track.

**Fallbacks.** `playEvent(id)` prefers the decoded Opus sample and falls back to a short synthesised
transient for the same id, so the game is never silent if a clip fails to fetch or decode. Samples
are fetched lazily after the first gesture and cached.

### SFX event table

| Event id | File | Description | Usage context |
|---|---|---|---|
| `select` | `piece-select.opus` | Fingertip tap on glazed ceramic, bright click with a glassy ring | A tray piece becomes selected |
| `pickup` | `piece-pickup.opus` | Tile lifted off a wooden tray, scrape and light clink | A drag passes the 8 px threshold |
| `place` | `piece-place.opus` | Tile set down on a board, soft thud then clink | Reserved for non-snapping placements; currently unused |
| `snap` | `piece-snap.opus` | Crisp click of two pieces locking together | A legal `place` is accepted |
| `rotate` | `piece-rotate.opus` | Quarter-turn whoosh with a felt swish | A `rotate` command applies |
| `invalid` | `invalid-move.opus` | Dull muted double thud of wood on a table edge | Any refused action, pre-checked or banked |
| `hint` | `hint-reveal.opus` | Brass bell shimmer with a rising glissando | A `hint` resolves and performs its move |
| `undo` | `undo-move.opus` | Reverse slide into a settling clink | An `undo` pops the history |
| `complete` | `round-complete.opus` | Four ascending glockenspiel notes with reverb | Status reaches `complete` |
| `fail` | `round-fail.opus` | Three descending marimba notes, quiet | Move limit or time limit ends the round |
| `tick` | `timer-tick.opus` | Dry mechanical clock tick | Each of the last ten seconds of a timed round |
| `ui` | `ui-click.opus` | Short soft plastic tap | Forward navigation, pause, resume |
| `back` | `menu-back.opus` | Lower, quieter descending two-tone wooden knock | Back, close, leave-round, return-to-title |
| `roundstart` | `round-start.opus` | Tray of tiles settling into a warm wooden thud | A round begins and the tray is dealt |
| `achieve` | `achievement-unlock.opus` | Bright celesta flourish with a sparkling tail | A first-time achievement toast appears |

`sfx/manifest.txt` is the canonical form of this table and the contract the audio module binds to.

## 10. Localization

The product requires en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT. **Today all
player-facing strings are hard-coded en-US** and live inline in `index.html` (shell labels), `ui.js`
(screen bodies, achievement names, HUD labels) and `app.js` (objectives, announcements, rejection
reasons). `<html lang="en">` is fixed and no locale is negotiated. See §17.

Layout is already expansion-tolerant: nothing is sized to a string, prose caps at 70ch, buttons wrap
to two lines, and every number formatted for display (`formatTime`, score totals) is derived from an
integer held in state, never parsed back from text.

## 11. Accessibility

- **Keyboard-only path.** Every screen is reachable and every round completable without a pointer:
  `Tab` to the tray list, arrows within it, `Enter` to select, `Tab` to the cell grid, arrows (which
  step by `cols` vertically and skip disabled cells), `Enter` to place. `R`/`H`/`U`/`Esc`/`C` and
  digits `1`–`9` are global while a round is active.
- **Focus.** Overlays trap attention by replacing the overlay root, focus the first control, and
  restore the prior focus on close. `:focus-visible` draws a 3 px accent outline on every control.
- **Screen-reader announcements.** A polite `role="status"` region carries selection, placement,
  progress, lesson steps, and submission results; an assertive `role="alert"` region carries
  rejections. Both are cleared and re-set on a timer so repeated messages re-announce. Every tray
  button has a label naming the piece number, its glyph, and whether it is upright, rotated by *n*
  degrees, selected, or placed. The WebGL canvas is `aria-hidden`.
- **Contrast.** Body text on panel is `#eceef2` on `#343947` (≈ 10:1). High-contrast mode forces
  pure black/white. Overlay key art always sits under a scrim, and high contrast replaces it with
  flat black.
- **Reduced motion.** OS-detected on first run, toggleable, and applied to both the CSS and the
  renderer damping.
- **Colour independence.** Glyphs duplicate every colour; a colour-vision-safe palette option forces
  the Gallery palette for tiles regardless of theme.
- **Targets.** 44×44 CSS px minimum on every button, tray tile, cell and form control.
- **Other options.** Larger text (120 %), left-handed layout (mirrors the rail order via `direction`
  while keeping text LTR), timing assistance (doubles every time limit at round start).

## 12. StarHermit integration

`starhermit.txt` declares `name`, `launch=index.html`, `owner`, `server=server.js` and
`cover=coverart.png`, per the platform conventions at https://wiki.starhermit.com/.

**Used.**
- *Server script* — `server.js` is the game's authoritative script, serving both the static
  distribution and its `/api/v1` surface.
- *Platform time* — `GET /api/v1/time`; `Platform.syncTime` corrects for round-trip latency and the
  topbar clock and the daily date both read the corrected clock, not the device clock.
- *Daily content* — `GET /api/v1/daily`.
- *Leaderboards* — `POST /api/v1/leaderboard/submit` and `GET /api/v1/leaderboard`, on two boards:
  `daily:<date>` and the all-time `chase`. Submissions are **replayed server-side** before they are
  accepted (see §13); entries are idempotent per session id and boards are trimmed to 200.
- *Achievements* — `POST /api/v1/achievements` with a validated key pattern, stored durably in
  `data/achievements.json`.
- *Sessions* — a per-round `sessionId` identifies submissions and marks the player's own row on a
  board.
- *Anonymous funnel telemetry* — `POST /api/v1/event` for `start`, `tutorial-step`, `round-end`,
  `retry`, `settings-change` and `error` only. No text, no personal data.

**Not used.** Platform identity and sign-in (the profile is a local guest name; the host shell owns
sign-in), presence, friends graphs, real-time multiplayer, matchmaking, chat, parties, cloud saves
and monetisation. Every network call degrades to a null result, so the whole game — including
Daily — plays offline.

## 13. Technical architecture

**Layering.** `rules.js` depends on nothing. `content.js` depends on `rules.js`. `render.js`,
`ui.js`, `audio.js` and `platform.js` are leaves consuming snapshots. `app.js` is the only module
that issues commands or mutates progression. `server.js` imports `rules.js` and `content.js` and
shares them with the client byte-for-byte, which is why replay validation is meaningful.

**Determinism and replay.** A round is fully described by `(seed, ruleset, mode, commandLog)`.
`Rules.replay` reconstructs it; `stateHash` provides a cheap comparison point. `validateSubmission`
rejects a claim unless: the board matches the mode, the mode is one of daily/challenge/journey, the
content version matches, the seed is an official daily seed (daily boards only), the replay reaches
`complete`, the replayed score equals the claimed score, and the client's `finalHash` matches.
Because rejected commands are also logged, an honest client's invalid-action penalty replays
exactly.

**Persistence.** `localStorage` holds `mp-settings-v1` (audio, quality, theme, accessibility),
`mp-progress-v1` (journey progress, achievements, days played, total time, display name) and
`mp-session-v1` (the serialized in-flight round). The session is written after every command and
cleared on any terminal state. `deserialize` refuses states from a newer schema and migrates v1 by
starting a fresh 3×3 rather than guessing.

**Performance budgets.** One draw pass per frame; scene complexity is a slab, a tray, a desk, a wall
and one mesh per cell plus one ring per legal target, so a 6×6 stage stays well under 100 meshes.
Piece geometry and the extrude are shared across every tile of a puzzle; face textures are cached by
`(colour, glyph)` in a module-level map and are never disposed with a mesh. Quality tiers cap device
pixel ratio at 2 / 1.5 / 1 and drop shadows at *low*. `_loop` returns early when the tab is hidden.

**Server.** Static serving is GET/HEAD only and traversal-safe; `data/` is refused; `three.min.js`
is cached immutably and everything else `no-cache`. Bodies cap at 256 KB and requests are rate
limited to 120/minute/IP. The listener only binds when `server.js` is the entry point, so the test
suite can import `validateSubmission` without opening a port.

**How the e2e drives the real UI.** `tests/e2e.mjs` boots the real server, launches Chrome via
`playwright-core`, and clicks only visible controls — menu buttons, `#piece-list` tray buttons,
`#cell-grid` cell buttons, `#btn-hint`, `#btn-undo`, real form inputs, and the `Escape` key. It
reads `window.__mosaic` only to *assert* state, never to advance it.

## 14. Testing and acceptance criteria

`npm test` (`tests/run_tests.js`, 524 assertions) covers: puzzle generation and mirroring; legal
actions and every invalid reason code; rotation rules; hints answering through the legal-action API;
terminal states for completion, move limit and time limit; the undo restriction in ranked modes;
each scoring component; serialization, versioning and v1 migration; replay determinism as a property
test over many seeds; fuzzing of malformed commands; golden fixed sessions; `validateAll` over all
46 authored content rows; and `validateSubmission` accepting honest claims while rejecting stale
content versions, wrong boards, bad seeds, score mismatches and hash mismatches.

`npm run test:e2e` runs 14 steps at 1280×800 and again at 390×844 with touch, failing on any
non-benign console error or page error: load and title; journey lists 40 stages with only stage 1
unlocked; the setup card; round start with a visible HUD, a populated mirror and a live canvas; a
full playthrough to results via tray and cell buttons; progression persisted to `localStorage`;
retry → `Esc` pause → resume; undo restoring the board; hint placing a piece; settings changed,
applied and persisted, returning to the pause card; help open and close; leaving to the title and
starting Practice; finishing Practice with a score breakdown; and layout sanity (bottom tray visible
on portrait mobile, actions rail docked on desktop).

**QA bar, as checkable statements.**
1. Every feature the UI exposes is reachable and usable with a mouse, a touch screen and a keyboard.
2. A complete round can be played, scored and repeated without opening the console.
3. No console errors or warnings at either viewport, including audio, WebGL and network paths.
4. No text or control is clipped at 1280×800, 390×844 portrait, or 844×390 landscape.
5. Progress and settings survive a reload; an interrupted round is offered back.
6. With WebGL unavailable, the fallback panel appears and the DOM mirror still completes a round.
7. Every rejected action produces both an audible cue and a specific spoken reason.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/title-backdrop.webp` | Key art behind every overlay screen (1280×720, scrimmed) | FLUX.2 klein, seed 71904, 28 steps; WebP q80, 70 KB | generated in this pass |
| `assets/gallery-wall.webp` | Plaster texture on the scene's back wall and background of the no-WebGL panel (1024×512) | FLUX.2 klein, seed 40231, 28 steps; WebP q78, 20 KB | generated in this pass |
| `coverart.png` | Platform cover art (`cover=` in `starhermit.txt`) | prior pass | shipped |
| `icon.png`, `favicon.svg` | App icon and browser tab icon | prior pass | shipped |
| `three.min.js` | Three.js r170 renderer | vendored library | shipped |
| `sfx/piece-select.opus` … `sfx/ui-click.opus` (12 clips) | Core interaction, rejection, assist and round-end cues | MOSS-SoundEffect v2.0 | shipped |
| `sfx/menu-back.opus` | Back/close cue | MOSS-SoundEffect v2.0, 100 steps | generated in this pass |
| `sfx/round-start.opus` | Tray-dealt cue at round start | MOSS-SoundEffect v2.0, 100 steps | generated in this pass |
| `sfx/achievement-unlock.opus` | Achievement toast flourish | MOSS-SoundEffect v2.0, 100 steps | generated in this pass |
| Tile faces, goal image | Per-colour canvas textures with glyph and orientation tick; goal image drawn from the solved board | procedural, `render.js` | shipped |
| 3D models | — | — | not called for: every prop is a primitive or an extruded rounded rect, and a scanned tile would be less legible than the glyph-bearing procedural face |
| Character animation | — | — | not called for: no humanoid or animated character exists |

## 16. Known limitations

- The goal image hangs in a framed canvas on the back wall, but `_frameCamera` frames the board and
  tray only, so at every shipped board size the frame sits above the view. The wall texture and the
  goal image are built and updated correctly; they are simply rarely on screen.
- The `place` event and `piece-place.opus` are bound in `audio.js` but never triggered: `App._cmd`
  maps every accepted placement to `snap`.
- `holdToDrag` is stored, persisted and shown in Settings but has no effect — drag always engages at
  8 px of movement, and toggle-select always works alongside it.
- Server-side achievements are keyed by the per-round `sessionId`, which is regenerated on every
  round, so `data/achievements.json` accumulates one row per session rather than per player.
  Achievement *state* is authoritative in `localStorage`; the endpoint is effectively a counter.
- The "Score chase" menu entry promises friends comparison; only global boards exist.
- Leaderboard boards live in a flat JSON file with no eviction beyond the 200-entry trim, and rate
  limiting is per-IP and in-memory.
- All strings are en-US only (§10).

## 17. Design intent not yet implemented

- **Localization to the nine required locales.** The intent is a `locales/<tag>.json` string table
  plus a `t(key, params)` helper, chosen from the platform locale with `navigator.languages` as the
  fallback and an override in Settings; `index.html`'s inline labels become keyed spans and
  `<html lang>` is set at boot.
- **Framing the goal image.** Intent: a camera framing that includes the wall canvas, or a HUD
  thumbnail of the goal image, so the picture the player is assembling is visible during play.
- **Hold-to-drag.** Intent: when enabled, a drag requires a press-and-hold dwell before the piece
  detaches, for players who scroll and drag with the same finger.
