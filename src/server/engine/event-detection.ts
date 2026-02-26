/**
 * Event detection — detects battlefield conditions and generates events.
 *
 * Pure functions that inspect simulation state and return events to queue.
 * These extend the base event vocabulary with tactical awareness:
 *
 * - formation_broken: squad has lost cohesion (casualties, routing, scattering)
 * - morale_low: squad average morale dropped below threshold
 * - enemy_retreating: visible enemy is routing (pursuit opportunity)
 * - terrain_entered/terrain_exited: unit moved into/out of terrain feature
 */

import type { AgentState, Vec2 } from '../../shared/types/index.js';
import type {
  FormationBrokenEvent,
  MoraleLowEvent,
  EnemyRetreatingEvent,
  TerrainEnteredEvent,
  TerrainExitedEvent,
} from '../../shared/events/index.js';
import { isTroop } from './unit-types.js';
import { getTerrainAt, type TerrainMap, type TerrainFeature } from './terrain.js';
import { distance } from './vec2.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Morale threshold below which morale_low fires. */
export const MORALE_LOW_THRESHOLD = 40;

/**
 * Formation is "broken" when fewer than this fraction of the squad
 * is alive and not routing.
 */
export const FORMATION_BROKEN_THRESHOLD = 0.6;

// ─── Formation Detection ────────────────────────────────────────────────────

/**
 * Detect whether a lieutenant's squad formation is broken.
 *
 * A formation is broken when:
 * - Too many troops are dead or routing (below threshold)
 * - Returns null if formation is still intact.
 */
export function detectFormationBroken(
  lieutenantId: string,
  agents: Iterable<AgentState>,
): FormationBrokenEvent | null {
  let total = 0;
  let intact = 0;  // alive and not routing
  let hasRouting = false;
  let hasDead = false;
  let hasEngaged = false;

  for (const agent of agents) {
    if (!isTroop(agent)) continue;
    if (agent.lieutenantId !== lieutenantId) continue;

    total++;
    if (agent.alive && agent.currentAction !== 'routing') {
      intact++;
    }
    if (!agent.alive) hasDead = true;
    if (agent.currentAction === 'routing') hasRouting = true;
    if (agent.currentAction === 'engaging') hasEngaged = true;
  }

  if (total === 0) return null;

  const intactPercent = Math.round((intact / total) * 100);
  if (intact / total >= FORMATION_BROKEN_THRESHOLD) return null;

  // Determine reason
  let reason: 'casualties' | 'engagement' | 'routing';
  if (hasRouting) {
    reason = 'routing';
  } else if (hasDead) {
    reason = 'casualties';
  } else if (hasEngaged) {
    reason = 'engagement';
  } else {
    reason = 'casualties';
  }

  return {
    type: 'formation_broken',
    reason,
    intactPercent,
  };
}

// ─── Morale Detection ───────────────────────────────────────────────────────

/**
 * Detect if a lieutenant's squad morale is dangerously low.
 *
 * Fires when the average morale of alive troops is below threshold.
 * Returns null if morale is acceptable.
 */
export function detectMoraleLow(
  lieutenantId: string,
  agents: Iterable<AgentState>,
): MoraleLowEvent | null {
  let count = 0;
  let moraleSum = 0;
  let lowestMorale = 100;

  for (const agent of agents) {
    if (!isTroop(agent)) continue;
    if (agent.lieutenantId !== lieutenantId) continue;
    if (!agent.alive) continue;

    count++;
    moraleSum += agent.morale;
    if (agent.morale < lowestMorale) {
      lowestMorale = agent.morale;
    }
  }

  if (count === 0) return null;

  const averageMorale = Math.round(moraleSum / count);
  if (averageMorale >= MORALE_LOW_THRESHOLD) return null;

  return {
    type: 'morale_low',
    averageMorale,
    lowestMorale,
  };
}

// ─── Enemy Retreating Detection ─────────────────────────────────────────────

/**
 * Detect visible enemies that are routing.
 *
 * Returns events for each routing enemy visible to the given agent.
 * This gives agents the opportunity to pursue fleeing enemies.
 */
export function detectEnemyRetreating(
  agent: AgentState,
  allAgents: Iterable<AgentState>,
): EnemyRetreatingEvent[] {
  const events: EnemyRetreatingEvent[] = [];

  for (const other of allAgents) {
    if (other.team === agent.team) continue;
    if (!other.alive) continue;
    if (other.currentAction !== 'routing') continue;

    const dist = distance(agent.position, other.position);
    if (dist <= agent.visibilityRadius) {
      events.push({
        type: 'enemy_retreating',
        enemyId: other.id,
        position: { x: other.position.x, y: other.position.y },
        distance: dist,
      });
    }
  }

  return events;
}

// ─── Terrain Transition Detection ───────────────────────────────────────────

/** Per-agent terrain tracking state. */
export type TerrainTracker = Map<string, string | null>;  // agentId → terrainFeatureId | null

/** Create an empty terrain tracker. */
export function createTerrainTracker(): TerrainTracker {
  return new Map();
}

/**
 * Detect terrain transitions for an agent.
 *
 * Compares the agent's current terrain to the last known terrain.
 * Returns entered/exited events as appropriate.
 * Updates the tracker in place.
 */
export function detectTerrainTransition(
  agent: AgentState,
  terrain: TerrainMap,
  tracker: TerrainTracker,
): (TerrainEnteredEvent | TerrainExitedEvent)[] {
  const currentFeature = getTerrainAt(agent.position, terrain);
  const currentId = currentFeature?.id ?? null;
  const previousId = tracker.get(agent.id) ?? null;

  // Update tracker
  tracker.set(agent.id, currentId);

  // No change
  if (currentId === previousId) return [];

  const events: (TerrainEnteredEvent | TerrainExitedEvent)[] = [];

  // Exited previous terrain
  if (previousId !== null && currentId !== previousId) {
    // We need the previous feature's type — look it up
    const prevFeature = terrain.features.find(f => f.id === previousId);
    if (prevFeature) {
      events.push({
        type: 'terrain_exited',
        terrainType: prevFeature.type,
        position: { x: agent.position.x, y: agent.position.y },
      });
    }
  }

  // Entered new terrain
  if (currentFeature && currentId !== previousId) {
    events.push({
      type: 'terrain_entered',
      terrainType: currentFeature.type,
      position: { x: agent.position.x, y: agent.position.y },
    });
  }

  return events;
}
