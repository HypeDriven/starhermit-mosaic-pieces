# Mosaic Pieces — Game Design Document

**Status:** running specification. Describes the game as it ships today.
**Genre:** single-player assembly puzzle (tile placement with optional rotation).
**Players:** 1, plus asynchronous score comparison through validated leaderboards.
**Session length:** 40 s (a 2×2 lesson) to ~8 minutes (a 7×7 capstone stage).
**Platforms:** a StarHermit engine script game (engine 1.29.0, host API minor 31), played natively by
the StarHermit client and in desktop and mobile browsers (portrait and landscape) by the engine's web runtime.
**Rendering:** `starhermit:scene` (three.js r185 names) drawing the gallery-desk diorama, with a complete
accessible mirror of the tray and board (`starhermit:ui` buttons) that is fully playable on its own.

## 1. Overview

You are a restorer at a gallery desk. A wooden tray holds the scrambled ceramic tiles of a
mosaic; a slab in front of you holds the empty board. Pick up a tile, turn it upright if it
arrived spun, and set it into a cell. Every tile has exactly one home cell, and the board is
finished when all of them are down.

### File map

| Path | Responsibility |
|---|---|
| `starhermit.txt` | Manifest: `launch=index.html`, `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.29.0`, `engine.minor=31`, capabilities `platform,storage,clipboard`, `server=score-script.js`, one `control.<action>` line per keyboard action, `engine.group.*` and `engine.gamepad.*` defaults. |
| `index.html`, `starhermit-files.json` | The web loader and file index `npm run package` (`starhermit package --web .`) writes; never edited by hand. |
| `native/main.ts` | Entry module: the screen state, the round (the one validated command path), the round clock on fixed steps, lessons, progression, achievements, personal bests, posting to the leaderboard, the saved round, and input (actions, the board cursor, pointer and touch on the desk). |
| `native/screens.ts` | Every screen and the round's shell (top bar, rails, HUD, goal thumbnail, bottom tray, drawers, toasts) in `starhermit:ui`. |
| `native/render.ts` | The 3D gallery desk on `starhermit:scene`: desk, wall, frame and picture light, board slab, ghost cells, tray, extruded tiles, rings, cursor, particles, picking and dragging, the camera framing, the look per graphics level. |
| `native/quality.ts` | The old graphics presets and budgets keyed by the runtime's quality tier and level. |
| `native/style.ts` | Registers `assets/ui-style.json` and the theme / high-contrast tokens. |
| `native/audio.ts` | One-shot samples per event and the rendered ambience drone on the runtime's buses. |
| `native/platform.ts` | Saves (with foreign-save migration and conflict merge), the device's saved round, the game's options, the player, invite link, clock, leaderboard read and score posting. |
| `native/i18n.ts`, `native/account.ts` | `T` / `N` over `strings.js` in the runtime's interface language; the StarHermit account strings. |
| `native/game.ts` | Typed facade over the pure modules below. |
| `rules.js` | Pure deterministic rules engine: RNG, puzzle generation, legality queries, `applyCommand`, scoring, serialization, replay. Shared by the client, `server.js` and the tests. |
| `content.js` | Versioned content: themes, 3 lessons, 40 journey stages, 3 practice presets, 3 challenges, daily ruleset, offline validators. |
| `progress.js` | The save document: normalize, merge (`mergeProgress`), the old cloud document's conversion, the game's options. |
| `strings.js` | Translation tables (English keys, nine locales), a classic script (`loadClassic`). |
| `score-script.js` | StarHermit platform script (`server=`): range-checks a completed round's score and posts it to the `high-score` leaderboard. |
| `server.js` | Local dev host and `validateSubmission` (used by the tests); not part of the package. |
| `assets/` | Key art, wall plaster, baked desk/slab/felt textures (`assets/textures/`, `tools/bake-textures.mjs`), `ui-style.json` (from `tools/ui-style.css`). |
| `sfx/` | 15 Opus clips plus `manifest.txt` (canonical), `manifest.json`, `manifest.md`. |
| `tests/` | `run_tests.js` (rules, content, replay, submissions), `progress.test.mjs`, `i18n.test.mjs`, `native.mjs` (type check, `starhermit check`, the `tests/native/*.play` render checks, web index up to date). |
| `tools/` | `package-web.mjs`, `css.mjs`, `bake-textures.mjs`, `gen-plays.mjs` (writes the generated play scripts), `browser-play.mjs` (GPU Chrome playthrough of the web package). |

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

**4. Two boards, one truth.** The 3D diorama and the tray/cell button lists are two views of the
same immutable snapshot; either alone completes a round. *Rules in:* a path without the 3D view that is a
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

**Typical session.** One daily, or two or three journey stages. The round is saved on the
device after every command, so a closed window or tab is offered back on the next visit ("Welcome
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
The client wraps this in `cmd()` (`native/main.ts`), which additionally: rejects duplicate command ids, plays the
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

**Unlocks.** Five achievements (`ACHIEVEMENTS` in `native/main.ts`), unlocked in `applyProgression`:
`first_completion`, `rotation_master` (a rotation journey stage with zero hints), `streak_3` (three
distinct UTC days played), `journey_20`, `long_haul` (60 total minutes). Unlocks toast on screen and
persist in the save (cloud-saved when signed in). Toasts stack at the bottom centre during play (above
the phone's bottom tray); while a screen is open they move to the top edge and the card moves down to
leave them room, so a toast never covers a heading or button. Screens open with their first control
focused without scrolling the card.

**Content validation.** `validateStage` / `validateAll` prove, offline, that every stage generates
the right number of pieces with unique ids, that the tray references only real pieces, that every
home cell is in bounds, that a par time exists, and that a recovery mechanic (hint) is allowed —
i.e. that no authored stage can soft-lock. `npm test` runs it over all 46 content rows.

## 6. Controls and interaction

| Input | Desktop | Mobile |
|---|---|---|
| Select a tile | click the tile on the desk, or a tray button in the rail | tap the tile, or a tray button in the actions drawer / landscape rail |
| Place | click a cell, or a board-cell button | tap a cell, or a board-cell button |
| Drag | press a tile and move > 8 px, release over a cell | same with a finger |
| Rotate | `R`, the Rotate button, or click the selected tile again (a double-click) | Rotate button (rail or bottom tray), or tap the selected tile again (a double-tap) |
| Hint | `H` or the Hint button | Hint button |
| Undo | `U` or the Undo button | Undo button |
| Pause | `Esc` or the Pause button (Esc also closes an open drawer) | Pause button |
| Reset camera | `C` | — |
| Quick select | digits `1`–`9` pick the *n*th unplaced tray piece | — |
| Board cursor | with no button focused, arrows move a cursor ring over the board (wrapping) and `Enter` places the selected piece there, or picks the first open tray piece when none is selected | — |
| Mirror navigation | `Tab` into the tray or cell buttons, arrows move between them (the cell grid by rows and columns), `Enter` selects or places | same with an external keyboard |
| Gamepad | D-pad/left stick moves the board cursor; South picks the next tray piece or places; East rotates; West hints; North undoes; right stick press resets the camera; Start pauses/resumes | — |

Players rebind every key and pad button in the runtime's Options (F1); the rail's key hints and the
help card show the effective keys (`bindings()`).

**Input locking.** `canPlay()` gates every gameplay input on: a state exists, it is `active`, the
game is not paused, and no screen is open. There is no animation lock — the settle animation is
purely cosmetic. Pointer and touch presses are queued and decided after the frame's UI is built, so a
press on a widget is the widget's; a drag's release looks through the carried tile to the cell below,
and a cancelled touch returns the tile to its rules-derived position.

**Double-commit protection.** Every command carries `sessionId:counter`; the client refuses an id it
has already applied and `replay` skips duplicates, so a repeated tap can never place twice.

**Feedback per input.** Selection lifts the tile 0.55 units, marks its tray button selected, rings
appear on every legal cell, and the screen reader hears the count. Placement snaps, scores and
announces "*n* of *m*". Rejection plays `invalid-move` and announces a specific sentence (assertive)
("That cell is occupied", "The piece must be upright first — rotate it with R").

## 7. Screens and UI flow

```
boot → [saved active session?] → resume prompt ─┬─ resume → active
                                                └─ discard → title
title ─ Settings → (back to title)
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

One screen at a time (`openScreen` in `native/main.ts`): a card over the key art, labelled for screen
readers, focusing its first control; Help and Settings opened from a round or the pause card go back
there. `Esc` resumes from pause, closes an overlay only when a live round is behind it, and
otherwise pauses — the title, mode select and results are never dismissed into an empty screen.

**Layouts** (picked each frame from the window's logical size, `native/screens.ts`).
- **≥1024 px:** three columns — 260 px objective/progress rail, the 3D stage, 300 px
  actions/tray/board rail. Left-handed layout swaps the rails' sides.
- **<1024 px:** the rails become drawers below the top bar, toggled by its ☰ and ✚ buttons, each with
  its own ✕ and a scrim that closes it; the stage takes the full width. In a lesson the current step
  shows under the HUD.
- **Portrait ≤700 px:** the four primary actions dock into a bottom tray; the goal thumbnail moves
  below the HUD.
- **Landscape ≤500 px tall:** no left rail (☰ opens it as a drawer), the right rail docks at 200 px and
  scrolls, no bottom tray.
- **≤420 px wide:** the top bar hides the clock and the title ellipsizes.
- **Large screens and text:** every size follows the runtime's interface and text size; the camera
  keeps the stage's aspect (`setViewOffset`), so the 3D view fills whatever the chrome leaves.

The safe area is respected by the whole layout. **Never cut off:** the HUD counters, the four action
buttons, the tray list, and the primary button of any screen. Cards cap at `min(560 px, width − 32)`
by 90 % of the height and scroll inside.

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
also carries a glyph — `▲ ◆ ● ■ ★ ✚` — drawn on the tile face and repeated in the tray and cell buttons, so
colour is never the only channel. A white tick on the tile's top edge makes rotation readable by
shape alone.

**Typography.** System UI stack throughout. Rail headings are 0.8 rem uppercase with 0.08 em
tracking; numerals in the HUD, score tables and leaderboards use `tabular-nums`. The runtime's text size
option scales all text.

**Motion.** Pieces critically damp toward their rules-derived target at 0.22 per 60 Hz frame (frame-rate independent) in position
and rotation, and toward a 0.55-unit lift when selected. Rotation takes the shorter angular path.
Nothing blocks input, and any state change re-targets mid-flight.

**Hero.** The lit board slab. One warm directional key (`#fff2e0`, intensity 2.4, soft PCF shadows)
against a cool hemisphere fill grounds the glazed tiles with contact shadows on a walnut desk; the
scene background is `#1d2028`.

**Graphics.** A warm directional key (`#fff2e0`) with soft shadows reaching over the board and tray, a
cool hemisphere fill, and a brass picture light over the goal frame (a spot light plus an over-bright
bulb strip) light the desk (r170 intensities). Output is sRGB with ACES
filmic tone mapping (exposure 1.05). Effects by graphics level: room-environment reflections
(`RoomEnvironment(renderer)` + PMREM at environment intensity 0.35) that turn the frame into polished
gilt and give the tiles a clear-coat glaze (`MeshPhysicalMaterial`); surface detail (walnut plank
grain on the desk, speckled stone on the slab, tray felt — baked from the old canvas painters by
`tools/bake-textures.mjs` — and glaze speckle, hairline crackle and a kiln edge painted on every tile
face); drifting dust in the lamp light and sparkle bursts when a tile is placed (a larger one when the
mosaic completes); and the post chain `renderer.ao` (GTAO contact shading), `renderer.bloom` (threshold
0.9: bulb strip, target rings, cursor, sparkles), `renderer.grade` (the old grade shader's S-curve,
saturation, split tint and vignette, in linear light before tone mapping) and `renderer.antialias`
(FXAA/SMAA/MSAA). The selected tile bobs gently and pulses a warm glow, target rings breathe and the
lamp shimmers faintly; all ambient motion stops under reduced motion. Tile faces are UV-mapped so the
whole face texture — glyph and orientation tick — covers the tile top.

**Graphics levels.** The runtime's Options (F1 › Graphics) choose the level (Auto from the device, or a
level the player picks), render scale, adaptive resolution, the frame-rate limit and readout. The
game maps the level's quality tier to the old presets (`native/quality.ts`):

| Budget | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Shadows | off | 1024² | 2048² | 4096² |
| Ambient occlusion | off | off | on | high |
| Bloom / grade | off | on | on | on |
| Anti-aliasing | MSAA | FXAA | SMAA | MSAA |
| Reflections, detail, particles | off | on | on | on |
| Tile shading | Lambert | Standard | glazed Physical clear coat | as High |
| Tile-face texture | 128 px | 256 px | 256 px | 512 px |
| Baked slab texture (desk wood 2× wide, felt ½) | — | 256 px | 512 px | 1024 px |
| Dust motes (×≤2 with the level inside the tier) | 0 | 70 | 110 | 180 |
| Bloom / GTAO resolution | ½ | ½ | ½ | full |

On Low the ghost cells take 3 % white instead of 10 %: three.js blended them in display space when Low
rendered without its composer, the engine always blends in linear light. The old per-effect overrides are
not offered (the runtime's levels replace them).

**Reduced motion.** The runtime's reduced-motion option sets the damping to 1.0 — pieces jump to their
exact end state — stops the ambient motion and sparkles, and shortens the results delay from 700 ms to
100 ms.

**Visual assets the design calls for.** (1) A photographic key-art plate of a restorer's desk strewn
with glazed tiles, sitting behind every overlay so the menus feel located in the fiction. (2) A
plaster gallery-wall plate for the scene's back wall. Both are listed in
§15. Nothing in either image carries text.

## 9. Audio direction

**Mix philosophy.** Ceramic and wood, quiet and dry. Every cue is under 400 ms except the two
round-end phrases and the achievement flourish. Nothing loops except a near-subliminal drone.

**Buses.** The runtime's: effects on `effects`, the menu click and back cues on `interface`, the
ambience on `music` (the runtime has no ambience bus); the old default levels (effects 0.85, ambience
0.4) are folded into each sound's gain. Volumes, mute and the voice limit are the runtime's Options. A
hidden window holds the ambience.

**Ambience.** Three detuned sine drones (110 / 165.2 / 220.7 Hz at 0.05 / 0.035 / 0.02 gain) start
on the first round, standing in for the room tone of a quiet gallery; they are rendered once into a
seamless ten-second loop (every partial completes whole cycles), in slices over several frames. There
is no music track.

**Loading.** Clips load once the mixer runs (natively at once, in a browser after the first press), one
at a time; a sample still loading is silent (the browser build's synthesized stand-ins are not ported).

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

**Languages:** en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT — every player-facing
string (shell labels, title and mode screens, lessons and their steps, journey/practice/challenge
lists, setup card, HUD, objective, announcements and rejection reasons, results, help, settings,
profile and achievements, leaderboards, sync status, resume prompt) ships in all nine.

**Where strings live:** `strings.js` holds the tables keyed by the English source text (en-GB, es-ES
and fr-CA list only their differences — *colour*, *Ajustes*, *pointage*). `native/i18n.ts` loads it
(`loadClassic`) and draws every string through `T()` each frame; content keys are marked with `N()` in
`content.js` and the native modules. Ruleset tags are shown as `cols×rows` plus a translated twist
(`rulesetLabel`), so `ruleset.label` stays a stable data id. The StarHermit account strings live in
`native/account.ts`. "Mosaic Pieces" and "StarHermit" stay untranslated.

**Language setting:** the runtime's Options › Language (the player's choice, else the account's
preferred language, else the device's) — `preferences().language`, mapped to the nearest shipped locale
(es-MX → es-419, en-AU → en-GB, fr → fr-FR, pt-PT → pt-BR). A change shows on the next frame without
ending the round. The browser build's own Language section (`sh-language.js`) and its `ui.language`
setting are retired (the legacy key is removed from the account's settings).

Layout is expansion-tolerant: nothing is sized to a string, long labels wrap or ellipsize, and every
number formatted for display is derived from an integer held in state.

## 11. Accessibility

- **Keyboard-only path.** Every screen is reachable and every round completable without a pointer:
  `Tab` to the tray buttons, arrows between them, `Enter` to select, `Tab` to the cell grid, arrows,
  `Enter` to place — or, with nothing focused, the board cursor (arrows, `Enter`). `R`/`H`/`U`/`Esc`/`C`
  and digits `1`–`9` work while a round is active.
- **Focus.** Screens focus their first control; the focus ring is a 3 px accent outline. A click or tap
  on a rail button hands the keys back to the board.
- **Screen readers.** Every widget is in the runtime's accessibility tree (natively UI Automation /
  AT-SPI, in browsers an ARIA mirror). Selection, placement, progress, lesson steps and the cursor are
  announced politely; rejections assertively. Every tray button names the piece number, its glyph and
  whether it is upright, rotated by *n* degrees, selected or placed; every cell button its position, its
  goal glyph, its occupant and whether it matches or is a legal target. The goal thumbnail and the
  playfield are labelled areas.
- **Contrast.** Body text on panel is `#eceef2` on `#343947` (≈ 10:1). The runtime's high-contrast option
  swaps in the old high-contrast tokens (black/white, `#ff0` accent, `#005fcc` buttons) and replaces the
  key art behind the screens with flat black.
- **Reduced motion, larger text, interface size.** The runtime's options; the game follows them.
- **Colour independence.** Glyphs duplicate every colour; Settings › Color-vision-safe palette forces the
  Gallery tile palette regardless of theme (the open round's tiles repaint at once).
- **Targets.** 44×44 px minimum on every button, tray tile, cell and control.
- **Other options** (Settings, the game's own): left-handed layout (swaps the rails' sides), timing
  assistance (doubles every time limit at round start, once — Play again starts from the content's limit).

## 12. StarHermit integration

`starhermit.txt` names the engine script game (`engine.*`), keeps `name`, `description`, `owner`,
`server=score-script.js` and `cover=cover.jpg`, and declares one `control.<action>` line per keyboard
action (lowercase action names; the old `navLeft`… list-navigation actions became the board cursor's
`left`/`right`/`up`/`down`, so players' old rebinds of those four do not carry over) plus `engine.gamepad.*`
defaults. Everything goes through the runtime's host modules (`starhermit:platform`, `starhermit:storage`);
the game never sees a token.

- *Player* — `player()`: signed in from the StarHermit client or the platform page; guests play locally.
  The title offers **Sign in with StarHermit** to guests (`requestSignIn`) and **Invite a friend** to
  players (copies `inviteLink()`, confirmed by a toast). The profile names the player
  (`displayName`). A session that ends shows the "signed out — playing locally" toast.
- *Cloud save* — the progress is the game's save (`saves`, schema 1), on the device and in the player's
  cloud slot, merged with another device's copy on a conflict (`saves.onConflict` → `mergeProgress`:
  further journey stage, union of achievements and days, larger total time, better personal best per
  board). The browser build's slot (`game:<slug>`, `{ v: 1, savedAt, progress, settings }`) shows as
  foreign: its progress is merged in, its options (theme, colour-vision palette, timing assistance,
  left-handed layout) adopted, and it is replaced once (`replaceForeign`). The top bar shows local save /
  saving… / cloud synced / offline.
- *Settings* — the game's own options are `settings` (synced with the account); the browser build's
  settings KV keys are migrated (`legacyKeys`/`legacy`) and then removed. Volumes, mute, graphics,
  language, reduced motion, high contrast and larger text are the runtime's Options; the old
  "hold-to-drag" option (stored but never wired up in the browser build) is not offered.
- *The round in progress* — device storage (`storage` key `session`), as the old `mp-session-v1`; a guest's
  old browser localStorage progress and round do not migrate (cloud saves do).
- *Clock* — `serverNow()` (platform clock, falling back to the device's UTC) for the Daily's date and the
  top bar's UTC clock.
- *Leaderboards* — the Leaderboards / Score chase screen reads the game's `high-score` board (guests too)
  with the player's row highlighted, plus personal bests from the save. Every completed Journey, Daily or
  Challenge round of a signed-in player posts its score through `score-script.js` (a practice session
  whose socket carries `{ type: 'result', scores: { 'high-score': n } }`; the script range-checks it,
  0–20,000, and writes the board), and the results card shows "Leaderboard rank: #N" (or "Score
  posted…" / "Score not posted…"). Learn and Practice post nothing. Scores are written only by the
  server script.
- *Report a problem and crash reports* — the runtime's own (F1).

**Not used.** Matchmaking, rooms, friends, chat, replays and voice — the game is single-player;
achievements stay in the save because no server script declares them. Every platform call degrades to
nothing, so the whole game — including the Daily — plays offline.

## 13. Technical architecture

**Layering.** `rules.js` depends on nothing. `content.js` and `progress.js` depend on `rules.js`.
`native/render.ts`, `native/screens.ts`, `native/audio.ts` and `native/platform.ts` consume snapshots;
`native/main.ts` is the only module that issues commands or mutates progression. `server.js` imports `rules.js` and `content.js` and
shares them with the client byte-for-byte, which is why replay validation is meaningful.

**Determinism and replay.** A round is fully described by `(seed, ruleset, mode, commandLog)`.
`Rules.replay` reconstructs it; `stateHash` provides a cheap comparison point. `validateSubmission`
rejects a claim unless: the board matches the mode, the mode is one of daily/challenge/journey, the
content version matches, the seed is an official daily seed (daily boards only), the replay reaches
`complete`, the replayed score equals the claimed score, and the client's `finalHash` matches.
Because rejected commands are also logged, an honest client's invalid-action penalty replays
exactly.

**Persistence.** The engine save holds the progress; device storage holds the serialized in-flight
round (written after every command and on a hidden window, cleared on any terminal state);
`settings` holds the game's options. `deserialize` refuses states from a newer schema and migrates v1
by starting a fresh 3×3 rather than guessing.

**Time.** The round clock advances on the runtime's fixed steps while a round is active, unpaused and
no screen is open (the old build counted wall time under Help and Settings); the state's `elapsedMs`
follows it every quarter second (`elapsed` commands), the time limit fires `timeup`, and lessons'
informational steps advance after 3.2 s of round time. A hidden window pauses the round.

**Performance budgets.** One scene pass per frame, plus the post chain when enabled; scene complexity is a slab, a tray, a desk, a wall
and one mesh per cell plus one ring per legal target, so a 6×6 stage stays well under 100 meshes.
Piece geometry and the extrude are shared across every tile of a puzzle; face textures are cached by
`(colour, glyph, detail)` in a module-level map and are never disposed with a mesh; the procedural
desk/slab/felt textures and the environment map are built once on first use. Graphics presets cap
The runtime caps the pixel ratio and adapts resolution.

**Dev server.** `server.js` (not packaged) serves the folder locally and exports `validateSubmission`
for the tests; its listener binds only when run directly.

## 14. Testing and acceptance criteria

`npm test` runs:
- `tests/run_tests.js` (524 assertions): puzzle generation and mirroring; legal actions and every
  invalid reason code; rotation rules; hints; terminal states for completion, move limit and time limit;
  the undo restriction in ranked modes; each scoring component; serialization, versioning and v1
  migration; replay determinism over many seeds; fuzzing of malformed commands; golden sessions;
  `validateAll` over all 46 content rows; `validateSubmission` accepting honest claims and rejecting
  stale content, wrong boards, bad seeds, score and hash mismatches.
- `node --test tests/progress.test.mjs` (the conflict merge, normalization, the old cloud document's
  conversion with its options, option validation) and `tests/i18n.test.mjs` (every key the native
  modules and content use is translated in every locale with placeholders and markup intact, no unused
  rows, regional overrides, the account strings in all nine locales).
- `node tests/native.mjs`: the web index matches the files (`npm run package` ran last), `tsc` (no
  `skipLibCheck`), `starhermit check .` with zero warnings, and every `tests/native/*.play` as a guest
  `--render-check` driving the real UI: `menus.play` (every screen, theme and left-handed settings, a
  Practice round with hints, help, pause, leave), `learn.play` (the three lessons by the mirror, R, H and
  U, to their results and the First Mosaic achievement), `journey.play` (stage 1 by a drag and clicks on
  the 3D desk and the board cursor, to its results and Next recommended), `challenge-phone.play`
  (390×844 @3: Perfect Fit by taps in the actions drawer, Play again, the bottom tray's Pause, Leave) and
  `landscape.play` (844×390 @3: the Daily by the rail's Hint button). `tools/gen-plays.mjs` writes all
  but `menus.play` from the rules.

`npm run test:browser` (`tools/browser-play.mjs`) serves the web package on loopback and plays it in
Chrome on the GPU (`~/games/tools/gpu-chrome.mjs`) at 1366×768 (Learn lesson 1 by the mirror with a page
reload mid-round answered by "Welcome back" → Resume round, then a Practice hint, pause and Leave), at
390×844 @3 (Perfect Fit by taps through the drawer to its results, Play again, Pause, Leave) and at 844×390
@3 (the Daily by Hint taps), failing on console errors or warnings, the runtime's error screen or a round
that does not finish.

**QA bar, as checkable statements.**
1. Every feature the UI exposes is reachable and usable with a mouse, a touch screen and a keyboard.
2. A complete round can be played, scored and repeated without opening the console.
3. No console errors or warnings at either viewport, natively or in a browser, including audio and network paths.
4. No text or control is clipped at 1280×800, 390×844 portrait, or 844×390 landscape.
5. Progress and settings survive a reload; an interrupted round is offered back.
6. The tray and cell buttons alone complete a round.
7. Every rejected action produces both an audible cue and a specific spoken reason.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/title-backdrop.webp` | Key art behind every overlay screen (1280×720, scrimmed) | FLUX.2 klein, seed 71904, 28 steps; WebP q80, 70 KB | generated in this pass |
| `assets/gallery-wall.webp` | Plaster texture on the scene's back wall (1024×512) | FLUX.2 klein, seed 40231, 28 steps; WebP q78, 20 KB | generated in this pass |
| `coverart.png` | Platform cover art (`cover=` in `starhermit.txt`) | prior pass | shipped |
| `icon.png`, `favicon.png`, `favicon.svg` | App icon and browser tab icons | prior pass | shipped |
| `assets/textures/wood-*.webp`, `stone-*.png`, `felt-*.png` | Desk grain, slab stone, tray felt per texture budget | baked from the old seeded canvas painters (`tools/bake-textures.mjs`) | shipped |
| `assets/ui-style.json` | The UI styles | `starhermit css tools/ui-style.css` | shipped |
| Particle sprite | Soft dot | canvas, `native/render.ts` | shipped |
| `sfx/piece-select.opus` … `sfx/ui-click.opus` (12 clips) | Core interaction, rejection, assist and round-end cues | MOSS-SoundEffect v2.0 | shipped |
| `sfx/menu-back.opus` | Back/close cue | MOSS-SoundEffect v2.0, 100 steps | generated in this pass |
| `sfx/round-start.opus` | Tray-dealt cue at round start | MOSS-SoundEffect v2.0, 100 steps | generated in this pass |
| `sfx/achievement-unlock.opus` | Achievement toast flourish | MOSS-SoundEffect v2.0, 100 steps | generated in this pass |
| Tile faces, goal image | Per-colour canvas textures with glyph and orientation tick; goal image drawn from the solved board (also the HUD's goal thumbnail) | procedural, `native/render.ts` | shipped |
| 3D models | — | — | not called for: every prop is a primitive or an extruded rounded rect, and a scanned tile would be less legible than the glyph-bearing procedural face |
| Character animation | — | — | not called for: no humanoid or animated character exists |

## 16. Known limitations

- The goal image hangs in a framed canvas on the back wall, but the camera frames the board and tray, so
  on most boards the frame sits above the view; the always-visible goal thumbnail at the stage's top end
  shows it instead.
- The `place` event and `piece-place.opus` are bound but never triggered: every accepted placement
  plays `snap` (as in the browser build).
- The "Score chase" entry promises friends comparison; only the global `high-score` board (plus personal
  bests) is shown, and daily results share that board with Journey and Challenge.
- Daily dates use the platform clock when it has answered, else the device's UTC date.
- A resumed lesson restarts its step list (as in the browser build).
- Signed-in paths (foreign-save migration, legacy settings, score posting) are covered by unit tests of
  their logic, not live-tested.

## 17. Design intent not yet implemented

- **Hold-to-drag.** Intent: an option where a drag requires a press-and-hold dwell before the piece
  detaches, for players who scroll and drag with the same finger (the browser build stored such an
  option without wiring it up; it is not offered).
