/**
 * Morale and routing system for the Warchief game engine.
 *
 * Troops have morale (0-100) and courage (1-10). When morale drops
 * below a threshold, there's a probability check against courage to
 * determine if the unit routs (breaks formation and flees).
 *
 * ## Routing Mechanics
 *
 * - Morale must be below ROUT_MORALE_THRESHOLD for routing to be possible
 * - Probability of routing increases as morale drops further below threshold
 * - High courage reduces routing probability
 * - Routing units flee toward their spawn side
 * - Routing units spread panic to nearby allies (morale loss)
 * - Out-of-combat units slowly recover morale
 *
 * ## Morale Formula
 *
 * ```
 * routChance = (1 - morale/threshold) * (1 - courage/12)
 * ```
 *
 * At morale 0: routChance ≈ 1.0 * (1 - courage/12)
 *   courage 1 → ~92% chance
 *   courage 10 → ~17% chance
 *
 * At morale = threshold/2:
 *   routChance ≈ 0.5 * (1 - courage/12)
 */

import type { AgentState } from '../../shared/types/index.js';
import { isTroop } from './unit-types.js';
import * as Vec from './vec2.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Morale must be below this threshold for routing to be possible. */
export const ROUT_MORALE_THRESHOLD = 40;

/** Range within which a routing unit spreads panic to allies. */
export const ROUTING_PANIC_RANGE = 40;

/** Morale lost by nearby allies when a unit routs. */
export const ROUTING_PANIC_MORALE_LOSS = 8;

/** Morale recovered per tick when out of combat. */
export const MORALE_RECOVERY_RATE = 0.5;

// ─── Routing Check ───────────────────────────────────────────────────────────

/**
 * Determine if a unit should rout based on current morale and courage.
 *
 * @param morale - Current morale (0-100)
 * @param courage - Courage stat (1-10)
 * @param rng - Random number generator, returns 0-1
 * @returns true if the unit should rout
 */
export function shouldRout(
  morale: number,
  courage: number,
  rng: () => number = Math.random,
): boolean {
  // Above threshold — never routs
  if (morale >= ROUT_MORALE_THRESHOLD) return false;

  // Calculate route probability
  // As morale drops from threshold to 0, base chance goes from 0 to 1
  const moraleRatio = 1 - (morale / ROUT_MORALE_THRESHOLD);

  // Courage (1-10) reduces the chance. Divide by 12 so even courage 10
  // doesn't make routing impossible at morale 0.
  const courageResistance = courage / 12;

  const routChance = moraleRatio * (1 - courageResistance);

  return rng() < routChance;
}

// ─── Routing Panic ───────────────────────────────────────────────────────────

/**
 * Apply morale loss to nearby allies when a unit routs.
 *
 * Routing is contagious — seeing a comrade flee damages morale.
 *
 * @param routingAgent - The unit that is routing
 * @param allAgents - All agents in the simulation
 * @returns List of agents affected by the panic
 */
export function applyRoutingPanic(
  routingAgent: AgentState,
  allAgents: Iterable<AgentState>,
): AgentState[] {
  const affected: AgentState[] = [];

  for (const other of allAgents) {
    if (other.id === routingAgent.id) continue;
    if (other.team !== routingAgent.team) continue;
    if (!other.alive) continue;

    const dist = Vec.distance(routingAgent.position, other.position);
    if (dist < ROUTING_PANIC_RANGE) {
      other.morale = Math.max(0, other.morale - ROUTING_PANIC_MORALE_LOSS);
      affected.push(other);
    }
  }

  return affected;
}

// ─── Morale Recovery ─────────────────────────────────────────────────────────

/**
 * Recover morale for a unit that is not in combat.
 *
 * @param agent - The unit to recover morale for
 * @param inCombat - Whether the unit is currently in combat
 * @returns true if morale was recovered
 */
export function checkMoraleRecovery(
  agent: AgentState,
  inCombat: boolean,
): boolean {
  if (inCombat) return false;
  if (agent.morale >= 100) return false;

  agent.morale = Math.min(100, agent.morale + MORALE_RECOVERY_RATE);
  return true;
}
