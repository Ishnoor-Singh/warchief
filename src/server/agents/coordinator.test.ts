/**
 * Game coordinator tests — TDD red phase.
 *
 * The coordinator connects the simulation to the agent layer:
 * - Tracks reinvocation triggers per lieutenant
 * - Feeds casualties and support requests from the sim into trackers
 * - Determines which lieutenants need re-invocation each tick
 * - Builds the enriched context (peer state, bus messages) for LLM calls
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createCoordinator,
  tickCoordinator,
  getLieutenantsNeedingReinvocation,
  buildEnrichedContext,
  type GameCoordinator,
} from './coordinator.js';
import { createSimulation, type SimulationState } from '../sim/simulation.js';
import { createBasicScenario } from '../sim/scenario.js';
import { createLieutenant, type Lieutenant } from './lieutenant.js';
import type { AgentState } from '../../shared/types/index.js';
import { REINVOCATION_COOLDOWN_TICKS, CASUALTY_THRESHOLD, IDLE_THRESHOLD_TICKS } from './reinvocation.js';
import { send as busSend } from '../comms/message-bus.js';

function findPlayerLieutenants(sim: SimulationState): AgentState[] {
  return Array.from(sim.battle.agents.values()).filter(
    a => a.team === 'player' && a.type === 'lieutenant' && a.alive
  );
}

describe('GameCoordinator', () => {
  describe('createCoordinator', () => {
    it('should create a coordinator with reinvocation trackers for all lieutenants', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
      const lts = findPlayerLieutenants(sim);

      const coord = createCoordinator(lts.map(lt => lt.id));

      expect(coord.trackers.size).toBe(lts.length);
      for (const lt of lts) {
        expect(coord.trackers.has(lt.id)).toBe(true);
      }
    });
  });

  describe('tickCoordinator', () => {
    it('should increment tick counters for all trackers', () => {
      const coord = createCoordinator(['lt_alpha', 'lt_bravo']);
      tickCoordinator(coord);

      expect(coord.trackers.get('lt_alpha')!.ticksSinceLastCall).toBe(1);
      expect(coord.trackers.get('lt_bravo')!.ticksSinceLastCall).toBe(1);
    });
  });

  describe('getLieutenantsNeedingReinvocation', () => {
    it('should return empty when no triggers hit', () => {
      const coord = createCoordinator(['lt_alpha']);
      const tracker = coord.trackers.get('lt_alpha')!;
      tracker.ticksSinceLastCall = REINVOCATION_COOLDOWN_TICKS;

      const result = getLieutenantsNeedingReinvocation(coord);
      expect(result).toEqual([]);
    });

    it('should return lieutenant when casualties exceed threshold', () => {
      const coord = createCoordinator(['lt_alpha']);
      const tracker = coord.trackers.get('lt_alpha')!;
      tracker.ticksSinceLastCall = REINVOCATION_COOLDOWN_TICKS;
      tracker.casualtiesSinceLastCall = CASUALTY_THRESHOLD;

      const result = getLieutenantsNeedingReinvocation(coord);
      expect(result).toEqual(['lt_alpha']);
    });

    it('should return lieutenant when idle too long', () => {
      const coord = createCoordinator(['lt_alpha']);
      const tracker = coord.trackers.get('lt_alpha')!;
      tracker.ticksSinceLastCall = IDLE_THRESHOLD_TICKS;

      const result = getLieutenantsNeedingReinvocation(coord);
      expect(result).toEqual(['lt_alpha']);
    });

    it('should return multiple lieutenants that need reinvocation', () => {
      const coord = createCoordinator(['lt_alpha', 'lt_bravo']);
      coord.trackers.get('lt_alpha')!.ticksSinceLastCall = IDLE_THRESHOLD_TICKS;
      coord.trackers.get('lt_bravo')!.ticksSinceLastCall = IDLE_THRESHOLD_TICKS;

      const result = getLieutenantsNeedingReinvocation(coord);
      expect(result).toHaveLength(2);
      expect(result).toContain('lt_alpha');
      expect(result).toContain('lt_bravo');
    });
  });

  describe('buildEnrichedContext', () => {
    it('should include peer state for authorized peers', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
      const lts = findPlayerLieutenants(sim);
      const targetLt = lts[0]!;

      // Build enriched context
      const ctx = buildEnrichedContext(
        targetLt.id,
        'Hold position',
        sim,
        lts.map(l => l.id).filter(id => id !== targetLt.id)  // peers
      );

      expect(ctx.peerStates).toBeDefined();
      // Should have peer state for each authorized peer
      if (lts.length > 1) {
        expect(ctx.peerStates!.length).toBeGreaterThan(0);
      }
    });

    it('should include pending bus messages', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
      const lts = findPlayerLieutenants(sim);
      const targetLt = lts[0]!;

      // Send a message to this lieutenant via the bus
      busSend(sim.messageBus, {
        from: 'troop_1',
        to: targetLt.id,
        type: 'support_request',
        payload: { message: 'Need help!' },
        priority: 7,
        tick: 10,
      });

      const ctx = buildEnrichedContext(targetLt.id, 'Hold position', sim, []);

      expect(ctx.pendingBusMessages).toBeDefined();
      expect(ctx.pendingBusMessages!.length).toBeGreaterThan(0);
      expect(ctx.pendingBusMessages![0]!.content).toContain('Need help');
    });

    it('should include visible units under command', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
      const lts = findPlayerLieutenants(sim);
      const targetLt = lts[0]!;

      const ctx = buildEnrichedContext(targetLt.id, 'Attack', sim, []);

      expect(ctx.visibleUnits.length).toBeGreaterThan(0);
    });

    it('should include visible enemies', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
      const lts = findPlayerLieutenants(sim);
      const targetLt = lts[0]!;

      // Move a player lieutenant near enemies
      targetLt.position = { x: 340, y: 150 };

      const ctx = buildEnrichedContext(targetLt.id, 'Attack', sim, []);

      expect(ctx.visibleEnemies).toBeDefined();
      expect(ctx.visibleEnemies!.length).toBeGreaterThan(0);
    });
  });
});
