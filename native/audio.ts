// Sound, as the browser build's audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per logical event, and the quiet
// ambience of three slow detuned sines (110, 165.2 and 220.7 Hz) that starts
// with the first round and keeps going.
//
// The browser build's four buses become the runtime's (Options › Audio owns
// the volumes, the mute and the voice limit): effects → "effects", the menu
// click and back cues → "interface", the ambience plays on "music" (the
// runtime has no ambience bus); the old default bus levels (effects 85 %,
// ambience 40 %) are folded into each sound's gain. The drone is rendered
// once into a seamless ten-second loop (every partial completes whole cycles
// in it), in slices over several frames: a live synthesis graph makes clip
// loads fail on the engine's web runtime. The synthesized blips the browser
// build played while a sample decoded are not ported, so a sample still
// loading is silent. Clips load once the mixer runs (natively at once, in a
// browser after the first press), one at a time. A hidden window holds the
// ambience (audio.js suspended its context on visibilitychange).
import { context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";

const LEVEL = { effects: 0.85, ambience: 0.4 };
/** audio.js SFX: event → sample. */
const SFX: Record<string, string> = {
  select: "piece-select", pickup: "piece-pickup", place: "piece-place", snap: "piece-snap", rotate: "piece-rotate",
  invalid: "invalid-move", hint: "hint-reveal", undo: "undo-move", complete: "round-complete", fail: "round-fail",
  tick: "timer-tick", ui: "ui-click", back: "menu-back", roundstart: "round-start", achieve: "achievement-unlock",
};
const INTERFACE = new Set(["ui", "back"]);

const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;

function load(name: string): void { if (!queue.includes(name) && !clips.has(name)) queue.push(name); }
function pump(): void {
  if (loading || !queue.length) return;
  const name = queue.shift()!;
  loading = true;
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
}
/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }
/** A hidden window holds the ambience. */
export function setSuspended(on: boolean): void { suspended = on; }

/** audio.js playEvent(): an event's sample (once loaded). */
export function playEvent(name: string): void {
  const file = SFX[name];
  if (!file || suspended) return;
  const clip = clips.get(file);
  if (!clip) return;
  const bus: Bus = INTERFACE.has(name) ? "interface" : "effects";
  try { playClip(clip, { bus, gain: LEVEL.effects }); }
  catch { clips.delete(file); load(file); } // a clip the mixer lost: load it again
}

// -- the ambience: three sines rendered into one ten-second loop --------------------------------------
const RATE = 22050;
const LOOP = 10 * RATE;
const DRONE: [number, number][] = [[110, 0.05], [165.2, 0.035], [220.7, 0.02]];
const SLICE = 22050;
let drone: Float32Array | null = null;
let rendered = 0;
let droneClip: AudioClip | null = null;
let ambienceOn = false;
let ambienceSound: Sound | null = null;
/** audio.js startAmbience: on the first round, then for good. */
export function startAmbience(): void { ambienceOn = true; }
function renderSlice(): void {
  if (!drone) drone = new Float32Array(LOOP);
  const end = Math.min(LOOP, rendered + SLICE);
  for (let i = rendered; i < end; i++) {
    const t = i / RATE;
    let v = 0;
    for (const [f, g] of DRONE) v += Math.sin(2 * Math.PI * f * t) * g;
    drone[i] = v;
  }
  rendered = end;
  if (rendered >= LOOP) { droneClip = createClip([drone], RATE); drone = null; }
}

/** Each frame: the samples once the mixer runs (one at a time), then the drone rendered a slice a frame, then
 * the ambience on or off. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const name of Object.values(SFX)) load(name);
    return;
  }
  pump();
  if (loading || queue.length) return;
  if (!droneClip) { if (ambienceOn) renderSlice(); return; }
  try {
    const on = ambienceOn && !suspended;
    if (on && !ambienceSound) ambienceSound = playClip(droneClip, { bus: "music", gain: LEVEL.ambience, loop: true });
    else if (!on && ambienceSound) { ambienceSound.stop(); ambienceSound = null; }
  } catch (e) { console.warn(`audio: ${String(e)}`); }
}
