/**
 * Warchief Game Engine
 *
 * Core game mechanics module built on top of Matter.js.
 * Provides well-tested, documented primitives for the RTS simulation.
 *
 * ## Modules
 *
 * - **vec2** — Vector math (distance, normalize, moveToward, etc.)
 * - **unit-types** — Unit definitions, presets, and factory functions
 * - **combat** — Damage calculation, death processing, win conditions
 * - **formations** — Formation slot positioning for all 6 formation types
 * - **movement** — Agent movement, pursuit, and arrival detection
 * - **spatial** — Spatial indexing with Matter.js for efficient range queries
 * - **conditions** — Safe condition evaluation (replaces eval())
 *
 * ## Usage
 *
 * ```ts
 * import {
 *   createTroop, createLieutenant, createSquad,
 *   TROOP_PRESETS, LIEUTENANT_PRESETS,
 *   calculateDamage, findCombatPairs,
 *   computeFormationPositions,
 *   updateAllMovement,
 *   evaluateCondition,
 * } from './engine/index.js';
 * ```
 */

// Vector math
export {
  vec2, ZERO,
  add, sub, scale,
  magnitude, magnitudeSq,
  normalize, distance, distanceSq,
  dot, cross, angle, angleBetween,
  rotate, rotateAround,
  lerp, clamp, moveToward, isWithinRange, clone,
} from './vec2.js';

// Unit types and factories
export {
  // Defaults
  DEFAULT_TROOP_STATS,
  DEFAULT_LIEUTENANT_STATS,
  // Presets
  TROOP_PRESETS,
  LIEUTENANT_PRESETS,
  // Constants
  TROOP_VISIBILITY_RADIUS,
  LIEUTENANT_VISIBILITY_RADIUS,
  DEFAULT_HEALTH,
  DEFAULT_MORALE,
  DEFAULT_FORMATION,
  // Factories
  createTroop,
  createLieutenant,
  createSquad,
  // Type guards
  isTroop,
  isLieutenant,
  getTroopStats,
  getLieutenantStats,
} from './unit-types.js';
export type {
  TroopPreset,
  LieutenantPreset,
  CreateTroopOptions,
  CreateLieutenantOptions,
  TroopAgent,
  LieutenantAgent,
} from './unit-types.js';

// Combat
export {
  COMBAT_RANGE,
  BASE_DAMAGE,
  DAMAGE_VARIANCE,
  MORALE_LOSS_ON_ALLY_DEATH,
  MORALE_EFFECT_RANGE,
  DEFAULT_COMBAT_STAT,
  WIN_THRESHOLD,
  calculateDamage,
  applyDamage,
  applyMoraleLoss,
  isInCombatRange,
  findCombatPairs,
  buildSquadCasualties,
  recordSquadDeath,
  getTeamStrength,
  checkWinCondition,
} from './combat.js';
export type { SquadCasualties, TeamStrength } from './combat.js';

// Formations
export {
  FORMATION_SPACING,
  FORMATION_FORWARD_OFFSET,
  DEFAULT_FACING,
  computeFormationSlot,
  computeFormationPositions,
} from './formations.js';

// Movement
export {
  DEFAULT_SPEED,
  getSpeed,
  computeMovementTick,
  updateAllMovement,
  repositionInFormation,
  getVisibleEnemies,
} from './movement.js';
export type { MovementResult } from './movement.js';

// Spatial indexing
export {
  createSpatialWorld,
  addBody,
  removeBody,
  updateBodyPosition,
  queryRange,
  queryPairsInRange,
  destroySpatialWorld,
} from './spatial.js';
export type { SpatialWorld } from './spatial.js';

// Condition evaluation
export { evaluateCondition } from './conditions.js';

// Terrain
export {
  createTerrainMap,
  getTerrainAt,
  getAllTerrainAt,
  getTerrainModifiers,
  getEffectiveVisibilityRadius,
  getTerrainTypeModifiers,
  isInsideFeature,
} from './terrain.js';
export type { TerrainType, TerrainFeature, TerrainMap, TerrainModifiers } from './terrain.js';

// Combat modifiers
export {
  getFormationModifiers,
  calculateFlankingMultiplier,
  calculateChargeBonusDamage,
} from './combat-modifiers.js';
export type { FormationCombatModifiers, FlankDirection, FlankingResult } from './combat-modifiers.js';

// Morale
export {
  shouldRout,
  applyRoutingPanic,
  checkMoraleRecovery,
  ROUT_MORALE_THRESHOLD,
  ROUTING_PANIC_RANGE,
  ROUTING_PANIC_MORALE_LOSS,
  MORALE_RECOVERY_RATE,
} from './morale.js';
