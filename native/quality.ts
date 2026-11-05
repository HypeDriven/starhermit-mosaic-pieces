// The look per graphics level. The engine-owned effects (shadows and their map
// size, ambient occlusion, bloom, the grade, anti-aliasing) are the level's own
// (levelSettings(): the same table every StarHermit game reads). The game's art
// (tile shading, textures, dust, reflections, detail) is the browser build's
// four presets and budgets (gfx.js TABLE / BUDGETS) keyed by the level's quality
// tier, with the dust motes scaled within the tier by the level's particle
// budget against the tier's anchor level (quantum, molecular, terrestrial,
// galactic), at most 2×. The runtime owns the rest of what the old Settings ›
// Graphics section did: Auto and the level choice, render scale and the
// pixel-ratio cap, adaptive resolution, the frame-rate limit and readout, the
// GPU summary. The old section's per-category overrides are not offered (the
// runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Tile shading: Lambert (Low), Standard (Balanced), glazed Physical with clear coat (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Tile-face texture size in px. */
  tile: number;
  /** Baked stone-slab texture size in px (desk wood 2× wide, tray felt half). */
  texture: number;
  /** Drifting dust motes (Particles on). */
  dust: number;
}
export interface Look {
  preset: QualityTier;
  /** The level's key-light shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  /** Room-environment reflections, the glazed clear coat and the gilt frame. */
  reflections: boolean;
  /** Wood grain, stone slab, tray felt and the glazed tile faces. */
  detailed: boolean;
  /** Dust in the lamp light and placement sparkles. */
  particles: boolean;
  budget: Budget;
}

type Art = Pick<Look, "reflections" | "detailed" | "particles">;
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, detailed: false, particles: false },
  balanced: { reflections: true, detailed: true, particles: true },
  high: { reflections: true, detailed: true, particles: true },
  ultra: { reflections: true, detailed: true, particles: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", tile: 128, texture: 256, dust: 40 },
  balanced: { material: "standard", tile: 256, texture: 256, dust: 70 },
  high: { material: "physical", tile: 256, texture: 512, dust: 110 },
  ultra: { material: "physical", tile: 512, texture: 1024, dust: 180 },
};
export const DUST_MAX = 360;
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = BUDGETS[preset];
  // The dust grows with the level's particle budget above the tier's anchor, at most 2× (gfx.js budgetFor).
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: { ...b, tile: Math.min(b.tile, s.maxTextureSize), texture: Math.min(b.texture, s.maxTextureSize),
      dust: Math.min(DUST_MAX, Math.round(b.dust * k)) },
  };
}
