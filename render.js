'use strict';

// Mosaic Pieces — render: Three.js scene graph, gallery-desk presentation,
// semantic piece/cell views, authored camera, quality tiers, VFX-lite.

import * as THREE from './three.min.js';
import { PALETTES } from './rules.js';

export const FRAMING = Object.freeze({ fov: 35, distance: 26, pitch: 0.62, trayGap: 2.2 });
export const CELL = 1.7;          // world units per board cell
export const QUALITY = Object.freeze({
  high:   { pixelRatioCap: 2,   shadows: true,  envDetail: true },
  medium: { pixelRatioCap: 1.5, shadows: true,  envDetail: false },
  low:    { pixelRatioCap: 1,   shadows: false, envDetail: false }
});

const GLYPHS = ['▲', '◆', '●', '■', '★', '✚']; // shape reinforces color (CVD-safe)
const LAYER_GAMEPLAY = 0; // ghosts/markers share the gameplay layer; effects never intercept raycasts

function roundedRectShape(size, r) {
  const s = size / 2, g = new THREE.Shape();
  g.moveTo(-s + r, -s);
  g.lineTo(s - r, -s); g.quadraticCurveTo(s, -s, s, -s + r);
  g.lineTo(s, s - r); g.quadraticCurveTo(s, s, s - r, s);
  g.lineTo(-s + r, s); g.quadraticCurveTo(-s, s, -s, s - r);
  g.lineTo(-s, -s + r); g.quadraticCurveTo(-s, -s, -s + r, -s);
  return g;
}

const texCache = new Map();
const cachedTextures = new Set(); // shared, never disposed with a mesh
function pieceTexture(color, glyph, upright) {
  const key = color + glyph + (upright ? '1' : '0');
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.fillRect(0, 0, 128, 128);
  // subtle radial shading for material depth
  const grad = x.createRadialGradient(48, 40, 10, 64, 64, 100);
  grad.addColorStop(0, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0.25)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = 'rgba(20,20,28,0.72)';
  x.font = 'bold 64px system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(glyph, 64, 68);
  // orientation tick at the top edge so rotation is readable by shape too
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.fillRect(56, 6, 16, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  cachedTextures.add(t);
  return t;
}

// The goal image hanging on the gallery wall: the solved mosaic, so the
// player (and the lessons that reference it) has a picture to work toward.
function goalTexture(state, palette) {
  const rs = state.ruleset;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 348;
  const x = c.getContext('2d');
  x.fillStyle = '#11131a';
  x.fillRect(0, 0, c.width, c.height);
  const pad = 18;
  const size = Math.min((c.width - pad * 2) / rs.cols, (c.height - pad * 2) / rs.rows);
  const ox = (c.width - size * rs.cols) / 2, oy = (c.height - size * rs.rows) / 2;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  for (const p of state.pieces) {
    const cx = ox + (p.id % rs.cols) * size, cy = oy + Math.floor(p.id / rs.cols) * size;
    x.fillStyle = palette[p.colorIndex % palette.length];
    x.fillRect(cx + 1, cy + 1, size - 2, size - 2);
    x.fillStyle = 'rgba(20,20,28,0.72)';
    x.font = `bold ${Math.round(size * 0.5)}px system-ui, sans-serif`;
    x.fillText(GLYPHS[p.colorIndex % GLYPHS.length], cx + size / 2, cy + size / 2 + size * 0.03);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Renderer {
  constructor(host, opts) {
    this.host = host;
    this.opts = opts; // { quality:'high', reducedMotion:false, theme:'default' }
    this.webgl = true;
    this.pieceMeshes = new Map(); // pieceId -> mesh
    this.cellMeshes = [];
    this.ghostMeshes = [];
    this.markerMeshes = [];
    this.targets = new Map(); // pieceId -> {pos:Vector3, rot:number}
    this.onFrame = null;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      this.webgl = false;
      return;
    }
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = r.domElement;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.display = 'block';
    host.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d2028);
    this.camera = new THREE.PerspectiveCamera(FRAMING.fov, 1, 0.1, 200);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    // gallery-desk lighting: one dominant key + soft fill + contact grounding
    const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
    key.position.set(6, 10, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -16; key.shadow.camera.right = 16;
    key.shadow.camera.top = 16; key.shadow.camera.bottom = -16;
    this.scene.add(key);
    this.keyLight = key;
    this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x33241c, 0.85));

    // desk surface
    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(60, 1.4, 40),
      new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 0.82, metalness: 0.05 })
    );
    desk.position.y = -1.15;
    desk.receiveShadow = true;
    this.scene.add(desk);
    // wall backdrop (environment storytelling: gallery frame)
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 40),
      new THREE.MeshStandardMaterial({ color: 0x272b36, roughness: 0.95 })
    );
    wall.position.set(0, 12, -16);
    this.scene.add(wall);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(20, 14, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.5, metalness: 0.4 })
    );
    frame.position.set(0, 12, -15.7);
    this.scene.add(frame);
    const canvasArt = new THREE.Mesh(
      new THREE.PlaneGeometry(18.6, 12.6),
      new THREE.MeshStandardMaterial({ color: 0x11131a, roughness: 0.9 })
    );
    canvasArt.position.set(0, 12, -15.4);
    this.scene.add(canvasArt);
    this.artMesh = canvasArt;

    this.setQuality(opts.quality || 'high');
    this._resize();
  }

  setQuality(q) {
    const tier = QUALITY[q] || QUALITY.high;
    this.quality = q;
    if (!this.webgl) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatioCap));
    this.renderer.shadowMap.enabled = tier.shadows;
    this.keyLight.castShadow = tier.shadows;
  }

  cellPos(ruleset, cell) {
    const x = cell % ruleset.cols, y = Math.floor(cell / ruleset.cols);
    const w = ruleset.cols * CELL, h = ruleset.rows * CELL;
    return new THREE.Vector3(-w / 2 + CELL / 2 + x * CELL, 0, -h / 2 + CELL / 2 + y * CELL - FRAMING.trayGap / 2);
  }
  trayPos(index, total) {
    const spacing = CELL * 1.06; // pieces are ~CELL*0.9 wide incl. bevel
    const perRow = Math.min(total, 10);
    const row = Math.floor(index / 10);
    const col = index % 10;
    const w = perRow * spacing;
    return new THREE.Vector3(-w / 2 + spacing / 2 + col * spacing, 0,
      (this._boardDepth || 6) / 2 + FRAMING.trayGap + row * spacing);
  }

  // Build scene entities for a new puzzle (disposes old ones).
  buildPuzzle(state, paletteTheme) {
    if (!this.webgl) return;
    for (const m of this.pieceMeshes.values()) { this.scene.remove(m); disposeObj(m); }
    for (const m of [...this.cellMeshes, ...this.ghostMeshes, ...this.markerMeshes]) { this.scene.remove(m); disposeObj(m); }
    this.pieceMeshes.clear(); this.cellMeshes = []; this.ghostMeshes = []; this.markerMeshes = [];
    this.targets.clear();

    const rs = state.ruleset;
    this._boardDepth = rs.rows * CELL;
    const palette = PALETTES[paletteTheme] || PALETTES.default;

    // board slab
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(rs.cols * CELL + 0.8, 0.4, rs.rows * CELL + 0.8),
      new THREE.MeshStandardMaterial({ color: 0x2e3340, roughness: 0.6, metalness: 0.15 })
    );
    slab.position.set(0, -0.22, -FRAMING.trayGap / 2);
    slab.receiveShadow = true;
    this.scene.add(slab);
    this.cellMeshes.push(slab);

    const n = rs.cols * rs.rows;
    const cellGeo = new THREE.ShapeGeometry(roundedRectShape(CELL * 0.92, 0.18));
    cellGeo.rotateX(-Math.PI / 2);
    for (let c = 0; c < n; c++) {
      const ghost = new THREE.Mesh(cellGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.10, depthWrite: false
      }));
      ghost.position.copy(this.cellPos(rs, c));
      ghost.position.y = 0.01;
      ghost.layers.set(LAYER_GAMEPLAY);
      this.scene.add(ghost);
      this.ghostMeshes.push(ghost);
    }
    // tray strip sized to the actual tray layout
    const trayRows = Math.ceil(n / 10);
    const trayCols = Math.min(n, 10);
    const spacing = CELL * 1.06;
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(trayCols * spacing + 0.8, 0.25, trayRows * spacing + 0.7),
      new THREE.MeshStandardMaterial({ color: 0x232733, roughness: 0.7 })
    );
    tray.position.set(0, -0.32, this._boardDepth / 2 + FRAMING.trayGap + (trayRows - 1) * spacing / 2);
    tray.receiveShadow = true;
    this.scene.add(tray);
    this.cellMeshes.push(tray);

    // pieces
    const geo = new THREE.ExtrudeGeometry(roundedRectShape(CELL * 0.88, 0.2), { depth: 0.28, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 });
    geo.rotateX(-Math.PI / 2);
    state.pieces.forEach((p, i) => {
      const color = palette[p.colorIndex % palette.length];
      const mat = new THREE.MeshStandardMaterial({
        map: pieceTexture(color, GLYPHS[p.colorIndex % GLYPHS.length], true),
        roughness: 0.55, metalness: 0.05
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.userData.pieceId = p.id;
      mesh.layers.set(LAYER_GAMEPLAY);
      const tp = this.trayPos(state.tray.indexOf(p.id), state.tray.length);
      mesh.position.copy(tp);
      mesh.rotation.y = -p.rot * Math.PI / 2;
      this.scene.add(mesh);
      this.pieceMeshes.set(p.id, mesh);
      this.targets.set(p.id, { pos: tp.clone(), rot: mesh.rotation.y, lift: 0 });
      void i;
    });
    // hang this puzzle's goal image in the frame on the wall
    if (this.artMesh) {
      const mat = this.artMesh.material;
      if (mat.map) mat.map.dispose();
      mat.map = goalTexture(state, palette);
      mat.color.set(0xffffff); // the base tint would darken the mapped art
      mat.needsUpdate = true;
    }
    this._frameCamera(state);
  }

  _frameCamera(state) {
    const rs = state.ruleset;
    const trayRows = Math.ceil(rs.cols * rs.rows / 10);
    const trayCols = Math.min(rs.cols * rs.rows, 10);
    const depth = rs.rows * CELL + FRAMING.trayGap * 2 + trayRows * CELL * 1.06 + 1.5;
    const width = Math.max(rs.cols * CELL + 1, trayCols * CELL * 1.06 + 1);
    const d = Math.max(15, depth * 1.5, width * 1.75);
    this.camera.position.set(0, d * FRAMING.pitch, d * 0.72);
    this.camera.lookAt(0, 0, depth * 0.16); // bias toward the tray so both fit
  }

  // Sync visuals from an immutable rules snapshot.
  update(state, opts = {}) {
    if (!this.webgl) return;
    const rs = state.ruleset;
    for (const p of state.pieces) {
      const mesh = this.pieceMeshes.get(p.id);
      if (!mesh) continue;
      const t = this.targets.get(p.id);
      if (p.placed) {
        t.pos.copy(this.cellPos(rs, p.placedCell));
        t.pos.y = 0.06;
        t.rot = -p.placedRot * Math.PI / 2;
      } else {
        const tp = this.trayPos(state.tray.indexOf(p.id), state.tray.length);
        t.pos.copy(tp);
        t.rot = -p.rot * Math.PI / 2;
      }
      t.lift = (state.selected === p.id) ? 0.55 : 0;
      void opts;
    }
  }

  showLegalTargets(state, cells) {
    if (!this.webgl) return;
    for (const m of this.markerMeshes) { this.scene.remove(m); disposeObj(m); }
    this.markerMeshes = [];
    const geo = new THREE.RingGeometry(0.32, 0.5, 24);
    geo.rotateX(-Math.PI / 2);
    for (const c of cells) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.85, depthWrite: false }));
      m.position.copy(this.cellPos(state.ruleset, c));
      m.position.y = 0.03;
      m.layers.set(LAYER_GAMEPLAY);
      this.scene.add(m);
      this.markerMeshes.push(m);
    }
  }

  // Pick a piece or board cell from normalized device coordinates.
  pick(state, ndcX, ndcY) {
    if (!this.webgl) return null;
    this.pointer.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.layers.set(LAYER_GAMEPLAY);
    // placed pieces are part of the picture, not pick targets: raycasting
    // them would turn a click on a finished cell into an illegal action
    const placed = new Set(state.pieces.filter(p => p.placed).map(p => p.id));
    const meshes = [...this.pieceMeshes.entries()].filter(([id]) => !placed.has(id)).map(([, m]) => m);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) return { kind: 'piece', pieceId: hits[0].object.userData.pieceId };
    // fall back to board-cell picking via the ground plane
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) > 1e-6) {
      const t = -ray.origin.y / ray.direction.y;
      if (t > 0) {
        const pt = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
        const rs = state.ruleset;
        for (let c = 0; c < rs.cols * rs.rows; c++) {
          const cp = this.cellPos(rs, c);
          if (Math.abs(pt.x - cp.x) < CELL / 2 && Math.abs(pt.z - cp.z) < CELL / 2) {
            return { kind: 'cell', cell: c };
          }
        }
      }
    }
    return null;
  }

  moveDragged(pieceId, ndcX, ndcY) {
    if (!this.webgl || pieceId == null) return;
    const mesh = this.pieceMeshes.get(pieceId);
    if (!mesh) return;
    this.pointer.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) > 1e-6) {
      const t = -(ray.origin.y - 0.9) / ray.direction.y;
      if (t > 0) {
        const pt = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
        mesh.position.set(pt.x, 0.9, pt.z);
        const tgt = this.targets.get(pieceId);
        if (tgt) tgt.pos.copy(mesh.position); // hold until release decides
      }
    }
  }

  render() {
    if (!this.webgl) return;
    const damp = this.opts.reducedMotion ? 1 : 0.22; // critically-damped snap, interruptible
    for (const [id, mesh] of this.pieceMeshes) {
      const t = this.targets.get(id);
      if (!t) continue;
      mesh.position.lerp(t.pos, damp);
      const targetY = t.pos.y + t.lift;
      mesh.position.y += (targetY - mesh.position.y) * damp;
      let dr = t.rot - mesh.rotation.y;
      dr = ((dr + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      mesh.rotation.y += dr * damp;
    }
    if (this._resize()) { /* resized this frame */ }
    this.renderer.render(this.scene, this.camera);
    if (this.onFrame) this.onFrame();
  }

  _resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      return true;
    }
    return false;
  }

  drawCalls() { return this.webgl ? this.renderer.info.render.calls : 0; }
  dispose() {
    if (!this.webgl) return;
    this.renderer.dispose();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}

function disposeObj(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m.map && !cachedTextures.has(m.map)) m.map.dispose(); m.dispose(); }
    }
  });
}
