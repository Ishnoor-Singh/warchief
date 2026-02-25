/**
 * Terrain system for the Warchief game engine.
 *
 * Defines terrain features that affect combat, movement, and visibility.
 * Terrain features are axis-aligned rectangles placed on the map.
 *
 * ## Terrain Types
 *
 * - **hill**: Elevated ground. Units on hills get a defense bonus and
 *   increased visibility radius. Slightly slower movement uphill.
 *
 * - **forest**: Dense cover. Units in forests are harder to spot
 *   (reduced visibility for enemies looking in) and get a defense bonus.
 *   Movement is slowed.
 *
 * - **river**: Water obstacle. Units crossing rivers move at half speed
 *   and take a significant defense penalty (vulnerable while wading).
 */

import type { Vec2 } from '../../shared/types/index.js';

// ─── Terrain Types ───────────────────────────────────────────────────────────

export type TerrainType = 'hill' | 'forest' | 'river';

export interface TerrainFeature {
  id: string;
  type: TerrainType;
  /** Top-left corner of the terrain rectangle. */
  position: Vec2;
  /** Width and height of the terrain area. */
  size: Vec2;
}

export interface TerrainMap {
  features: TerrainFeature[];
}

// ─── Terrain Modifiers ───────────────────────────────────────────────────────

export interface TerrainModifiers {
  /** Multiplier on damage taken (< 1 means less damage taken). */
  defenseMultiplier: number;
  /** Multiplier on movement speed (< 1 means slower). */
  speedMultiplier: number;
  /** Additive modifier to visibility radius. */
  visibilityBonus: number;
  /** Multiplier on how visible this unit is to enemies (< 1 = harder to see). */
  concealmentMultiplier: number;
}

const TERRAIN_MODIFIERS: Record<TerrainType, TerrainModifiers> = {
  hill: {
    defenseMultiplier: 0.75,     // 25% less damage taken
    speedMultiplier: 0.85,       // 15% slower
    visibilityBonus: 20,         // +20 visibility radius
    concealmentMultiplier: 1.0,  // no concealment change
  },
  forest: {
    defenseMultiplier: 0.80,     // 20% less damage taken
    speedMultiplier: 0.70,       // 30% slower
    visibilityBonus: -10,        // -10 visibility radius (canopy blocks sightlines)
    concealmentMultiplier: 0.5,  // 50% harder for enemies to spot you
  },
  river: {
    defenseMultiplier: 1.40,     // 40% more damage taken (vulnerable while wading)
    speedMultiplier: 0.45,       // 55% slower
    visibilityBonus: 0,
    concealmentMultiplier: 1.0,
  },
};

// ─── Query Functions ─────────────────────────────────────────────────────────

/** Check if a position is inside a terrain feature. */
export function isInsideFeature(pos: Vec2, feature: TerrainFeature): boolean {
  return (
    pos.x >= feature.position.x &&
    pos.x <= feature.position.x + feature.size.x &&
    pos.y >= feature.position.y &&
    pos.y <= feature.position.y + feature.size.y
  );
}

/** Get the terrain feature at a given position (first match). */
export function getTerrainAt(pos: Vec2, terrain: TerrainMap): TerrainFeature | null {
  for (const feature of terrain.features) {
    if (isInsideFeature(pos, feature)) {
      return feature;
    }
  }
  return null;
}

/** Get all terrain features at a given position (a position can overlap multiple). */
export function getAllTerrainAt(pos: Vec2, terrain: TerrainMap): TerrainFeature[] {
  return terrain.features.filter(f => isInsideFeature(pos, f));
}

/**
 * Get the combined terrain modifiers for a position.
 * If multiple terrain features overlap, their effects stack multiplicatively
 * for multipliers and additively for bonuses.
 */
export function getTerrainModifiers(pos: Vec2, terrain: TerrainMap): TerrainModifiers {
  const features = getAllTerrainAt(pos, terrain);

  if (features.length === 0) {
    return {
      defenseMultiplier: 1.0,
      speedMultiplier: 1.0,
      visibilityBonus: 0,
      concealmentMultiplier: 1.0,
    };
  }

  let defense = 1.0;
  let speed = 1.0;
  let visibility = 0;
  let concealment = 1.0;

  for (const feature of features) {
    const mods = TERRAIN_MODIFIERS[feature.type];
    defense *= mods.defenseMultiplier;
    speed *= mods.speedMultiplier;
    visibility += mods.visibilityBonus;
    concealment *= mods.concealmentMultiplier;
  }

  return {
    defenseMultiplier: defense,
    speedMultiplier: speed,
    visibilityBonus: visibility,
    concealmentMultiplier: concealment,
  };
}

/**
 * Get the effective visibility radius for an agent at a position,
 * considering terrain concealment of the target and terrain bonuses for the viewer.
 */
export function getEffectiveVisibilityRadius(
  viewerPos: Vec2,
  targetPos: Vec2,
  baseRadius: number,
  terrain: TerrainMap,
): number {
  const viewerMods = getTerrainModifiers(viewerPos, terrain);
  const targetMods = getTerrainModifiers(targetPos, terrain);

  // Viewer gets visibility bonus from their terrain (e.g., hilltop)
  const viewerRadius = baseRadius + viewerMods.visibilityBonus;

  // Target concealment reduces effective detection range
  return viewerRadius * targetMods.concealmentMultiplier;
}

/** Create an empty terrain map. */
export function createTerrainMap(features: TerrainFeature[] = []): TerrainMap {
  return { features };
}

/** Get the raw modifiers table for a terrain type. */
export function getTerrainTypeModifiers(type: TerrainType): TerrainModifiers {
  return { ...TERRAIN_MODIFIERS[type] };
}
