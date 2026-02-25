/**
 * Movement module for the Warchief game engine.
 *
 * Handles moving agents toward targets (positions or other agents),
 * arrival detection, and formation repositioning.
 *
 * ## Movement Model
 *
 * Units move in a straight line toward their target at a constant
 * speed determined by their `speed` stat. When they arrive within
 * one tick's movement distance, they snap to the target position.
 *
 * Movement priorities:
 * 1. If the agent has a `targetId`, move toward that agent (pursuing)
 * 2. If the agent has a `targetPosition`, move toward that position
 * 3. Otherwise, stay in place
 */

import type { AgentState, TroopStats } from '../../shared/types/index.js';
import * as Vec from './vec2.js';
import type { Vec2 } from './vec2.js';
import { isTroop } from './unit-types.js';
import { computeFormationSlot } from './formations.js';

/** Default movement speed if not specified in stats. */
export const DEFAULT_SPEED = 2;

/**
 * Get an agent's movement speed from their stats.
 */
export function getSpeed(agent: AgentState): number {
  if (isTroop(agent)) {
    return agent.stats.speed || DEFAULT_SPEED;
  }
  return DEFAULT_SPEED;
}

export interface MovementResult {
  /** Whether the agent arrived at its target this tick. */
  arrived: boolean;
  /** The agent's new position. */
  position: Vec2;
}

/**
 * Compute one tick of movement for an agent.
 *
 * Does not mutate the agent. Returns the new position and whether
 * the agent has arrived at its destination.
 *
 * @param agent - The agent to move
 * @param targetPos - The position to move toward (could be a target agent's position)
 * @param isChasing - True if the agent is chasing another agent (don't snap to arrival)
 */
export function computeMovementTick(
  agent: AgentState,
  targetPos: Vec2,
  isChasing: boolean = false,
): MovementResult {
  const speed = getSpeed(agent);
  const dist = Vec.distance(agent.position, targetPos);

  if (dist <= speed) {
    // Close enough to arrive
    if (isChasing) {
      // When chasing, don't snap to target position — stay at current distance
      return { arrived: false, position: agent.position };
    }
    return { arrived: true, position: Vec.clone(targetPos) };
  }

  // Move toward target at constant speed
  const newPos = Vec.moveToward(agent.position, targetPos, speed);
  return { arrived: false, position: newPos };
}

/**
 * Update all agent positions in a single tick.
 *
 * Handles:
 * - Moving toward target agents (pursuing)
 * - Moving toward target positions
 * - Arrival detection and event generation
 *
 * Mutates agents in place. Returns a list of agents that arrived.
 */
export function updateAllMovement(
  agents: Map<string, AgentState>,
): AgentState[] {
  const arrivedAgents: AgentState[] = [];

  for (const agent of agents.values()) {
    if (!agent.alive) continue;

    let targetPos: Vec2 | null = null;
    let isChasing = false;

    if (agent.targetId) {
      // Pursuing another agent
      const target = agents.get(agent.targetId);
      if (target && target.alive) {
        targetPos = target.position;
        isChasing = true;
      } else {
        // Target is dead or missing — clear pursuit
        agent.targetId = null;
      }
    } else if (agent.targetPosition) {
      targetPos = agent.targetPosition;
    }

    if (targetPos) {
      const result = computeMovementTick(agent, targetPos, isChasing);
      agent.position = result.position;

      if (result.arrived && !isChasing) {
        agent.targetPosition = null;
        agent.currentAction = 'holding';
        arrivedAgents.push(agent);
      }
    }
  }

  return arrivedAgents;
}

/**
 * Reposition a troop to its formation slot around its lieutenant.
 *
 * Finds all alive troops under the same lieutenant, determines
 * this troop's slot index, and sets its target position accordingly.
 */
export function repositionInFormation(
  agent: AgentState,
  ltPosition: Vec2,
  allAgents: Map<string, AgentState>,
): void {
  if (!isTroop(agent)) return;

  // Gather all alive troops under the same lieutenant, sorted by ID for stable assignment
  const teammates = Array.from(allAgents.values())
    .filter(a => isTroop(a) && a.lieutenantId === agent.lieutenantId && a.alive)
    .sort((a, b) => a.id.localeCompare(b.id));

  const index = teammates.findIndex(a => a.id === agent.id);
  if (index === -1) return;

  const pos = computeFormationSlot(agent.formation, ltPosition, index, teammates.length);
  agent.targetPosition = pos;
  agent.currentAction = 'moving';
  agent.targetId = null;
}

// ─── Visibility ─────────────────────────────────────────────────────────────

/**
 * Get all visible enemies for an agent.
 *
 * Returns enemy agents within the agent's visibility radius,
 * sorted by distance (closest first).
 */
export function getVisibleEnemies(
  agent: AgentState,
  allAgents: Iterable<AgentState>,
): Array<{ agent: AgentState; distance: number }> {
  const visible: Array<{ agent: AgentState; distance: number }> = [];

  for (const other of allAgents) {
    if (other.team === agent.team) continue;
    if (!other.alive) continue;

    const dist = Vec.distance(agent.position, other.position);
    if (dist <= agent.visibilityRadius) {
      visible.push({ agent: other, distance: dist });
    }
  }

  return visible.sort((a, b) => a.distance - b.distance);
}
