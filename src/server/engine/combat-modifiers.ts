/**
 * Combat modifiers for the Warchief game engine.
 *
 * Provides tactical modifiers that make formations, positioning, and
 * movement matter in combat:
 *
 * ## Formation Modifiers
 * Each formation type gives attack/defense multipliers:
 * - line: Balanced (1.0/1.0)
 * - wedge: Offensive (1.3/0.8) — punch through lines
 * - defensive_circle: Defensive (0.7/1.4) — hold against superior numbers
 * - scatter: Evasive (0.85/1.15) — harder to hit
 * - pincer: Flanking (1.2/0.9) — envelop enemies
 * - column: March (0.6/0.7) — terrible in combat, meant for movement
 *
 * ## Flanking
 * Attacks from the side or rear deal more damage:
 * - Front (within ±60°): 1.0x
 * - Side (60°–120°): 1.3x
 * - Rear (beyond 120°): 1.6x
 *
 * ## Charge Momentum
 * Units that were moving when they enter combat deal bonus first-hit damage
 * proportional to their speed. Capped at 100% of base damage.
 */

import type { Vec2, FormationType } from '../../shared/types/index.js';

// ─── Formation Modifiers ─────────────────────────────────────────────────────

export interface FormationCombatModifiers {
  attackMultiplier: number;
  defenseMultiplier: number;
}

const FORMATION_MODIFIERS: Record<FormationType, FormationCombatModifiers> = {
  line: { attackMultiplier: 1.0, defenseMultiplier: 1.0 },
  wedge: { attackMultiplier: 1.3, defenseMultiplier: 0.8 },
  defensive_circle: { attackMultiplier: 0.7, defenseMultiplier: 1.4 },
  scatter: { attackMultiplier: 0.85, defenseMultiplier: 1.15 },
  pincer: { attackMultiplier: 1.2, defenseMultiplier: 0.9 },
  column: { attackMultiplier: 0.6, defenseMultiplier: 0.7 },
};

/** Get the combat modifiers for a formation type. */
export function getFormationModifiers(formation: FormationType): FormationCombatModifiers {
  return { ...FORMATION_MODIFIERS[formation] };
}

// ─── Flanking Detection ──────────────────────────────────────────────────────

export type FlankDirection = 'front' | 'side' | 'rear';

export interface FlankingResult {
  direction: FlankDirection;
  multiplier: number;
}

/** Flanking damage multipliers by direction. */
const FLANK_MULTIPLIERS: Record<FlankDirection, number> = {
  front: 1.0,
  side: 1.3,
  rear: 1.6,
};

/**
 * Calculate the flanking damage multiplier based on attacker position
 * relative to the defender's facing direction.
 *
 * Uses the dot product of the defender's facing vector and the
 * vector from defender to attacker to determine the angle.
 *
 * - cos(θ) > 0.5 (within ~60°): front
 * - cos(θ) < -0.5 (beyond ~120°): rear
 * - otherwise: side
 */
export function calculateFlankingMultiplier(
  attackerPos: Vec2,
  defenderPos: Vec2,
  defenderFacing: Vec2,
): FlankingResult {
  // Vector from defender to attacker
  const dx = attackerPos.x - defenderPos.x;
  const dy = attackerPos.y - defenderPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.001) {
    return { direction: 'front', multiplier: FLANK_MULTIPLIERS.front };
  }

  // Normalize
  const nx = dx / dist;
  const ny = dy / dist;

  // Normalize facing
  const fMag = Math.sqrt(defenderFacing.x * defenderFacing.x + defenderFacing.y * defenderFacing.y);
  if (fMag < 0.001) {
    return { direction: 'front', multiplier: FLANK_MULTIPLIERS.front };
  }
  const fx = defenderFacing.x / fMag;
  const fy = defenderFacing.y / fMag;

  // Dot product: cos of angle between facing and attacker direction
  const dotProduct = fx * nx + fy * ny;

  let direction: FlankDirection;
  if (dotProduct > 0.5) {
    direction = 'front';
  } else if (dotProduct < -0.5) {
    direction = 'rear';
  } else {
    direction = 'side';
  }

  return {
    direction,
    multiplier: FLANK_MULTIPLIERS[direction],
  };
}

// ─── Charge Momentum ─────────────────────────────────────────────────────────

/** Charge bonus multiplier per unit of speed. */
const CHARGE_BONUS_PER_SPEED = 0.15;

/** Maximum charge bonus as a fraction of base damage. */
const CHARGE_BONUS_CAP = 1.0;

/**
 * Calculate bonus damage from a charging unit.
 *
 * A unit that was moving when it enters combat deals extra damage
 * on its first hit, proportional to its speed.
 *
 * @param baseDamage - The base damage before charge bonus
 * @param wasMoving - Whether the unit was moving before combat started
 * @param speed - The unit's movement speed
 * @returns The bonus damage to add (not a multiplier)
 */
export function calculateChargeBonusDamage(
  baseDamage: number,
  wasMoving: boolean,
  speed: number,
): number {
  if (!wasMoving || speed <= 0) return 0;

  const bonusFraction = Math.min(CHARGE_BONUS_CAP, speed * CHARGE_BONUS_PER_SPEED);
  return Math.round(baseDamage * bonusFraction);
}
