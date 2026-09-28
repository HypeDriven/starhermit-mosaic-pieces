'use strict';

// Mosaic Pieces — render: Three.js scene graph, gallery-desk presentation,
// semantic piece/cell views, authored camera, graphics quality model
// (gfx.js) with a post-processing chain, image-based lighting, procedural
// surface detail and light particles.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PALETTES } from './rules.js';
import { detectPreset, resolve, SHADOW_MAP } from './gfx.js';

export const FRAMING = Object.freeze({ fov: 35, distance: 26, pitch: 0.62, trayGap: 2.2 });
export const CELL = 1.7;          // world units per board cell

const GLYPHS = ['▲', '◆', '●', '■', '★', '✚']; // shape reinforces color (CVD-safe)
const LAYER_GAMEPLAY = 0; // ghosts/markers share the gameplay layer; effects never intercept raycasts
const TILE = CELL * 0.88, TILE_BEVEL = 0.05;
const RING_COLOR = new THREE.Color(0x7dff9a);

function roundedRectShape(size, r) {
  const s = size / 2, g = new THREE.Shape();
  g.moveTo(-s + r, -s);
  g.lineTo(s - r, -s); g.quadraticCurveTo(s, -s, s, -s + r);
  g.lineTo(s, s - r); g.quadraticCurveTo(s, s, s - r, s);
  g.lineTo(-s + r, s); g.quadraticCurveTo(-s, s, -s, s - r);
  g.lineTo(-s, -s + r); g.quadraticCurveTo(-s, -s, -s + r, -s);
  return g;
}

// Small deterministic PRNG so procedural textures look the same every load.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}

const texCache = new Map();
const cachedTextures = new Set(); // shared, never disposed with a mesh
// Tile face: palette colour, glyph and an orientation tick. `detailed` adds a
// glaze: a soft highlight pool, fine crackle and a darker kiln edge.
function pieceTexture(color, glyph, detailed) {
  const key = color + glyph + (detailed ? 'd' : 'p');
  if (texCache.has(key)) return texCache.get(key);
  const t = canvasTex(256, 256, (x, W) => {
    x.fillStyle = color;
    x.fillRect(0, 0, W, W);
    const grad = x.createRadialGradient(W * 0.38, W * 0.32, W * 0.08, W / 2, W / 2, W * 0.78);
    grad.addColorStop(0, detailed ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0.25)');
    x.fillStyle = grad;
    x.fillRect(0, 0, W, W);
    if (detailed) {
      const r = rng(color.length * 131 + glyph.charCodeAt(0));
      // speckle in the glaze
      for (let i = 0; i < 900; i++) {
        x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        x.fillRect(r() * W, r() * W, 1 + r() * 2, 1 + r() * 2);
      }
      // hairline crackle
      x.strokeStyle = 'rgba(0,0,0,0.10)';
      x.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        let px = r() * W, py = r() * W;
        x.beginPath(); x.moveTo(px, py);
        for (let k = 0; k < 5; k++) { px += (r() - 0.5) * 60; py += (r() - 0.5) * 60; x.lineTo(px, py); }
        x.stroke();
      }
      // kiln edge
      const edge = x.createRadialGradient(W / 2, W / 2, W * 0.42, W / 2, W / 2, W * 0.72);
      edge.addColorStop(0, 'rgba(0,0,0,0)');
      edge.addColorStop(1, 'rgba(0,0,0,0.22)');
      x.fillStyle = edge;
      x.fillRect(0, 0, W, W);
    }
    x.fillStyle = 'rgba(20,20,28,0.78)';
    x.font = `bold ${Math.round(W * 0.5)}px system-ui, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(glyph, W / 2, W * 0.53);
    // orientation tick at the top edge so rotation is readable by shape too
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.fillRect(W * 0.43, W * 0.06, W * 0.14, W * 0.06);
  });
  texCache.set(key, t);
  cachedTextures.add(t);
  return t;
}

// Procedural surfaces for the `detail` category, built once on first use.
function woodTexture() {
  return canvasTex(1024, 512, (x, W, H) => {
    const r = rng(7);
    x.fillStyle = '#5a3f2c';
    x.fillRect(0, 0, W, H);
    // planks with individual tone
    const planks = 6;
    for (let p = 0; p < planks; p++) {
      const y0 = p * H / planks;
      x.fillStyle = `rgba(${r() < 0.5 ? '255,220,180' : '0,0,0'},${0.03 + r() * 0.06})`;
      x.fillRect(0, y0, W, H / planks);
      // grain: long wavy streaks
      for (let i = 0; i < 70; i++) {
        const yy = y0 + r() * H / planks, amp = 1 + r() * 4, ph = r() * 6, fr = 0.004 + r() * 0.01;
        x.strokeStyle = r() < 0.7 ? `rgba(30,16,8,${0.12 + r() * 0.2})` : `rgba(255,214,170,${0.05 + r() * 0.08})`;
        x.lineWidth = 0.6 + r() * 1.6;
        x.beginPath();
        for (let xx = 0; xx <= W; xx += 16) {
          const y = yy + Math.sin(xx * fr + ph) * amp;
          if (xx === 0) x.moveTo(xx, y); else x.lineTo(xx, y);
        }
        x.stroke();
      }
      x.fillStyle = 'rgba(15,8,4,0.55)';
      x.fillRect(0, y0, W, 2); // seam
    }
  }, { repeat: [3, 2] });
}
function stoneTexture() {
  return canvasTex(512, 512, (x, W) => {
    const r = rng(11);
    x.fillStyle = '#343a48';
    x.fillRect(0, 0, W, W);
    for (let i = 0; i < 5000; i++) {
      const v = r();
      x.fillStyle = v < 0.5 ? `rgba(255,255,255,${0.02 + r() * 0.05})` : `rgba(0,0,0,${0.04 + r() * 0.08})`;
      x.fillRect(r() * W, r() * W, 1 + r() * 3, 1 + r() * 3);
    }
    for (let i = 0; i < 14; i++) { // faint veins
      x.strokeStyle = `rgba(200,210,230,${0.04 + r() * 0.05})`;
      x.lineWidth = 1 + r();
      x.beginPath();
      let px = r() * W, py = r() * W; x.moveTo(px, py);
      for (let k = 0; k < 8; k++) { px += (r() - 0.5) * 120; py += (r() - 0.3) * 80; x.lineTo(px, py); }
      x.stroke();
    }
  }, { repeat: [2, 2] });
}
function feltTexture() {
  return canvasTex(256, 256, (x, W) => {
    const r = rng(23);
    x.fillStyle = '#2a3a34';
    x.fillRect(0, 0, W, W);
    for (let i = 0; i < 6000; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)';
      x.fillRect(r() * W, r() * W, 1, 1 + r() * 2);
    }
  }, { repeat: [4, 2] });
}
function softDotTexture() {
  return canvasTex(64, 64, (x, W) => {
    const g = x.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, W);
  });
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

// Colour grade + vignette (linear HDR in, before OutputPass tone-maps).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.24 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      vec3 lc = clamp(c, 0.0, 1.0);
      // gentle S-curve, a touch more saturation, warm highlights / cool shadows
      vec3 s = mix(lc, lc * lc * (3.0 - 2.0 * lc), 0.18);
      float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.95, 0.98, 1.06), vec3(1.05, 1.0, 0.95), smoothstep(0.05, 0.6, l));
      c = mix(c, s + max(c - 1.0, 0.0), uAmount);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`
};

function detectGpu(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch (_) { return ''; }
}
function isMobileDevice() {
  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  } catch (_) { /* no media queries */ }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

export class Renderer {
  constructor(host, opts) {
    this.host = host;
    this.opts = opts; // { gfx: savedGraphics, reducedMotion:false }
    this.webgl = true;
    this.pieceMeshes = new Map(); // pieceId -> mesh
    this.cellMeshes = [];
    this.ghostMeshes = [];
    this.markerMeshes = [];
    this.targets = new Map(); // pieceId -> {pos:Vector3, rot:number}
    this.onFrame = null;
    this.gpu = '';
    this.detected = 'low';
    this.q = resolve(opts.gfx, this.detected);
    this.postFailed = false;
    this.composer = null;
    this.postKey = null;
    this.pixelRatio = 1;
    this.adaptiveScale = 1;
    this._frames = [];
    this.fps = 0;
    this._time = 0;
    this._placedSet = new Set();
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      this.webgl = false;
      this.setGraphics(opts.gfx);
      return;
    }
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gpu = detectGpu(r.getContext());
    this.detected = detectPreset(this.gpu, { mobile: isMobileDevice() });
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
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    this.scene.add(key.target);
    this.keyLight = key;
    this.hemi = new THREE.HemisphereLight(0x8899bb, 0x33241c, 0.85);
    this.scene.add(this.hemi);

    // desk surface
    this.deskMat = new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 0.82, metalness: 0.05 });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(60, 1.4, 40), this.deskMat);
    desk.position.y = -1.15;
    desk.receiveShadow = true;
    this.scene.add(desk);
    // wall backdrop (environment storytelling: gallery frame)
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 40),
      new THREE.MeshStandardMaterial({ color: 0x272b36, roughness: 0.95 })
    );
    wall.position.set(0, 12, -16);
    wall.receiveShadow = true;
    this.scene.add(wall);
    // Photographic plaster texture for the gallery wall. The flat colour above
    // stays in place if the file is missing or fails to decode.
    try {
      new THREE.TextureLoader().load('assets/gallery-wall.webp', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        wall.material.map = tex;
        wall.material.color.set(0xffffff);
        wall.material.needsUpdate = true;
      }, undefined, () => {});
    } catch (_) { /* keep the flat wall */ }
    this.frameMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.5, metalness: 0.4 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(20, 14, 0.5), this.frameMat);
    frame.position.set(0, 12, -15.7);
    frame.castShadow = true;
    this.scene.add(frame);
    const canvasArt = new THREE.Mesh(
      new THREE.PlaneGeometry(18.6, 12.6),
      new THREE.MeshStandardMaterial({ color: 0x11131a, roughness: 0.9 })
    );
    canvasArt.position.set(0, 12, -15.4);
    this.scene.add(canvasArt);
    this.artMesh = canvasArt;
    // brass picture light above the frame: its bulb strip is the bloom source
    const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 11, 20), this.frameMat);
    lampArm.rotation.z = Math.PI / 2;
    lampArm.position.set(0, 19.6, -14.9);
    this.scene.add(lampArm);
    this.bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.86, 0.62).multiplyScalar(2.6) });
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.12, 0.2), this.bulbMat);
    bulb.position.set(0, 19.35, -14.75);
    this.scene.add(bulb);
    const pic = new THREE.SpotLight(0xffe2b8, 90, 30, 0.62, 0.6, 1.6);
    pic.position.set(0, 19.2, -13.6);
    pic.target.position.set(0, 11, -15.4);
    this.scene.add(pic, pic.target);
    this.picLight = pic;

    this._buildParticles();
    this.setGraphics(opts.gfx);
    this._resize();
  }

  // ---------------------------------------------------------------- graphics settings

  /** Apply saved graphics settings (see gfx.js); takes effect on the next frame. */
  setGraphics(saved) {
    this.saved = saved || {};
    const g = resolve(this.saved, this.detected);
    const prev = this.q;
    this.q = g;
    document.body.dataset.gfxPreset = g.preset;
    this._fpsVisible(g.showFps);
    if (!this.webgl) return;
    this.canvas.dataset.gfxPreset = g.preset;
    const size = SHADOW_MAP[g.shadows];
    const shadowsChanged = this.renderer.shadowMap.enabled !== size > 0;
    this.renderer.shadowMap.enabled = size > 0;
    this.keyLight.castShadow = size > 0;
    if (size > 0 && this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      if (this.keyLight.shadow.map) { this.keyLight.shadow.map.dispose(); this.keyLight.shadow.map = null; }
    }
    this._applyReflections(g.reflections === 'on');
    this._applyDetail(g.detail === 'detailed');
    if (!prev || prev.reflections !== g.reflections || prev.detail !== g.detail) this._rebuildPieceMaterials();
    this.dust.visible = g.particles === 'on';
    this.sparks.visible = g.particles === 'on';
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    if (shadowsChanged || !prev) this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  }

  /** What the Graphics panel shows: GPU, auto choice, resolved tiers, pixels, frame rate. */
  graphicsInfo() {
    const size = this.webgl ? this.renderer.getSize(new THREE.Vector2()) : { x: 0, y: 0 };
    return {
      webgl: this.webgl,
      gpu: this.gpu,
      detected: this.detected,
      resolved: this.q,
      pixels: [Math.round(size.x * this.pixelRatio), Math.round(size.y * this.pixelRatio)],
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed
    };
  }

  _applyReflections(on) {
    if (on && !this.envRT) {
      const pm = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.envRT = pm.fromScene(room, 0.04);
      room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      pm.dispose();
    }
    this.scene.environment = on ? this.envRT.texture : null;
    this.scene.environmentIntensity = 0.35;
    this.hemi.intensity = on ? 0.55 : 0.85; // IBL takes over part of the fill
    // gilt frame reads as metal only when there is something to reflect
    this.frameMat.metalness = on ? 0.85 : 0.4;
    this.frameMat.roughness = on ? 0.32 : 0.5;
    this.frameMat.color.set(on ? 0xb08a48 : 0x8a6d3b);
  }

  _applyDetail(on) {
    if (on && !this.detailTex) {
      this.detailTex = { wood: woodTexture(), stone: stoneTexture(), felt: feltTexture() };
      for (const t of Object.values(this.detailTex)) t.userData.shared = true; // outlive puzzle teardown
    }
    const d = this.detailTex;
    this.deskMat.map = on ? d.wood : null;
    this.deskMat.color.set(on ? 0xd6cbc0 : 0x4a3527);
    this.deskMat.roughness = on ? 0.62 : 0.82;
    this.deskMat.needsUpdate = true;
    if (this.slabMat) {
      this.slabMat.map = on ? d.stone : null;
      this.slabMat.color.set(on ? 0xffffff : 0x2e3340);
      this.slabMat.needsUpdate = true;
    }
    if (this.trayMat) {
      this.trayMat.map = on ? d.felt : null;
      this.trayMat.color.set(on ? 0xffffff : 0x232733);
      this.trayMat.roughness = on ? 0.95 : 0.7;
      this.trayMat.needsUpdate = true;
    }
  }

  _pieceMaterial(color, glyph) {
    const detailed = this.q.detail === 'detailed';
    const map = pieceTexture(color, glyph, detailed);
    if (this.q.reflections === 'on') {
      // glazed ceramic: clear lacquer over a satin body
      return new THREE.MeshPhysicalMaterial({ map, roughness: 0.45, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.14, envMapIntensity: 1.0, emissive: 0x000000 });
    }
    return new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.05, emissive: 0x000000 });
  }
  _rebuildPieceMaterials() {
    for (const mesh of this.pieceMeshes.values()) {
      const { color, glyph } = mesh.userData;
      mesh.material.dispose();
      mesh.material = this._pieceMaterial(color, glyph);
    }
  }

  _fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.className = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      (document.getElementById('game-region') || document.body).appendChild(el);
    }
    if (el) el.hidden = !on;
  }

  // ---------------------------------------------------------------- particles

  _buildParticles() {
    const dot = softDotTexture();
    // drifting dust in the lamp light
    const N = 110, r = rng(5);
    const pos = new Float32Array(N * 3);
    this.dustSeed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (r() - 0.5) * 26; pos[i * 3 + 1] = 0.6 + r() * 11; pos[i * 3 + 2] = -12 + r() * 22;
      this.dustSeed[i] = r() * 100;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({
      map: dot, size: 0.09, color: 0xffe6c4, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.dust.frustumCulled = false;
    this.dust.visible = false;
    this.scene.add(this.dust);
    // placement sparkles: a fixed pool, colours above 1.0 so they bloom
    const M = 240;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3).fill(-999), 3));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    this.sparkVel = new Float32Array(M * 3);
    this.sparkLife = new Float32Array(M);
    this.sparkNext = 0;
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({
      map: dot, size: 0.22, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    this.scene.add(this.sparks);
  }

  _burst(at, count, spread) {
    if (!this.sparks.visible || this._reduced()) return;
    const p = this.sparks.geometry.attributes.position.array;
    for (let k = 0; k < count; k++) {
      const i = this.sparkNext; this.sparkNext = (i + 1) % this.sparkLife.length;
      const a = Math.random() * Math.PI * 2, sp = (0.6 + Math.random()) * spread;
      p[i * 3] = at.x + Math.cos(a) * 0.3; p[i * 3 + 1] = at.y + 0.3; p[i * 3 + 2] = at.z + Math.sin(a) * 0.3;
      this.sparkVel[i * 3] = Math.cos(a) * sp; this.sparkVel[i * 3 + 1] = 2.2 + Math.random() * 2.2; this.sparkVel[i * 3 + 2] = Math.sin(a) * sp;
      this.sparkLife[i] = 0.7 + Math.random() * 0.5;
    }
  }

  _updateParticles(dt) {
    const moving = !this._reduced();
    if (this.dust.visible && moving) {
      const p = this.dust.geometry.attributes.position.array, t = this._time;
      for (let i = 0; i < this.dustSeed.length; i++) {
        const s = this.dustSeed[i];
        p[i * 3] += Math.sin(t * 0.3 + s) * 0.004;
        p[i * 3 + 1] += 0.05 * dt;
        p[i * 3 + 2] += Math.cos(t * 0.25 + s * 1.3) * 0.004;
        if (p[i * 3 + 1] > 11.6) p[i * 3 + 1] = 0.6;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }
    if (this.sparks.visible) {
      const p = this.sparks.geometry.attributes.position.array;
      const c = this.sparks.geometry.attributes.color.array;
      let any = false;
      for (let i = 0; i < this.sparkLife.length; i++) {
        if (this.sparkLife[i] <= 0) continue;
        any = true;
        this.sparkLife[i] -= dt;
        this.sparkVel[i * 3 + 1] -= 7 * dt;
        p[i * 3] += this.sparkVel[i * 3] * dt; p[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt; p[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
        const k = Math.max(0, this.sparkLife[i]) * 2.4;
        c[i * 3] = k * 1.0; c[i * 3 + 1] = k * 0.85; c[i * 3 + 2] = k * 0.55;
        if (this.sparkLife[i] <= 0) { p[i * 3 + 1] = -999; c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 0; }
      }
      if (any || this._sparksDirty) {
        this.sparks.geometry.attributes.position.needsUpdate = true;
        this.sparks.geometry.attributes.color.needsUpdate = true;
      }
      this._sparksDirty = any;
    }
  }

  _reduced() {
    if (this.opts.reducedMotion) return true;
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
  }

  // ---------------------------------------------------------------- scene layout

  cellPos(ruleset, cell) {
    const x = cell % ruleset.cols, y = Math.floor(cell / ruleset.cols);
    const w = ruleset.cols * CELL, h = ruleset.rows * CELL;
    return new THREE.Vector3(-w / 2 + CELL / 2 + x * CELL, 0, -h / 2 + CELL / 2 + y * CELL - FRAMING.trayGap / 2);
  }
  trayPos(index, total) {
    const spacing = CELL * 1.06; // pieces are ~CELL*0.9 wide incl. bevel
    const perRow = this.trayPerRow(total);
    const row = Math.floor(index / perRow);
    const col = index % perRow;
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
    this.trayMesh = null;

    const rs = state.ruleset;
    this._boardDepth = rs.rows * CELL;
    const palette = PALETTES[paletteTheme] || PALETTES.default;
    const detailed = this.q.detail === 'detailed';

    // board slab
    this.slabMat = new THREE.MeshStandardMaterial({ color: 0x2e3340, roughness: 0.6, metalness: 0.15 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(rs.cols * CELL + 0.8, 0.4, rs.rows * CELL + 0.8), this.slabMat);
    slab.position.set(0, -0.22, -FRAMING.trayGap / 2);
    slab.receiveShadow = true;
    slab.castShadow = true;
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
    // tray strip, re-sized to the tray layout whenever the camera is framed
    this.trayMat = new THREE.MeshStandardMaterial({ color: 0x232733, roughness: 0.7 });
    const tray = new THREE.Mesh(new THREE.BoxGeometry(1, 0.25, 1), this.trayMat);
    tray.receiveShadow = true;
    this.scene.add(tray);
    this.cellMeshes.push(tray);
    this.trayMesh = tray;
    this._applyDetail(detailed);

    // pieces: shared bevelled geometry, UVs mapped so each face shows the whole texture
    const geo = new THREE.ExtrudeGeometry(roundedRectShape(TILE, 0.2), { depth: 0.28, bevelEnabled: true, bevelSize: TILE_BEVEL, bevelThickness: 0.05, bevelSegments: 3 });
    const half = TILE / 2 + TILE_BEVEL;
    const posA = geo.attributes.position, uvA = geo.attributes.uv;
    for (let i = 0; i < posA.count; i++) uvA.setXY(i, (posA.getX(i) + half) / (2 * half), (posA.getY(i) + half) / (2 * half));
    geo.rotateX(-Math.PI / 2);
    this._placedSet = new Set(state.pieces.filter(p => p.placed).map(p => p.id));
    state.pieces.forEach((p) => {
      const color = palette[p.colorIndex % palette.length];
      const glyph = GLYPHS[p.colorIndex % GLYPHS.length];
      const mesh = new THREE.Mesh(geo, this._pieceMaterial(color, glyph));
      mesh.userData = { pieceId: p.id, color, glyph };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.set(LAYER_GAMEPLAY);
      const tp = this.trayPos(state.tray.indexOf(p.id), state.tray.length);
      mesh.position.copy(tp);
      mesh.rotation.y = -p.rot * Math.PI / 2;
      this.scene.add(mesh);
      this.pieceMeshes.set(p.id, mesh);
      this.targets.set(p.id, { pos: tp.clone(), rot: mesh.rotation.y, lift: 0 });
    });
    // hang this puzzle's goal image in the frame on the wall
    if (this.artMesh) {
      const mat = this.artMesh.material;
      if (mat.map) mat.map.dispose();
      mat.map = goalTexture(state, palette);
      this.goalImage = mat.map.image; // shared with the DOM goal thumbnail
      mat.color.set(0xffffff); // the base tint would darken the mapped art
      mat.needsUpdate = true;
    }
    this._frameCamera(state);
  }

  _frameCamera(state) {
    this._framedState = state;
    const rs = state.ruleset;
    const total = rs.cols * rs.rows;
    // Tray wraps into more rows on narrow viewports (see trayPerRow) so both
    // axes can be fitted: project the board, tray and goal-picture corners and
    // pull back until they all sit inside the frame.
    const perRow = this.trayPerRow(total);
    const trayRows = Math.ceil(total / perRow);
    const spacing = CELL * 1.06;
    const boardW = rs.cols * CELL, boardD = rs.rows * CELL;
    const trayW = perRow * spacing;
    const zTop = -boardD / 2 - FRAMING.trayGap / 2 - 0.6;
    const zBottom = boardD / 2 + FRAMING.trayGap + (trayRows - 0.5) * spacing + 0.9;
    const halfW = Math.max(boardW, trayW) / 2 + 0.7;
    if (this.trayMesh) {
      this.trayMesh.scale.set(trayW + 0.8, 1, trayRows * spacing + 0.7);
      this.trayMesh.position.set(0, -0.32, boardD / 2 + FRAMING.trayGap + (trayRows - 1) * spacing / 2);
    }
    // key-light shadow box fitted to the play area (board + tray) only
    const cz = (zTop + zBottom) / 2;
    const radius = Math.hypot(halfW, (zBottom - zTop) / 2) + 1.2;
    const key = this.keyLight, dir = new THREE.Vector3(6, 10, 8).normalize();
    key.target.position.set(0, 0, cz);
    key.position.set(0, 0, cz).addScaledVector(dir, 30);
    Object.assign(key.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 30 - radius - 2, far: 30 + radius + 2 });
    key.shadow.camera.updateProjectionMatrix();

    const pts = [];
    for (const x of [-halfW, halfW]) { pts.push(new THREE.Vector3(x, 0, zTop)); pts.push(new THREE.Vector3(x, 0.6, zBottom)); }
    const look = new THREE.Vector3(0, 1.5, cz);
    const vdir = new THREE.Vector3(0, FRAMING.pitch, 0.72).normalize();
    let d = Math.max(15, (zBottom - zTop) * 1.3, halfW * 2 * 1.5);
    const v = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      this.camera.position.copy(look).addScaledVector(vdir, d);
      this.camera.lookAt(look);
      this.camera.updateMatrixWorld();
      let worst = 0;
      for (const p of pts) { v.copy(p).project(this.camera); worst = Math.max(worst, Math.abs(v.x) / 0.94, Math.abs(v.y) / 0.9); }
      if (worst <= 1) break;
      d *= Math.min(1.5, worst + 0.01);
    }
    this.camera.position.copy(look).addScaledVector(vdir, d);
    this.camera.lookAt(look);
  }

  // Tray columns per row: 10 on wide views, fewer on narrow ones so every
  // tile face stays fully visible with generous targets.
  trayPerRow(total) {
    const aspect = this.camera ? this.camera.aspect : 1.6;
    const max = aspect < 0.8 ? 4 : aspect < 1.2 ? 6 : 10;
    return Math.max(1, Math.min(total, max));
  }

  // Sync visuals from an immutable rules snapshot.
  update(state) {
    if (!this.webgl) return;
    const rs = state.ruleset;
    let newlyPlaced = 0;
    for (const p of state.pieces) {
      const mesh = this.pieceMeshes.get(p.id);
      if (!mesh) continue;
      const t = this.targets.get(p.id);
      if (p.placed) {
        t.pos.copy(this.cellPos(rs, p.placedCell));
        t.pos.y = 0.06;
        t.rot = -p.placedRot * Math.PI / 2;
        if (!this._placedSet.has(p.id)) { this._placedSet.add(p.id); this._burst(t.pos, 14, 1.2); newlyPlaced++; }
      } else {
        const tp = this.trayPos(state.tray.indexOf(p.id), state.tray.length);
        t.pos.copy(tp);
        t.rot = -p.rot * Math.PI / 2;
        this._placedSet.delete(p.id);
      }
      t.lift = (state.selected === p.id) ? 0.55 : 0;
      mesh.userData.selected = state.selected === p.id;
    }
    if (newlyPlaced && state.status === 'complete') {
      for (let c = 0; c < rs.cols * rs.rows; c += 1) this._burst(this.cellPos(rs, c), 6, 2.2);
    }
  }

  showLegalTargets(state, cells) {
    if (!this.webgl) return;
    for (const m of this.markerMeshes) { this.scene.remove(m); disposeObj(m); }
    this.markerMeshes = [];
    const geo = new THREE.RingGeometry(0.32, 0.5, 32);
    geo.rotateX(-Math.PI / 2);
    for (const c of cells) {
      // slightly over-bright so bloom (when on) gives the rings a soft halo
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: RING_COLOR.clone().multiplyScalar(1.6), transparent: true, opacity: 0.85, depthWrite: false }));
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

  // ---------------------------------------------------------------- frame

  render() {
    if (!this.webgl) return;
    const now = performance.now();
    const dt = this._last ? Math.min(250, now - this._last) : 16;
    this._last = now;
    const reduced = this._reduced();
    if (!reduced) this._time += dt / 1000;
    const damp = reduced ? 1 : 0.22; // critically-damped snap, interruptible
    for (const [id, mesh] of this.pieceMeshes) {
      const t = this.targets.get(id);
      if (!t) continue;
      mesh.position.lerp(t.pos, damp);
      // the lifted (selected) tile idles with a gentle bob and a warm glow pulse
      const bob = t.lift && !reduced ? Math.sin(this._time * 2.6) * 0.06 : 0;
      const targetY = t.pos.y + t.lift + bob;
      mesh.position.y += (targetY - mesh.position.y) * damp;
      let dr = t.rot - mesh.rotation.y;
      dr = ((dr + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      mesh.rotation.y += dr * damp;
      const glow = mesh.userData.selected ? 0.16 + (reduced ? 0 : 0.06 * Math.sin(this._time * 3.2)) : 0;
      mesh.material.emissive.setRGB(glow, glow * 0.9, glow * 0.7);
    }
    if (!reduced) {
      for (const m of this.markerMeshes) m.material.opacity = 0.72 + 0.18 * Math.sin(this._time * 3);
      this.picLight.intensity = 90 + Math.sin(this._time * 0.7) * 3; // faint lamp shimmer
    }
    this._updateParticles(dt / 1000);
    const rescale = this._adapt(dt);
    this._resize(rescale);
    const size = this.renderer.getSize(new THREE.Vector2());
    const key = this._postKey(size.x, size.y);
    if (key !== this.postKey) { this.postKey = key; this._buildPost(size.x, size.y); }
    if (this.composer) {
      try { this.composer.render(dt / 1000); } catch (_) { this._postBroken(); this.renderer.render(this.scene, this.camera); }
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    if (this.onFrame) this.onFrame();
  }

  _postKey(w, h) {
    const g = this.q;
    return g.post && !this.postFailed ? [g.ao, g.bloom, g.grade, g.antialias, w, h, this.pixelRatio].join('|') : 'none';
  }

  _postBroken() {
    this.postFailed = true;
    if (this.composer) { try { this.composer.dispose(); } catch (_) { /* ignore */ } }
    this.composer = null;
    this.postKey = 'none';
  }

  _buildPost(w, h) {
    const g = this.q;
    if (this.composer) this.composer.dispose();
    this.composer = null;
    if (!g.post || this.postFailed) return;
    const pr = this.pixelRatio, W = Math.max(1, Math.round(w * pr)), H = Math.max(1, Math.round(h * pr));
    try {
      const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0 });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, W, H);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // high threshold: only the lamp strip, target rings and sparkles glow
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.5, 0.4, 0.9));
      }
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      composer.addPass(new OutputPass());
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(W, H));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / W, 1 / H);
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch (_) {
      // post-processing is an enhancement: render directly and say so in the Graphics panel
      this._postBroken();
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  _adapt(dt) {
    const f = this._frames;
    f.push(dt);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) { const was = this.adaptiveScale; this.adaptiveScale = 1; return was !== 1; }
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, Math.round((this.adaptiveScale - 0.1) * 100) / 100);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, Math.round((this.adaptiveScale + 0.05) * 100) / 100);
    return before !== this.adaptiveScale;
  }

  _resize(force) {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    const ratio = Math.min(window.devicePixelRatio || 1, this.q.cap) * this.q.scale * this.adaptiveScale;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (ratio !== this.pixelRatio || force) {
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
    }
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this._framedState) { this._frameCamera(this._framedState); this.update(this._framedState); }
      return true;
    }
    return false;
  }

  drawCalls() { return this.webgl ? this.renderer.info.render.calls : 0; }
  dispose() {
    if (!this.webgl) return;
    if (this.composer) this.composer.dispose();
    this.renderer.dispose();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}

function disposeObj(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m.map && !cachedTextures.has(m.map) && !m.map.userData.shared) m.map.dispose(); m.dispose(); }
    }
  });
}
