// The look per graphics level: the browser build's four presets and budgets
// (gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU its
// Auto gave it) keyed by the runtime's quality tier (frame().quality), with
// the dust motes scaled within the tier by the level (frame().levelIndex), as
// the browser build scaled them by its hardware level (at most 2×). The
// runtime owns the rest of what the old Settings › Graphics section did: Auto
// and the level choice, render scale and the pixel-ratio cap, adaptive
// resolution, the frame-rate limit and readout, the GPU summary. The old
// section's per-category overrides are not offered (the runtime's Options
// choose a level).
import type { QualityTier } from "starhermit:engine";
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
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
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

const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, detailed: false, particles: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, detailed: true, particles: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, detailed: true, particles: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, detailed: true, particles: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", tile: 128, texture: 256, dust: 40, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", tile: 256, texture: 256, dust: 70, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", tile: 256, texture: 512, dust: 110, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", tile: 512, texture: 1024, dust: 180, bloomRes: 1, aoRes: 1 },
};
export const DUST_MAX = 360;
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: the dust grows with the level above the tier's first, at
  // most 2× (gfx.js budgetFor).
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.dust = Math.min(DUST_MAX, Math.round(b.dust * k));
  return { preset, ...TABLE[preset], budget: b };
}
