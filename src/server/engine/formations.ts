/**
 * Formation positioning module for the Warchief game engine.
 *
 * Computes where each troop should stand relative to their lieutenant
 * based on the current formation type.
 *
 * ## Formation Types
 *
 * - **line**: Horizontal row centered on the lieutenant, offset forward.
 *   Good for broad front engagements.
 *
 * - **column**: Single file extending forward from the lieutenant.
 *   Good for marching through narrow terrain.
 *
 * - **wedge**: V-shape pointing forward with troops fanning out.
 *   Good for concentrated forward push.
 *
 * - **defensive_circle**: Ring of troops around the lieutenant.
 *   Good for all-around defense when surrounded.
 *
 * - **scatter**: Loose grid spread around the lieutenant.
 *   Good for reducing vulnerability to area effects.
 *
 * - **pincer**: Two flanking groups on left and right.
 *   Good for enveloping an enemy position.
 *
 * ## Facing Direction
 *
 * All formations are computed relative to a `facing` direction — the
 * world-space vector pointing "forward" (toward the enemy). This allows
 * formations to be oriented correctly for any battle layout.
 *
 * Default facing is south (+y), matching the demo playground.
 * In the game simulation, pass team-appropriate facing:
 *   - Player team: { x: 1, y: 0 } (east, toward right side of map)
 *   - Enemy team:  { x: -1, y: 0 } (west, toward left side of map)
 *
 * ## Spacing
 *
 * Default spacing between units is 15 world units.
 * Formations offset troops 30 units forward of the lieutenant.
 */

import type { Vec2, FormationType } from '../../shared/types/index.js';

/** Default spacing between units in formation. */
export const FORMATION_SPACING = 15;

/** Forward offset from lieutenant to first row of troops. */
export const FORMATION_FORWARD_OFFSET = 30;

/** Default facing direction (south = +y). Used by the demo playground. */
export const DEFAULT_FACING: Readonly<Vec2> = Object.freeze({ x: 0, y: 1 });

/**
 * Apply a facing direction to transform a local formation offset to world space.
 *
 * In canonical (local) space: forward = +y, right = +x.
 * The facing parameter specifies the desired world-space forward direction.
 *
 * Transforms:
 *   local_x (right)   → world right = { x: facing.y, y: -facing.x }
 *   local_y (forward) → world forward = facing
 */
function applyFacing(center: Vec2, localOffset: Vec2, facing: Vec2): Vec2 {
  // right = 90° clockwise from facing
  const rightX = facing.y;
  const rightY = -facing.x;
  return {
    x: center.x + localOffset.x * rightX + localOffset.y * facing.x,
    y: center.y + localOffset.x * rightY + localOffset.y * facing.y,
  };
}

/**
 * Compute the position of a single troop slot within a formation.
 *
 * @param formation - The formation type
 * @param center - The center point (usually the lieutenant's position)
 * @param index - The troop's index within the formation (0-based)
 * @param total - Total number of troops in the formation
 * @param spacing - Distance between adjacent troops (default: FORMATION_SPACING)
 * @param facing - World-space forward direction (default: south/+y for demo)
 * @returns The world position for this troop slot
 */
export function computeFormationSlot(
  formation: FormationType,
  center: Vec2,
  index: number,
  total: number,
  spacing: number = FORMATION_SPACING,
  facing: Vec2 = DEFAULT_FACING,
): Vec2 {
  // Guard against invalid inputs
  if (total <= 0) return { x: center.x, y: center.y };
  if (index < 0 || index >= total) return { x: center.x, y: center.y };

  const localOffset = computeLocalSlot(formation, index, total, spacing);
  return applyFacing(center, localOffset, facing);
}

/**
 * Compute all formation slot positions for a group of troops.
 *
 * Returns an array of positions, one per troop, in index order.
 */
export function computeFormationPositions(
  formation: FormationType,
  center: Vec2,
  count: number,
  spacing: number = FORMATION_SPACING,
  facing: Vec2 = DEFAULT_FACING,
): Vec2[] {
  const positions: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    positions.push(computeFormationSlot(formation, center, i, count, spacing, facing));
  }
  return positions;
}

// ─── Local Slot Computation (canonical space: forward = +y) ─────────────────

/**
 * Compute a formation slot offset in canonical space (forward = south/+y).
 * Returns { x: right-offset, y: forward-offset } relative to center.
 */
function computeLocalSlot(
  formation: FormationType,
  index: number,
  total: number,
  spacing: number,
): Vec2 {
  switch (formation) {
    case 'line':
      return computeLineLocal(index, total, spacing);
    case 'column':
      return computeColumnLocal(index, spacing);
    case 'wedge':
      return computeWedgeLocal(index, spacing);
    case 'defensive_circle':
      return computeCircleLocal(index, total, spacing);
    case 'scatter':
      return computeScatterLocal(index, total, spacing);
    case 'pincer':
      return computePincerLocal(index, total, spacing);
  }
}

// ─── Individual Formation Local Computations ─────────────────────────────────

/**
 * Line formation: row perpendicular to facing, offset forward.
 *
 * ```
 *         [Lt]
 *   T  T  T  T  T  T
 * ```
 */
function computeLineLocal(index: number, total: number, spacing: number): Vec2 {
  return {
    x: (index - (total - 1) / 2) * spacing,
    y: FORMATION_FORWARD_OFFSET,
  };
}

/**
 * Column formation: single file extending forward.
 *
 * ```
 *   [Lt]
 *    T
 *    T
 *    T
 *    T
 * ```
 */
function computeColumnLocal(index: number, spacing: number): Vec2 {
  return {
    x: 0,
    y: 20 + index * spacing,
  };
}

/**
 * Wedge formation: V-shape pointing forward.
 *
 * ```
 *      [Lt]
 *       T
 *      T T
 *     T   T
 *    T     T
 * ```
 */
function computeWedgeLocal(index: number, spacing: number): Vec2 {
  const row = Math.floor(index / 2);
  const side = index % 2 === 0 ? -1 : 1;
  return {
    x: side * row * spacing,
    y: 20 + row * spacing,
  };
}

/**
 * Defensive circle: ring of troops around the leader.
 *
 * ```
 *      T
 *    T [Lt] T
 *      T
 * ```
 */
function computeCircleLocal(index: number, total: number, spacing: number): Vec2 {
  const radius = Math.max(30, (total * spacing) / (2 * Math.PI));
  const angle = (index / total) * 2 * Math.PI;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

/**
 * Scatter formation: loose grid spread around the leader.
 *
 * ```
 *   T     T     T
 *      T     T
 *   T     T     T
 * ```
 */
function computeScatterLocal(index: number, total: number, spacing: number): Vec2 {
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const row = Math.floor(index / cols);
  const col = index % cols;
  return {
    x: (col - (cols - 1) / 2) * spacing * 1.5,
    y: (row - (rows - 1) / 2) * spacing * 1.5,
  };
}

/**
 * Pincer formation: two flanking groups on left and right.
 *
 * ```
 *   T           T
 *   T   [Lt]    T
 *   T           T
 * ```
 */
function computePincerLocal(index: number, total: number, spacing: number): Vec2 {
  const half = Math.ceil(total / 2);
  const flankOffset = 40;

  if (index < half) {
    // Left group
    return {
      x: -flankOffset,
      y: (index - (half - 1) / 2) * spacing,
    };
  } else {
    // Right group
    const i = index - half;
    const rightCount = total - half;
    return {
      x: flankOffset,
      y: (i - (rightCount - 1) / 2) * spacing,
    };
  }
}
