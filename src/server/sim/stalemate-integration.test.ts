/**
 * Stalemate integration tests — TDD red phase.
 *
 * Tests that the simulation properly tracks stalemates and
 * forces advancement when combat doesn't happen.
 */

import { describe, it, expect } from 'vitest';
import {
  createSimulation,
  simulationTick,
  type SimulationState,
} from './simulation.js';
import { createBasicScenario } from './scenario.js';
import { STALEMATE_WARNING_TICKS, STALEMATE_FORCE_ADVANCE_TICKS } from '../engine/stalemate.js';

function tickN(sim: SimulationState, n: number): void {
  for (let i = 0; i < n; i++) simulationTick(sim);
}

describe('Stalemate integration', () => {
  it('simulation state should have a stalemate tracker', () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
    expect(sim.stalemateTracker).toBeDefined();
    expect(sim.stalemateTracker.ticksSinceLastCombat).toBe(0);
  });

  it('should increment ticksSinceLastCombat each tick without combat', () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
    sim.battle.running = true;

    tickN(sim, 10);

    expect(sim.stalemateTracker.ticksSinceLastCombat).toBe(10);
  });

  it('should reset ticksSinceLastCombat when combat occurs', () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
    sim.battle.running = true;

    // Tick without combat
    tickN(sim, 50);
    expect(sim.stalemateTracker.ticksSinceLastCombat).toBe(50);

    // Force combat by placing units together
    const player = Array.from(sim.battle.agents.values()).find(a => a.team === 'player' && a.alive)!;
    const enemy = Array.from(sim.battle.agents.values()).find(a => a.team === 'enemy' && a.alive)!;
    enemy.position = { x: player.position.x + 5, y: player.position.y };

    simulationTick(sim);

    // Should have reset because damage was dealt.
    // Counter is 1 (not 0) because the stalemate step increments after combat within the same tick.
    expect(sim.stalemateTracker.ticksSinceLastCombat).toBeLessThanOrEqual(1);
  });

  it('should emit stalemate_warning battle event after warning threshold', () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
    sim.battle.running = true;

    tickN(sim, STALEMATE_WARNING_TICKS);

    const warningEvents = sim.pendingBattleEvents.filter(e => e.type === 'stalemate_warning');
    expect(warningEvents).toHaveLength(1);
  });

  it('should force all troops toward center after force_advance threshold', () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
    sim.battle.running = true;

    // Record initial positions
    const troops = Array.from(sim.battle.agents.values()).filter(a => a.type === 'troop' && a.alive);
    const centerX = sim.battle.width / 2;

    tickN(sim, STALEMATE_FORCE_ADVANCE_TICKS);

    // After force advance, troops should have targetPosition pointing toward center
    let forcedCount = 0;
    for (const troop of troops) {
      if (troop.targetPosition) {
        // Target should be closer to center than spawn
        const distToCenter = Math.abs(troop.targetPosition.x - centerX);
        const spawnX = troop.team === 'player' ? 0 : sim.battle.width;
        const distFromSpawn = Math.abs(troop.targetPosition.x - spawnX);
        if (distToCenter < distFromSpawn) {
          forcedCount++;
        }
      }
    }
    expect(forcedCount).toBeGreaterThan(0);
  });
});
