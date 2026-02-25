/**
 * Combat resolution module for the Warchief game engine.
 *
 * Handles damage calculation, death processing, morale effects,
 * and casualty tracking. All combat is stat-based with controlled
 * variance for unpredictability.
 *
 * ## Combat Model
 *
 * Two units fight when they are within COMBAT_RANGE of each other.
 * Both combatants deal damage simultaneously each tick.
 *
 * ### Damage Formula
 * ```
 * damage = BASE_DAMAGE * (attackerCombat / defenderCombat) * (1 +/- DAMAGE_VARIANCE)
 * ```
 *
 * ### Morale Effects
 * - Nearby allies lose morale when a unit dies (MORALE_LOSS_ON_ALLY_DEATH)
 * - Morale affects courage checks (not yet implemented as probability)
 *
 * ### Casualty Tracking
 * - Per-squad casualty percentages are tracked
 * - Threshold events fire at 25%, 50%, 75% casualties
 * - Squad wipe events fire when a squad is completely destroyed
 */

import type { AgentState, CombatResult, TroopStats, Vec2 } from '../../shared/types/index.js';
import { isTroop } from './unit-types.js';
import * as Vec from './vec2.js';

// ─── Combat Constants ───────────────────────────────────────────────────────

/** Distance within which units can fight. */
export const COMBAT_RANGE = 25;

/** Base damage dealt per combat tick before stat modifiers. */
export const BASE_DAMAGE = 10;

/** Random damage variance as a fraction (0.2 = +/- 20%). */
export const DAMAGE_VARIANCE = 0.2;

/** Morale lost by nearby allies when a unit dies. */
export const MORALE_LOSS_ON_ALLY_DEATH = 5;

/** Range within which allies are affected by a nearby death. */
export const MORALE_EFFECT_RANGE = 50;

/** Default combat stat for units that don't have one. */
export const DEFAULT_COMBAT_STAT = 5;

// ─── Damage Calculation ─────────────────────────────────────────────────────

/**
 * Calculate damage from an attacker to a defender.
 *
 * Uses the attacker's combat stat vs the defender's combat stat,
 * scaled by base damage with random variance.
 *
 * @param attacker - The attacking agent
 * @param defender - The defending agent
 * @param rng - Optional random number generator (0-1). Defaults to Math.random.
 *              Pass a fixed value for deterministic tests.
 */
export function calculateDamage(
  attacker: AgentState,
  defender: AgentState,
  rng: () => number = Math.random
): CombatResult {
  const attackPower = getAgentCombatStat(attacker);
  const defensePower = getAgentCombatStat(defender);

  const statRatio = attackPower / defensePower;
  const variance = 1 + (rng() - 0.5) * DAMAGE_VARIANCE;
  const damage = Math.max(1, Math.round(BASE_DAMAGE * statRatio * variance));

  return {
    attackerId: attacker.id,
    defenderId: defender.id,
    damage,
    defenderDied: false,
  };
}

/**
 * Apply damage to an agent, handling death if health drops to zero.
 *
 * Returns true if the agent died from this damage.
 */
export function applyDamage(agent: AgentState, damage: number): boolean {
  agent.health = Math.max(0, agent.health - damage);

  if (agent.health <= 0) {
    agent.alive = false;
    return true;
  }

  return false;
}

/**
 * Process morale loss for allies near a recently killed unit.
 *
 * Allies within MORALE_EFFECT_RANGE lose MORALE_LOSS_ON_ALLY_DEATH morale.
 */
export function applyMoraleLoss(
  deadAgent: AgentState,
  allAgents: Iterable<AgentState>,
): AgentState[] {
  const affected: AgentState[] = [];

  for (const other of allAgents) {
    if (other.team !== deadAgent.team) continue;
    if (!other.alive) continue;
    if (other.id === deadAgent.id) continue;

    const dist = Vec.distance(deadAgent.position, other.position);
    if (dist < MORALE_EFFECT_RANGE) {
      other.morale = Math.max(0, other.morale - MORALE_LOSS_ON_ALLY_DEATH);
      affected.push(other);
    }
  }

  return affected;
}

/**
 * Check if two agents are within combat range of each other.
 */
export function isInCombatRange(a: AgentState, b: AgentState): boolean {
  return Vec.isWithinRange(a.position, b.position, COMBAT_RANGE);
}

/**
 * Find all combat pairs among a list of agents.
 *
 * Returns pairs of opposing-team agents that are within COMBAT_RANGE.
 * Each pair is returned once (not duplicated as [a,b] and [b,a]).
 */
export function findCombatPairs(agents: AgentState[]): Array<[AgentState, AgentState]> {
  const alive = agents.filter(a => a.alive);
  const pairs: Array<[AgentState, AgentState]> = [];

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i]!;
      const b = alive[j]!;

      if (a.team === b.team) continue;
      if (isInCombatRange(a, b)) {
        pairs.push([a, b]);
      }
    }
  }

  return pairs;
}

// ─── Squad Casualty Tracking ────────────────────────────────────────────────

export interface SquadCasualties {
  total: number;
  dead: number;
}

/**
 * Build initial squad casualty tracking from a list of agents.
 *
 * Keys are `${team}:${squadId}`.
 */
export function buildSquadCasualties(agents: AgentState[]): Map<string, SquadCasualties> {
  const map = new Map<string, SquadCasualties>();

  for (const agent of agents) {
    if (!isTroop(agent)) continue;

    const key = `${agent.team}:${agent.squadId}`;
    const existing = map.get(key) || { total: 0, dead: 0 };
    existing.total++;
    map.set(key, existing);
  }

  return map;
}

/**
 * Record a death in squad casualty tracking.
 *
 * Returns the updated loss percentage, or null if squad not found.
 */
export function recordSquadDeath(
  casualties: Map<string, SquadCasualties>,
  agent: AgentState
): number | null {
  if (!isTroop(agent)) return null;

  const key = `${agent.team}:${agent.squadId}`;
  const squad = casualties.get(key);
  if (!squad) return null;

  squad.dead++;
  return Math.round((squad.dead / squad.total) * 100);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract the combat stat from any agent (troop or lieutenant). */
function getAgentCombatStat(agent: AgentState): number {
  if (isTroop(agent)) {
    return agent.stats.combat || DEFAULT_COMBAT_STAT;
  }
  // Lieutenants don't have a combat stat - use default
  return DEFAULT_COMBAT_STAT;
}

// ─── Win Condition ──────────────────────────────────────────────────────────

/** Minimum strength ratio before a side loses (20%). */
export const WIN_THRESHOLD = 0.2;

export interface TeamStrength {
  alive: number;
  total: number;
  ratio: number;
}

/**
 * Calculate the strength (alive troop count) for each team.
 */
export function getTeamStrength(agents: Iterable<AgentState>): { player: TeamStrength; enemy: TeamStrength } {
  let playerAlive = 0, playerTotal = 0;
  let enemyAlive = 0, enemyTotal = 0;

  for (const agent of agents) {
    if (agent.type !== 'troop') continue;

    if (agent.team === 'player') {
      playerTotal++;
      if (agent.alive) playerAlive++;
    } else {
      enemyTotal++;
      if (agent.alive) enemyAlive++;
    }
  }

  return {
    player: {
      alive: playerAlive,
      total: playerTotal,
      ratio: playerTotal > 0 ? playerAlive / playerTotal : 0,
    },
    enemy: {
      alive: enemyAlive,
      total: enemyTotal,
      ratio: enemyTotal > 0 ? enemyAlive / enemyTotal : 0,
    },
  };
}

/**
 * Check if the battle should end.
 *
 * Returns the winning team, or null if the battle continues.
 * A team wins when the opposing team drops below WIN_THRESHOLD (20%) strength.
 */
export function checkWinCondition(agents: Iterable<AgentState>): 'player' | 'enemy' | null {
  const strength = getTeamStrength(agents);

  if (strength.enemy.total > 0 && strength.enemy.ratio < WIN_THRESHOLD) {
    return 'player';
  }
  if (strength.player.total > 0 && strength.player.ratio < WIN_THRESHOLD) {
    return 'enemy';
  }

  return null;
}
