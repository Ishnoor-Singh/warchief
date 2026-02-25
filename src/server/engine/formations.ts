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
 * ## Spacing
 *
 * Default spacing between units is 15 world units.
 * Formations offset troops 20-30 units forward of the lieutenant.
 */

import type { Vec2, FormationType } from '../../shared/types/index.js';

/** Default spacing between units in formation. */
export const FORMATION_SPACING = 15;

/** Forward offset from lieutenant to first row of troops. */
export const FORMATION_FORWARD_OFFSET = 30;

/**
 * Compute the position of a single troop slot within a formation.
 *
 * @param formation - The formation type
 * @param center - The center point (usually the lieutenant's position)
 * @param index - The troop's index within the formation (0-based)
 * @param total - Total number of troops in the formation
 * @param spacing - Distance between adjacent troops (default: FORMATION_SPACING)
 * @returns The world position for this troop slot
 */
export function computeFormationSlot(
  formation: FormationType,
  center: Vec2,
  index: number,
  total: number,
  spacing: number = FORMATION_SPACING,
): Vec2 {
  // Guard against invalid inputs
  if (total <= 0) return { x: center.x, y: center.y };
  if (index < 0 || index >= total) return { x: center.x, y: center.y };

  switch (formation) {
    case 'line':
      return computeLineSlot(center, index, total, spacing);
    case 'column':
      return computeColumnSlot(center, index, spacing);
    case 'wedge':
      return computeWedgeSlot(center, index, spacing);
    case 'defensive_circle':
      return computeCircleSlot(center, index, total, spacing);
    case 'scatter':
      return computeScatterSlot(center, index, total, spacing);
    case 'pincer':
      return computePincerSlot(center, index, total, spacing);
  }
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
): Vec2[] {
  const positions: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    positions.push(computeFormationSlot(formation, center, i, count, spacing));
  }
  return positions;
}

// ─── Individual Formation Computations ──────────────────────────────────────

/**
 * Line formation: horizontal row centered on leader, offset forward.
 *
 * ```
 *         [Lt]
 *   T  T  T  T  T  T
 * ```
 */
function computeLineSlot(center: Vec2, index: number, total: number, spacing: number): Vec2 {
  const startX = center.x - ((total - 1) * spacing) / 2;
  return {
    x: startX + index * spacing,
    y: center.y + FORMATION_FORWARD_OFFSET,
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
function computeColumnSlot(center: Vec2, index: number, spacing: number): Vec2 {
  return {
    x: center.x,
    y: center.y + 20 + index * spacing,
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
function computeWedgeSlot(center: Vec2, index: number, spacing: number): Vec2 {
  const row = Math.floor(index / 2);
  const side = index % 2 === 0 ? -1 : 1;
  return {
    x: center.x + side * row * spacing,
    y: center.y + 20 + row * spacing,
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
function computeCircleSlot(center: Vec2, index: number, total: number, spacing: number): Vec2 {
  const radius = Math.max(30, (total * spacing) / (2 * Math.PI));
  const angle = (index / total) * 2 * Math.PI;
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
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
function computeScatterSlot(center: Vec2, index: number, total: number, spacing: number): Vec2 {
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const row = Math.floor(index / cols);
  const col = index % cols;
  return {
    x: center.x - (cols * spacing) / 2 + col * spacing * 1.5,
    y: center.y - (rows * spacing) / 2 + row * spacing * 1.5,
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
function computePincerSlot(center: Vec2, index: number, total: number, spacing: number): Vec2 {
  const half = Math.ceil(total / 2);

  if (index < half) {
    // Left group
    return {
      x: center.x - 40,
      y: center.y + (index - half / 2) * spacing,
    };
  } else {
    // Right group
    const i = index - half;
    const rightCount = total - half;
    return {
      x: center.x + 40,
      y: center.y + (i - rightCount / 2) * spacing,
    };
  }
}
