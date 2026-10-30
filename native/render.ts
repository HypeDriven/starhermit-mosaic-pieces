// The gallery desk on starhermit:scene, as the browser build's render.js drew
// it with three.js r170: the wooden desk, the plaster gallery wall with the
// gilt frame holding the puzzle's goal picture and the brass picture light
// above it (its bulb strip the bloom source, a faint lamp shimmer), the stone
// board slab with its ghost cells, the felt tray (wrapping into more rows on
// narrow views), the bevelled ceramic tiles (palette colour, glyph and an
// orientation tick; a glaze of speckle, crackle and a kiln edge when
// detailed), the glowing legal-target rings, the lifted and gently bobbing
// selected tile with its warm glow pulse, the critically damped snap into a
// cell or back to the tray, placement sparkles and the dust in the lamp light,
// and the authored camera framing board, tray and goal picture on both axes.
// Rendering reads rules state and never writes it.
//
// From three.js r170 (engine.minor 28): light intensities, shadow bias and box as render.js set them;
// RoomEnvironment(renderer) + PMREM give the reflections at the old
// environmentIntensity 0.35; the composer chain (GTAO, UnrealBloom threshold
// 0.9, the GradeShader before tone mapping, FXAA / SMAA / MSAA) is
// renderer.ao / bloom / grade / antialias; the orthographic shadow box is
// render.js's, fitted to the board and tray; the procedural wood, stone and felt are
// baked (tools/bake-textures.mjs) while the tile faces still paint on a canvas.
// The playfield sits between the top bar, the rails and the bottom tray as the
// old <canvas> did: the camera keeps the playfield's aspect and is offset into
// its rectangle with setViewOffset (framing is solved on a probe camera of the
// same aspect), so picking takes window coordinates. Adaptive resolution, the
// pixel-ratio cap and the frame-rate readout are the runtime's.
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry,
  DirectionalLight, ExtrudeGeometry, HemisphereLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Points, PointsMaterial, Raycaster, RepeatWrapping,
  RingGeometry, RoomEnvironment, Shape, ShapeGeometry, SpotLight, SRGBColorSpace, TextureLoader, Vector2, Vector3, renderer, scene,
  type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas } from "starhermit:canvas";
import { frame } from "starhermit:engine";
import { Rules, type State, type Ruleset } from "./game.ts";
import { DUST_MAX, type Look } from "./quality.ts";

export const FRAMING = { fov: 35, distance: 26, pitch: 0.62, trayGap: 2.2 };
export const CELL = 1.7; // world units per board cell
export const GLYPHS = ["▲", "◆", "●", "■", "★", "✚"]; // shape reinforces color (CVD-safe)
const PI = Math.PI;
const TILE = CELL * 0.88, TILE_BEVEL = 0.05;
const RING_COLOR = new Color(0x7dff9a);

renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
scene.background = new Color(0x1d2028);
const camera = new PerspectiveCamera(FRAMING.fov, 1, 0.1, 200);
renderer.camera = camera;
/** Solves the framing at the playfield's aspect without the view offset. */
const probe = new PerspectiveCamera(FRAMING.fov, 1, 0.1, 200);

let look: Look | null = null;
let reducedMotion = false;
let time = 0;

function roundedRectShape(size: number, r: number): Shape {
  const s = size / 2, g = new Shape();
  g.moveTo(-s + r, -s);
  g.lineTo(s - r, -s); g.quadraticCurveTo(s, -s, s, -s + r);
  g.lineTo(s, s - r); g.quadraticCurveTo(s, s, s - r, s);
  g.lineTo(-s + r, s); g.quadraticCurveTo(-s, s, -s, s - r);
  g.lineTo(-s, -s + r); g.quadraticCurveTo(-s, -s, -s + r, -s);
  return g;
}
/** Small deterministic PRNG so the glaze looks the same every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// -- tile faces: palette colour, glyph and an orientation tick; `detailed` adds the glaze ------------------
const texCache = new Map<string, Texture>();
function pieceTexture(color: string, glyph: string, detailed: boolean, size: number): Texture {
  const key = color + glyph + (detailed ? "d" : "p") + size;
  const have = texCache.get(key);
  if (have) return have;
  const c = new OffscreenCanvas(size, size);
  const x = c.getContext("2d");
  x.scale(size / 256, size / 256);
  const W = 256;
  x.fillStyle = color;
  x.fillRect(0, 0, W, W);
  const grad = x.createRadialGradient(W * 0.38, W * 0.32, W * 0.08, W / 2, W / 2, W * 0.78);
  grad.addColorStop(0, detailed ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(0,0,0,0.25)");
  x.fillStyle = grad;
  x.fillRect(0, 0, W, W);
  if (detailed) {
    const r = rng(color.length * 131 + glyph.charCodeAt(0));
    // speckle in the glaze
    for (let i = 0; i < 900; i++) {
      x.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
      x.fillRect(r() * W, r() * W, 1 + r() * 2, 1 + r() * 2);
    }
    // hairline crackle
    x.strokeStyle = "rgba(0,0,0,0.10)";
    x.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      let px = r() * W, py = r() * W;
      x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 5; k++) { px += (r() - 0.5) * 60; py += (r() - 0.5) * 60; x.lineTo(px, py); }
      x.stroke();
    }
    // kiln edge
    const edge = x.createRadialGradient(W / 2, W / 2, W * 0.42, W / 2, W / 2, W * 0.72);
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(1, "rgba(0,0,0,0.22)");
    x.fillStyle = edge;
    x.fillRect(0, 0, W, W);
  }
  x.fillStyle = "rgba(20,20,28,0.78)";
  x.font = `bold ${Math.round(W * 0.5)}px system-ui, sans-serif`;
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(glyph, W / 2, W * 0.53);
  // orientation tick at the top edge so rotation is readable by shape too
  x.fillStyle = "rgba(255,255,255,0.9)";
  x.fillRect(W * 0.43, W * 0.06, W * 0.14, W * 0.06);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
function softDotTexture(): Texture {
  const c = new OffscreenCanvas(64, 64);
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// -- the goal picture hanging on the wall (also the HUD's goal thumbnail) ------------------------------
export const goalCanvas = new OffscreenCanvas(512, 348);
const goalTex = new CanvasTexture(goalCanvas);
goalTex.colorSpace = SRGBColorSpace;
function paintGoal(state: State, palette: string[]): void {
  const rs = state.ruleset;
  const x = goalCanvas.getContext("2d");
  const cw = goalCanvas.width, ch = goalCanvas.height;
  x.clearRect(0, 0, cw, ch);
  x.fillStyle = "#11131a";
  x.fillRect(0, 0, cw, ch);
  const pad = 18;
  const size = Math.min((cw - pad * 2) / rs.cols, (ch - pad * 2) / rs.rows);
  const ox = (cw - size * rs.cols) / 2, oy = (ch - size * rs.rows) / 2;
  x.textAlign = "center"; x.textBaseline = "middle";
  for (const p of state.pieces) {
    const cx = ox + (p.id % rs.cols) * size, cy = oy + Math.floor(p.id / rs.cols) * size;
    x.fillStyle = palette[p.colorIndex % palette.length]!;
    x.fillRect(cx + 1, cy + 1, size - 2, size - 2);
    x.fillStyle = "rgba(20,20,28,0.72)";
    x.font = `bold ${Math.round(size * 0.5)}px system-ui, sans-serif`;
    x.fillText(GLYPHS[p.colorIndex % GLYPHS.length]!, cx + size / 2, cy + size / 2 + size * 0.03);
  }
  goalTex.needsUpdate = true;
}
/** Whether the goal picture shows a puzzle (the HUD thumbnail draws it then). */
export let goalReady = false;

// -- lights: one dominant key + soft fill + the picture light ------------------------------------------
const keyLight = new DirectionalLight(0xfff2e0, 2.4);
keyLight.position.set(6, 10, 8);
keyLight.shadow.mapSize = 1024;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight, keyLight.target);
const hemi = new HemisphereLight(0x8899bb, 0x33241c, 0.85);
scene.add(hemi);

// -- the room ----------------------------------------------------------------------------------------
const loader = new TextureLoader();
const deskMat = new MeshStandardMaterial({ color: 0x4a3527, roughness: 0.82, metalness: 0.05 });
const desk = new Mesh(new BoxGeometry(60, 1.4, 40), deskMat);
desk.position.y = -1.15;
desk.receiveShadow = true;
scene.add(desk);
// Wall backdrop with the photographic plaster texture; the flat colour stays if it fails to load.
const wallMat = new MeshStandardMaterial({ color: 0x272b36, roughness: 0.95 });
const wall = new Mesh(new PlaneGeometry(80, 40), wallMat);
wall.position.set(0, 12, -16);
wall.receiveShadow = true;
scene.add(wall);
loader.load("assets/gallery-wall.webp", (tex) => {
  tex.colorSpace = SRGBColorSpace;
  wallMat.map = tex;
  wallMat.color.set(0xffffff);
}, undefined, (e: unknown) => console.warn(`gallery wall: ${e instanceof Error ? e.message : String(e)}`));
const frameMat = new MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.5, metalness: 0.4 });
const pictureFrame = new Mesh(new BoxGeometry(20, 14, 0.5), frameMat);
pictureFrame.position.set(0, 12, -15.7);
pictureFrame.castShadow = true;
scene.add(pictureFrame);
const artMat = new MeshStandardMaterial({ color: 0x11131a, roughness: 0.9 });
const artMesh = new Mesh(new PlaneGeometry(18.6, 12.6), artMat);
artMesh.position.set(0, 12, -15.4);
scene.add(artMesh);
// Brass picture light above the frame: its bulb strip is the bloom source.
const lampArm = new Mesh(new CylinderGeometry(0.22, 0.22, 11, 20), frameMat);
lampArm.rotation.z = PI / 2;
lampArm.position.set(0, 19.6, -14.9);
scene.add(lampArm);
const bulb = new Mesh(new BoxGeometry(10.4, 0.12, 0.2), new MeshBasicMaterial({ color: new Color(1.0, 0.86, 0.62).multiplyScalar(2.6) }));
bulb.position.set(0, 19.35, -14.75);
scene.add(bulb);
const PIC_INTENSITY = 90;
const picLight = new SpotLight(0xffe2b8, PIC_INTENSITY, 30, 0.62, 0.6, 1.6);
picLight.position.set(0, 19.2, -13.6);
picLight.target.position.set(0, 11, -15.4);
scene.add(picLight, picLight.target);

// -- particles: dust in the lamp light, placement sparkles (colours above 1 so they bloom) --------------
const dot = softDotTexture();
const dustSeed = new Float32Array(DUST_MAX);
const dustGeo = new BufferGeometry();
{
  const r = rng(5), pos = new Float32Array(DUST_MAX * 3);
  for (let i = 0; i < DUST_MAX; i++) {
    pos[i * 3] = (r() - 0.5) * 26; pos[i * 3 + 1] = 0.6 + r() * 11; pos[i * 3 + 2] = -12 + r() * 22;
    dustSeed[i] = r() * 100;
  }
  dustGeo.setAttribute("position", new BufferAttribute(pos, 3));
}
const dust = new Points(dustGeo, new PointsMaterial({
  map: dot, size: 0.09, color: 0xffe6c4, transparent: true, opacity: 0.42, blending: AdditiveBlending, depthWrite: false,
}));
dust.frustumCulled = false;
dust.visible = false;
scene.add(dust);
let dustCount = 110;
const SPARKS = 240;
const sparkGeo = new BufferGeometry();
sparkGeo.setAttribute("position", new BufferAttribute(new Float32Array(SPARKS * 3).fill(-999), 3));
sparkGeo.setAttribute("color", new BufferAttribute(new Float32Array(SPARKS * 3), 3));
const sparkVel = new Float32Array(SPARKS * 3);
const sparkLife = new Float32Array(SPARKS);
let sparkNext = 0;
let sparksDirty = false;
const sparks = new Points(sparkGeo, new PointsMaterial({
  map: dot, size: 0.22, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false,
}));
sparks.frustumCulled = false;
sparks.visible = false;
scene.add(sparks);

function burst(at: Vector3, count: number, spread: number): void {
  if (!sparks.visible || reducedMotion) return;
  const p = (sparkGeo.attributes.position as BufferAttribute).array as Float32Array;
  for (let k = 0; k < count; k++) {
    const i = sparkNext; sparkNext = (i + 1) % SPARKS;
    const a = Math.random() * PI * 2, sp = (0.6 + Math.random()) * spread;
    p[i * 3] = at.x + Math.cos(a) * 0.3; p[i * 3 + 1] = at.y + 0.3; p[i * 3 + 2] = at.z + Math.sin(a) * 0.3;
    sparkVel[i * 3] = Math.cos(a) * sp; sparkVel[i * 3 + 1] = 2.2 + Math.random() * 2.2; sparkVel[i * 3 + 2] = Math.sin(a) * sp;
    sparkLife[i] = 0.7 + Math.random() * 0.5;
  }
}
function updateParticles(dt: number): void {
  if (dust.visible && !reducedMotion) {
    const p = (dustGeo.attributes.position as BufferAttribute).array as Float32Array, t = time;
    for (let i = 0; i < dustCount; i++) {
      const s = dustSeed[i]!;
      p[i * 3] = p[i * 3]! + Math.sin(t * 0.3 + s) * 0.004;
      p[i * 3 + 1] = p[i * 3 + 1]! + 0.05 * dt;
      p[i * 3 + 2] = p[i * 3 + 2]! + Math.cos(t * 0.25 + s * 1.3) * 0.004;
      if (p[i * 3 + 1]! > 11.6) p[i * 3 + 1] = 0.6;
    }
    (dustGeo.attributes.position as BufferAttribute).needsUpdate = true;
  }
  if (sparks.visible) {
    const p = (sparkGeo.attributes.position as BufferAttribute).array as Float32Array;
    const c = (sparkGeo.attributes.color as BufferAttribute).array as Float32Array;
    let any = false;
    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i]! <= 0) continue;
      any = true;
      sparkLife[i] = sparkLife[i]! - dt;
      sparkVel[i * 3 + 1] = sparkVel[i * 3 + 1]! - 7 * dt;
      p[i * 3] = p[i * 3]! + sparkVel[i * 3]! * dt; p[i * 3 + 1] = p[i * 3 + 1]! + sparkVel[i * 3 + 1]! * dt; p[i * 3 + 2] = p[i * 3 + 2]! + sparkVel[i * 3 + 2]! * dt;
      const k = Math.max(0, sparkLife[i]!) * 2.4;
      c[i * 3] = k * 1.0; c[i * 3 + 1] = k * 0.85; c[i * 3 + 2] = k * 0.55;
      if (sparkLife[i]! <= 0) { p[i * 3 + 1] = -999; c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 0; }
    }
    if (any || sparksDirty) {
      (sparkGeo.attributes.position as BufferAttribute).needsUpdate = true;
      (sparkGeo.attributes.color as BufferAttribute).needsUpdate = true;
    }
    sparksDirty = any;
  }
}

// -- the puzzle --------------------------------------------------------------------------------------
interface Target { pos: Vector3; rot: number; lift: number }
interface PieceView { mesh: Mesh; color: string; glyph: string; selected: boolean }
const pieces = new Map<number, PieceView>();
const targets = new Map<number, Target>();
let ghostMeshes: Mesh[] = [];
let markerMeshes: Mesh[] = [];
let puzzleMeshes: Mesh[] = [];
let slabMat: MeshStandardMaterial | null = null;
let trayMat: MeshStandardMaterial | null = null;
let trayMesh: Mesh | null = null;
let boardDepth = 6;
let placedSet = new Set<number>();
let framed: State | null = null;
let ruleset: Ruleset | null = null;
const markerGeo = new RingGeometry(0.32, 0.5, 32);
markerGeo.rotateX(-PI / 2);
// The board cursor (the browser build's gamepad cursor cell, now shown): a square ring around its cell.
const cursorGeo = new RingGeometry(CELL * 0.5, CELL * 0.56, 4, 1, PI / 4);
cursorGeo.rotateX(-PI / 2);
const cursorMesh = new Mesh(cursorGeo, new MeshBasicMaterial({ color: new Color(0xffd166).multiplyScalar(1.4), transparent: true, opacity: 0.9, depthWrite: false }));
cursorMesh.visible = false;
scene.add(cursorMesh);

export function cellPos(rs: Ruleset, cell: number): Vector3 {
  const x = cell % rs.cols, y = Math.floor(cell / rs.cols);
  const w = rs.cols * CELL, h = rs.rows * CELL;
  return new Vector3(-w / 2 + CELL / 2 + x * CELL, 0, -h / 2 + CELL / 2 + y * CELL - FRAMING.trayGap / 2);
}
function trayPos(index: number, total: number): Vector3 {
  const spacing = CELL * 1.06; // pieces are ~CELL*0.9 wide incl. bevel
  const perRow = trayPerRow(total);
  const row = Math.floor(index / perRow);
  const col = index % perRow;
  const w = perRow * spacing;
  return new Vector3(-w / 2 + spacing / 2 + col * spacing, 0, boardDepth / 2 + FRAMING.trayGap + row * spacing);
}
/** Tray columns per row: 10 on wide views, fewer on narrow ones so every tile face stays fully visible. */
function trayPerRow(total: number): number {
  const aspect = pf.w > 0 && pf.h > 0 ? pf.w / pf.h : 1.6;
  const max = aspect < 0.8 ? 4 : aspect < 1.2 ? 6 : 10;
  return Math.max(1, Math.min(total, max));
}

function dispose(m: Mesh, shared: Set<unknown>): void {
  scene.remove(m);
  if (!shared.has(m.geometry)) m.geometry.dispose();
  for (const mat of ([] as Material[]).concat(m.material)) if (!shared.has(mat)) mat.dispose();
}
/** Tile shading per the look's budget: Lambert on Low, Standard on Balanced, glazed Physical on High/Ultra. */
function pieceMaterial(color: string, glyph: string): Material {
  const detailed = !!look?.detailed;
  const b = look?.budget;
  const map = pieceTexture(color, glyph, detailed, b?.tile ?? 256);
  if (!b || b.material === "lambert") return new MeshLambertMaterial({ map, emissive: 0x000000 });
  if (look!.reflections && b.material === "physical") {
    // glazed ceramic: clear lacquer over a satin body
    return new MeshPhysicalMaterial({ map, roughness: 0.45, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.14, envMapIntensity: 1.0, emissive: 0x000000 });
  }
  return new MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.05, emissive: 0x000000 });
}
/** The ghost cells' 10 % white. three.js blended it in linear light behind the composer (Balanced and up) but in
 * display space when Low rendered straight to the canvas; the engine always blends in linear light, so Low takes
 * the opacity that gives the old display-space tint over the slab. */
function ghostOpacity(): number { return look && !look.bloom && !look.grade && look.ao === "off" ? 0.03 : 0.10; }
function rebuildPieceMaterials(): void {
  for (const v of pieces.values()) {
    (v.mesh.material as Material).dispose();
    v.mesh.material = pieceMaterial(v.color, v.glyph);
  }
}

let pieceGeo: BufferGeometry | null = null;
let cellGeo: BufferGeometry | null = null;
/** Builds the scene for a new puzzle (render.js buildPuzzle); `paletteTheme` picks the tile colours. */
export function buildPuzzle(state: State, paletteTheme: string): void {
  const shared = new Set<unknown>([pieceGeo, cellGeo, markerGeo]);
  for (const v of pieces.values()) dispose(v.mesh, shared);
  for (const m of [...puzzleMeshes, ...ghostMeshes, ...markerMeshes]) dispose(m, shared);
  pieces.clear(); targets.clear(); puzzleMeshes = []; ghostMeshes = []; markerMeshes = [];
  const rs = state.ruleset;
  ruleset = rs;
  boardDepth = rs.rows * CELL;
  const palette = Rules.PALETTES[paletteTheme] ?? Rules.PALETTES.default!;

  // board slab
  slabMat = new MeshStandardMaterial({ color: 0x2e3340, roughness: 0.6, metalness: 0.15 });
  const slab = new Mesh(new BoxGeometry(rs.cols * CELL + 0.8, 0.4, rs.rows * CELL + 0.8), slabMat);
  slab.position.set(0, -0.22, -FRAMING.trayGap / 2);
  slab.receiveShadow = true;
  slab.castShadow = true;
  scene.add(slab);
  puzzleMeshes.push(slab);
  if (!cellGeo) {
    cellGeo = new ShapeGeometry(roundedRectShape(CELL * 0.92, 0.18));
    cellGeo.rotateX(-PI / 2);
  }
  const n = rs.cols * rs.rows;
  for (let c = 0; c < n; c++) {
    const ghost = new Mesh(cellGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: ghostOpacity(), depthWrite: false }));
    ghost.position.copy(cellPos(rs, c));
    ghost.position.y = 0.01;
    scene.add(ghost);
    ghostMeshes.push(ghost);
  }
  // tray strip, re-sized to the tray layout whenever the camera is framed
  trayMat = new MeshStandardMaterial({ color: 0x232733, roughness: 0.7 });
  trayMesh = new Mesh(new BoxGeometry(1, 0.25, 1), trayMat);
  trayMesh.receiveShadow = true;
  scene.add(trayMesh);
  puzzleMeshes.push(trayMesh);
  applyDetail();

  // pieces: shared bevelled geometry, UVs mapped so each face shows the whole texture
  if (!pieceGeo) {
    const geo = new ExtrudeGeometry(roundedRectShape(TILE, 0.2), { depth: 0.28, bevelEnabled: true, bevelSize: TILE_BEVEL, bevelThickness: 0.05, bevelSegments: 3 });
    const half = TILE / 2 + TILE_BEVEL;
    const posA = geo.attributes.position as BufferAttribute, uvA = geo.attributes.uv as BufferAttribute;
    for (let i = 0; i < posA.count; i++) uvA.setXY(i, (posA.getX(i) + half) / (2 * half), (posA.getY(i) + half) / (2 * half));
    uvA.needsUpdate = true;
    geo.rotateX(-PI / 2);
    pieceGeo = geo;
  }
  placedSet = new Set(state.pieces.filter((p) => p.placed).map((p) => p.id));
  for (const p of state.pieces) {
    const color = palette[p.colorIndex % palette.length]!;
    const glyph = GLYPHS[p.colorIndex % GLYPHS.length]!;
    const mesh = new Mesh(pieceGeo, pieceMaterial(color, glyph));
    mesh.userData.pieceId = p.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const tp = p.placed ? cellPos(rs, p.placedCell).setY(0.06) : trayPos(state.tray.indexOf(p.id), state.tray.length);
    mesh.position.copy(tp);
    mesh.rotation.y = -(p.placed ? p.placedRot : p.rot) * PI / 2;
    scene.add(mesh);
    pieces.set(p.id, { mesh, color, glyph, selected: false });
    targets.set(p.id, { pos: tp.clone(), rot: mesh.rotation.y, lift: 0 });
  }
  // hang this puzzle's goal image in the frame on the wall
  paintGoal(state, palette);
  artMat.map = goalTex;
  artMat.color.set(0xffffff); // the base tint would darken the mapped art
  goalReady = true;
  framed = state;
  frameKey = "";
}

let frameKey = "";
/** Fits board, tray and goal-picture corners into the playfield (render.js _frameCamera). */
function frameCamera(state: State): void {
  const rs = state.ruleset;
  const total = rs.cols * rs.rows;
  const perRow = trayPerRow(total);
  const trayRows = Math.ceil(total / perRow);
  const spacing = CELL * 1.06;
  const boardW = rs.cols * CELL, boardD = rs.rows * CELL;
  const trayW = perRow * spacing;
  const zTop = -boardD / 2 - FRAMING.trayGap / 2 - 0.6;
  const zBottom = boardD / 2 + FRAMING.trayGap + (trayRows - 0.5) * spacing + 0.9;
  const halfW = Math.max(boardW, trayW) / 2 + 0.7;
  if (trayMesh) {
    trayMesh.scale.set(trayW + 0.8, 1, trayRows * spacing + 0.7);
    trayMesh.position.set(0, -0.32, boardD / 2 + FRAMING.trayGap + (trayRows - 1) * spacing / 2);
  }
  // key-light shadows fitted to the play area (board + tray)
  const cz = (zTop + zBottom) / 2;
  const radius = Math.hypot(halfW, (zBottom - zTop) / 2) + 1.2;
  const dir = new Vector3(6, 10, 8).normalize();
  keyLight.target.position.set(0, 0, cz);
  keyLight.position.set(0, 0, cz).addScaledVector(dir, 30);
  const sc = keyLight.shadow.camera as OrthographicCamera;
  sc.left = -radius; sc.right = radius; sc.top = radius; sc.bottom = -radius; sc.near = 30 - radius - 2; sc.far = 30 + radius + 2;
  sc.updateProjectionMatrix();
  const pts: Vector3[] = [];
  for (const x of [-halfW, halfW]) { pts.push(new Vector3(x, 0, zTop)); pts.push(new Vector3(x, 0.6, zBottom)); }
  const lookAt = new Vector3(0, 1.5, cz);
  const vdir = new Vector3(0, FRAMING.pitch, 0.72).normalize();
  let d = Math.max(15, (zBottom - zTop) * 1.3, halfW * 2 * 1.5);
  const v = new Vector3();
  probe.aspect = pf.w > 0 && pf.h > 0 ? pf.w / pf.h : 1.6;
  probe.updateProjectionMatrix();
  for (let i = 0; i < 12; i++) {
    probe.position.copy(lookAt).addScaledVector(vdir, d);
    probe.lookAt(lookAt);
    probe.updateMatrixWorld();
    let worst = 0;
    for (const p of pts) { v.copy(p).project(probe); worst = Math.max(worst, Math.abs(v.x) / 0.94, Math.abs(v.y) / 0.9); }
    if (worst <= 1) break;
    d *= Math.min(1.5, worst + 0.01);
  }
  camera.position.copy(lookAt).addScaledVector(vdir, d);
  camera.lookAt(lookAt);
  // the tray layout may have changed with the aspect: re-place the tray pieces
  for (const p of state.pieces) {
    if (p.placed) continue;
    const t = targets.get(p.id);
    if (t) t.pos.copy(trayPos(state.tray.indexOf(p.id), state.tray.length));
  }
}
/** The C key: back to the authored framing. */
export function resetCamera(): void { frameKey = ""; }

/** Syncs visuals from a rules snapshot (render.js update): targets, lift, the placement sparkles. */
export function sync(state: State): void {
  const rs = state.ruleset;
  let newlyPlaced = 0;
  for (const p of state.pieces) {
    const v = pieces.get(p.id);
    const t = targets.get(p.id);
    if (!v || !t) continue;
    if (p.placed) {
      t.pos.copy(cellPos(rs, p.placedCell));
      t.pos.y = 0.06;
      t.rot = -p.placedRot * PI / 2;
      if (!placedSet.has(p.id)) { placedSet.add(p.id); burst(t.pos, 14, 1.2); newlyPlaced++; }
    } else {
      if (dragging !== p.id) t.pos.copy(trayPos(state.tray.indexOf(p.id), state.tray.length));
      t.rot = -p.rot * PI / 2;
      placedSet.delete(p.id);
    }
    t.lift = state.selected === p.id ? 0.55 : 0;
    v.selected = state.selected === p.id;
  }
  if (newlyPlaced && state.status === "complete") {
    for (let c = 0; c < rs.cols * rs.rows; c += 1) burst(cellPos(rs, c), 6, 2.2);
  }
  framed = state;
}

/** The glowing legal-target rings (slightly over-bright so bloom gives them a halo). */
export function showLegalTargets(cells: number[]): void {
  const rs = ruleset;
  for (const m of markerMeshes) { scene.remove(m); (m.material as Material).dispose(); }
  markerMeshes = [];
  if (!rs) return;
  for (const c of cells) {
    const m = new Mesh(markerGeo, new MeshBasicMaterial({ color: RING_COLOR.clone().multiplyScalar(1.6), transparent: true, opacity: 0.85, depthWrite: false }));
    m.position.copy(cellPos(rs, c));
    m.position.y = 0.03;
    scene.add(m);
    markerMeshes.push(m);
  }
}
/** The board cursor's cell (-1: hidden). */
export function setCursor(cell: number): void {
  if (cell < 0 || !ruleset) { cursorMesh.visible = false; return; }
  cursorMesh.position.copy(cellPos(ruleset, cell));
  cursorMesh.position.y = 0.04;
  cursorMesh.visible = true;
}
/** Hides the puzzle (the title, menus without a round). */
export function clearPuzzle(): void {
  const shared = new Set<unknown>([pieceGeo, cellGeo, markerGeo]);
  for (const v of pieces.values()) dispose(v.mesh, shared);
  for (const m of [...puzzleMeshes, ...ghostMeshes, ...markerMeshes]) dispose(m, shared);
  pieces.clear(); targets.clear(); puzzleMeshes = []; ghostMeshes = []; markerMeshes = [];
  framed = null; ruleset = null; goalReady = false; trayMesh = null; slabMat = null; trayMat = null;
  cursorMesh.visible = false;
}

// -- picking and dragging ----------------------------------------------------------------------------
const raycaster = new Raycaster();
const ndc = new Vector2();
let dragging: number | null = null;
function toNdc(x: number, y: number): boolean {
  const f = frame();
  if (f.width <= 0 || f.height <= 0 || pf.w <= 0) return false;
  ndc.set((x / f.width) * 2 - 1, -(y / f.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return true;
}
export function insidePlayfield(x: number, y: number): boolean { return pf.w > 0 && x >= pf.x && y >= pf.y && x <= pf.x + pf.w && y <= pf.y + pf.h; }
/** A tray piece or a board cell under a window point (render.js pick); placed pieces are part of the picture. */
/** `exclude`: a piece the pointer carries (a drag's release looks through it to the cell below). */
export function pick(state: State, x: number, y: number, exclude: number | null = null): { kind: "piece"; pieceId: number } | { kind: "cell"; cell: number } | null {
  if (!insidePlayfield(x, y) || !toNdc(x, y)) return null;
  const meshes = state.pieces.filter((p) => !p.placed && p.id !== exclude).map((p) => pieces.get(p.id)?.mesh).filter((m): m is Mesh => !!m);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length > 0) return { kind: "piece", pieceId: hits[0]!.object.userData.pieceId as number };
  const ray = raycaster.ray;
  if (Math.abs(ray.direction.y) > 1e-6) {
    const t = -ray.origin.y / ray.direction.y;
    if (t > 0) {
      const pt = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
      const rs = state.ruleset;
      for (let c = 0; c < rs.cols * rs.rows; c++) {
        const cp = cellPos(rs, c);
        if (Math.abs(pt.x - cp.x) < CELL / 2 && Math.abs(pt.z - cp.z) < CELL / 2) return { kind: "cell", cell: c };
      }
    }
  }
  return null;
}
/** Holds a dragged piece under the pointer, on a plane above the desk. */
export function moveDragged(pieceId: number, x: number, y: number): void {
  const v = pieces.get(pieceId);
  if (!v || !toNdc(x, y)) return;
  dragging = pieceId;
  const ray = raycaster.ray;
  if (Math.abs(ray.direction.y) > 1e-6) {
    const t = -(ray.origin.y - 0.9) / ray.direction.y;
    if (t > 0) {
      const pt = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
      v.mesh.position.set(pt.x, 0.9, pt.z);
      targets.get(pieceId)?.pos.copy(v.mesh.position); // hold until release decides
    }
  }
}
/** The drag ended: the piece settles into its cell or back to the tray on the next sync. */
export function endDrag(): void { dragging = null; }

// -- graphics level ----------------------------------------------------------------------------------
let envMap: Texture | null = null;
function applyReflections(on: boolean): void {
  if (on && !envMap) {
    try { envMap = new PMREMGenerator(renderer).fromScene((() => { const room = new RoomEnvironment(renderer); room.position.y = 0 /* pre-r183 page: room at origin (minor 32 default is -3.5) */; return room; })(), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  scene.environment = on ? envMap : null;
  scene.environmentIntensity = 0.35;
  hemi.intensity = on ? 0.55 : 0.85; // IBL takes over part of the fill
  // gilt frame reads as metal only when there is something to reflect
  frameMat.metalness = on ? 0.85 : 0.4;
  frameMat.roughness = on ? 0.32 : 0.5;
  frameMat.color.set(on ? 0xb08a48 : 0x8a6d3b);
}
const surfaces = new Map<string, Texture>();
const surfacePending = new Set<string>();
/** A baked surface (assets/textures/…), applied once it has loaded; the flat colours stay until then. */
function surface(path: string, repeat: [number, number], apply: () => void): Texture | null {
  const have = surfaces.get(path);
  if (have) return have;
  if (!surfacePending.has(path)) {
    surfacePending.add(path);
    loader.load(path, (t) => {
      t.colorSpace = SRGBColorSpace;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = 4;
      surfaces.set(path, t);
      surfacePending.delete(path);
      apply();
    }, undefined, (e: unknown) => { surfacePending.delete(path); console.warn(`${path}: ${e instanceof Error ? e.message : String(e)}`); });
  }
  return null;
}
/** Procedural surfaces at the look's texture budget (render.js _applyDetail). */
function applyDetail(): void {
  const on = !!look?.detailed;
  const px = look?.budget.texture ?? 256;
  const wood = on ? surface(`assets/textures/wood-${px}.webp`, [3, 2], applyDetail) : null;
  const stone = on ? surface(`assets/textures/stone-${px}.png`, [2, 2], applyDetail) : null;
  const felt = on ? surface(`assets/textures/felt-${px}.png`, [4, 2], applyDetail) : null;
  deskMat.map = wood;
  deskMat.color.set(wood ? 0xd6cbc0 : 0x4a3527);
  deskMat.roughness = wood ? 0.62 : 0.82;
  if (slabMat) {
    slabMat.map = stone;
    slabMat.color.set(stone ? 0xffffff : 0x2e3340);
  }
  if (trayMat) {
    trayMat.map = felt;
    trayMat.color.set(felt ? 0xffffff : 0x232733);
    trayMat.roughness = felt ? 0.95 : 0.7;
  }
}
/** The graphics level's look (quality.ts): post effects, shadows, reflections, detail, tile shading, particles. */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const prev = look;
  look = next;
  const b = next.budget;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.6, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: next.ao === "high" ? 16 : 8, resolution: b.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8 },
  };
  // high threshold: only the lamp strip, target rings and sparkles glow
  // render.js: three r170 UnrealBloomPass(0.5, 0.4, 0.9), drawn by the r176 bloom model at the page's strength.
  renderer.bloom = next.bloom ? { model: "r176", strength: 0.5, radius: 0.4, threshold: 0.9, resolution: b.bloomRes } : null;
  // render.js GradeShader (linear HDR before tone mapping): a gentle S-curve, a touch more saturation, warm
  // highlights / cool shadows, the 0.24 vignette.
  renderer.grade = next.grade ? {
    space: "linear", overRange: "keep", contrast: 0.18, saturation: 1.1, shadows: [0.95, 0.98, 1.06], highlights: [1.05, 1.0, 0.95], split: [0.05, 0.6],
    vignette: { amount: 0.24, inner: 0.38, outer: 0.9, scale: [1.1, 1] },
  } : null;
  renderer.antialias = next.antialias;
  const on = next.shadows > 0;
  renderer.shadowMap.enabled = on;
  keyLight.castShadow = on;
  if (on) keyLight.shadow.mapSize = next.shadows;
  applyReflections(next.reflections);
  applyDetail();
  const pb = prev?.budget;
  if (!prev || prev.reflections !== next.reflections || prev.detailed !== next.detailed || !pb || pb.material !== b.material || pb.tile !== b.tile) rebuildPieceMaterials();
  for (const g of ghostMeshes) (g.material as MeshBasicMaterial).opacity = ghostOpacity();
  dust.visible = next.particles;
  dustCount = Math.min(DUST_MAX, b.dust);
  dustGeo.setDrawRange(0, dustCount);
  sparks.visible = next.particles;
}
export function setReducedMotion(on: boolean): void { reducedMotion = on; }

/** The playfield's window rectangle (px): the camera keeps its aspect and draws into it. */
const pf = { x: 0, y: 0, w: 0, h: 0 };
export function setPlayfield(x: number, y: number, w: number, h: number): void { pf.x = x; pf.y = y; pf.w = w; pf.h = h; }

// -- the frame ---------------------------------------------------------------------------------------
/** render.js render(): the damped snap and lift, the selected tile's bob and glow, the ring pulse, the lamp
 * shimmer, the particles, and the camera fitted to the playfield. */
export function update(dtIn: number): void {
  const f = frame();
  const dt = Math.min(0.25, Math.max(0, dtIn));
  if (!reducedMotion) time += dt;
  if (f.width > 0 && f.height > 0) {
    const w = pf.w > 0 ? pf.w : f.width, h = pf.h > 0 ? pf.h : f.height;
    const key = `${w}x${h}@${pf.x},${pf.y}/${f.width}x${f.height}`;
    if (key !== frameKey) {
      frameKey = key;
      camera.aspect = w / h;
      if (pf.w > 0) camera.setViewOffset(w, h, -pf.x, -pf.y, f.width, f.height);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      if (framed) frameCamera(framed);
    }
  }
  // critically-damped snap, interruptible (the old 0.22 a frame at 60 Hz)
  const damp = reducedMotion ? 1 : 1 - Math.pow(0.78, dt * 60);
  for (const [id, v] of pieces) {
    const t = targets.get(id);
    if (!t) continue;
    const mesh = v.mesh;
    if (dragging !== id) {
      const y = mesh.position.y;
      mesh.position.lerp(t.pos, damp);
      // the lifted (selected) tile idles with a gentle bob and a warm glow pulse
      const bob = t.lift && !reducedMotion ? Math.sin(time * 2.6) * 0.06 : 0;
      const targetY = t.pos.y + t.lift + bob;
      mesh.position.y = y + (targetY - y) * damp;
    }
    let dr = t.rot - mesh.rotation.y;
    dr = ((dr + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI;
    mesh.rotation.y += dr * damp;
    const glow = v.selected ? 0.16 + (reducedMotion ? 0 : 0.06 * Math.sin(time * 3.2)) : 0;
    ((mesh.material as MeshStandardMaterial).emissive as Color).setRGB(glow, glow * 0.9, glow * 0.7);
  }
  if (!reducedMotion) {
    for (const m of markerMeshes) (m.material as MeshBasicMaterial).opacity = 0.72 + 0.18 * Math.sin(time * 3);
    if (cursorMesh.visible) (cursorMesh.material as MeshBasicMaterial).opacity = 0.75 + 0.2 * Math.sin(time * 4);
    picLight.intensity = PIC_INTENSITY + Math.sin(time * 0.7) * 3; // faint lamp shimmer
  }
  updateParticles(dt);
}
