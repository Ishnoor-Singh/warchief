/**
 * Game coordinator — connects the simulation to the agent layer.
 *
 * Responsibilities:
 * 1. Track reinvocation triggers per lieutenant
 * 2. Determine which lieutenants need LLM re-calls each tick
 * 3. Build enriched context (peer state, bus messages) for LLM calls
 * 4. Record casualties and other events into reinvocation trackers
 *
 * The coordinator does NOT make LLM calls itself — it tells the server
 * layer which lieutenants need re-invocation and provides the context.
 * The server layer handles the async LLM calls.
 */

import {
  createReinvocationTracker,
  recordEvent,
  shouldReinvoke,
  markReinvoked,
  type ReinvocationTracker,
} from './reinvocation.js';
import { drainFor } from '../comms/message-bus.js';
import type { SimulationState } from '../sim/simulation.js';
import type { LieutenantContext, PeerStateInfo, PendingBusMessageInfo, VisibleUnitInfo, VisibleEnemyInfo } from './input-builder.js';
import { isTroop, isLieutenant } from '../engine/index.js';
import type { LieutenantAgent } from '../engine/index.js';
import {
  distance as vecDistance,
} from '../engine/index.js';

export interface GameCoordinator {
  trackers: Map<string, ReinvocationTracker>;
}

/** Create a coordinator with reinvocation trackers for all lieutenants. */
export function createCoordinator(lieutenantIds: string[]): GameCoordinator {
  const trackers = new Map<string, ReinvocationTracker>();
  for (const id of lieutenantIds) {
    trackers.set(id, createReinvocationTracker(id));
  }
  return { trackers };
}

/** Advance all trackers by one tick. Call once per simulation tick. */
export function tickCoordinator(coord: GameCoordinator): void {
  for (const tracker of coord.trackers.values()) {
    recordEvent(tracker, 'tick');
  }
}

/** Record a troop casualty for the troop's lieutenant. */
export function recordCasualty(coord: GameCoordinator, lieutenantId: string): void {
  const tracker = coord.trackers.get(lieutenantId);
  if (tracker) recordEvent(tracker, 'casualty');
}

/** Record a support request for a lieutenant. */
export function recordSupportRequest(coord: GameCoordinator, lieutenantId: string): void {
  const tracker = coord.trackers.get(lieutenantId);
  if (tracker) recordEvent(tracker, 'support_request');
}

/** Record a peer message arrival for a lieutenant. */
export function recordPeerMessage(coord: GameCoordinator, lieutenantId: string): void {
  const tracker = coord.trackers.get(lieutenantId);
  if (tracker) recordEvent(tracker, 'peer_message');
}

/** Record stalemate warning for all lieutenants. */
export function recordStalemateWarning(coord: GameCoordinator): void {
  for (const tracker of coord.trackers.values()) {
    recordEvent(tracker, 'stalemate_warning');
  }
}

/** Get IDs of lieutenants that need LLM re-invocation. */
export function getLieutenantsNeedingReinvocation(coord: GameCoordinator): string[] {
  const result: string[] = [];
  for (const [id, tracker] of coord.trackers) {
    if (shouldReinvoke(tracker)) {
      result.push(id);
    }
  }
  return result;
}

/** Mark a lieutenant as reinvoked (reset its tracker). */
export function markLieutenantReinvoked(coord: GameCoordinator, lieutenantId: string, tick: number): void {
  const tracker = coord.trackers.get(lieutenantId);
  if (tracker) markReinvoked(tracker, tick);
}

/**
 * Build enriched LieutenantContext with peer state and bus messages.
 *
 * This is the context that gets passed to the lieutenant LLM.
 * It includes everything the lieutenant needs for informed decision-making.
 */
export function buildEnrichedContext(
  lieutenantId: string,
  currentOrders: string,
  sim: SimulationState,
  authorizedPeerIds: string[],
): LieutenantContext {
  const ltAgent = sim.battle.agents.get(lieutenantId);

  // Visible units under command
  const visibleUnits: VisibleUnitInfo[] = [];
  if (ltAgent) {
    for (const agent of sim.battle.agents.values()) {
      if (!agent.alive || !isTroop(agent)) continue;
      if (agent.lieutenantId !== lieutenantId) continue;
      visibleUnits.push({
        id: agent.id,
        position: { x: agent.position.x, y: agent.position.y },
        health: agent.health,
        morale: agent.morale,
      });
    }
  }

  // Visible enemies (within lieutenant's visibility radius)
  const visibleEnemies: VisibleEnemyInfo[] = [];
  if (ltAgent) {
    for (const agent of sim.battle.agents.values()) {
      if (!agent.alive || agent.team === ltAgent.team) continue;
      const dist = vecDistance(ltAgent.position, agent.position);
      if (dist <= ltAgent.visibilityRadius) {
        visibleEnemies.push({
          id: agent.id,
          position: { x: agent.position.x, y: agent.position.y },
          distance: dist,
        });
      }
    }
  }

  // Peer state
  const peerStates: PeerStateInfo[] = [];
  for (const peerId of authorizedPeerIds) {
    const peerAgent = sim.battle.agents.get(peerId);
    if (!peerAgent || !peerAgent.alive || !isLieutenant(peerAgent)) continue;
    const peerLt = peerAgent as LieutenantAgent;

    // Count alive troops and average morale
    let troopsAlive = 0;
    let troopsTotal = 0;
    let moraleSum = 0;
    for (const agent of sim.battle.agents.values()) {
      if (!isTroop(agent) || agent.lieutenantId !== peerId) continue;
      troopsTotal++;
      if (agent.alive) {
        troopsAlive++;
        moraleSum += agent.morale;
      }
    }

    peerStates.push({
      id: peerId,
      name: peerLt.name,
      troopsAlive,
      troopsTotal,
      averageMorale: troopsAlive > 0 ? moraleSum / troopsAlive : 0,
      currentAction: peerAgent.currentAction || 'idle',
      position: { x: peerAgent.position.x, y: peerAgent.position.y },
    });
  }

  // Drain pending bus messages for this lieutenant
  const busMessages = drainFor(sim.messageBus, lieutenantId);
  const pendingBusMessages: PendingBusMessageInfo[] = busMessages.map(msg => ({
    from: msg.from,
    type: msg.type,
    content: (msg.payload as { message?: string; content?: string }).message
      || (msg.payload as { message?: string; content?: string }).content
      || JSON.stringify(msg.payload),
  }));

  // Build identity from agent state
  const identity = ltAgent && isLieutenant(ltAgent) ? {
    id: lieutenantId,
    name: (ltAgent as LieutenantAgent).name,
    personality: (ltAgent as LieutenantAgent).personality,
    stats: ltAgent.stats as { initiative: number; discipline: number; communication: number },
  } : {
    id: lieutenantId,
    name: lieutenantId,
    personality: 'disciplined' as const,
    stats: { initiative: 5, discipline: 5, communication: 5 },
  };

  return {
    identity,
    currentOrders,
    visibleUnits,
    visibleEnemies,
    authorizedPeers: authorizedPeerIds,
    terrain: describeTerrain(sim),
    recentMessages: [],
    peerStates: peerStates.length > 0 ? peerStates : undefined,
    pendingBusMessages: pendingBusMessages.length > 0 ? pendingBusMessages : undefined,
  };
}

/** Simple terrain description from the simulation state. */
function describeTerrain(sim: SimulationState): string {
  if (sim.terrain.features.length === 0) {
    return 'Open battlefield with no terrain features.';
  }

  const descriptions = sim.terrain.features.map(f =>
    `${f.type} at (${Math.round(f.position.x)}, ${Math.round(f.position.y)})`
  );
  return `Terrain features: ${descriptions.join(', ')}.`;
}
