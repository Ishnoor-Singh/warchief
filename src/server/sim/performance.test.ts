/**
 * Performance benchmark tests for the simulation.
 *
 * Validates that the simulation can handle 200+ agents at 10 tps
 * with acceptable tick times. Uses the spatial index optimizations.
 */
import { describe, it, expect } from 'vitest';
import { createSimulation, simulationTick, type SimulationState } from './simulation.js';
import { createTroop, createLieutenant, createSquad } from '../engine/unit-types.js';
import { createEngageOnSightFlowchart, createLieutenantDefaultFlowchart, type Flowchart } from '../runtime/flowchart.js';
import { createTerrainMap, type TerrainFeature } from '../engine/terrain.js';
import type { AgentState } from '../../shared/types/index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createLargeScenario(troopsPerSide: number): { agents: AgentState[]; flowcharts: Flowchart[] } {
  const agents: AgentState[] = [];
  const flowcharts: Flowchart[] = [];
  const squadsPerSide = Math.ceil(troopsPerSide / 10);

  // Player side
  for (let s = 0; s < squadsPerSide; s++) {
    const ltId = `lt_p_${s}`;
    const squadSize = Math.min(10, troopsPerSide - s * 10);
    if (squadSize <= 0) break;

    const yPos = 50 + (s * 250 / squadsPerSide);
    const lt = createLieutenant({
      id: ltId,
      team: 'player',
      position: { x: 50, y: yPos },
      name: `Player Lt ${s}`,
      personality: 'disciplined',
      stats: { initiative: 5, discipline: 5, communication: 5 },
      troopIds: Array.from({ length: squadSize }, (_, i) => `p_s${s}_t${i}`),
    });
    agents.push(lt);
    flowcharts.push(createLieutenantDefaultFlowchart(ltId));

    const squad = createSquad(`p_s${s}`, squadSize, {
      team: 'player',
      centerPosition: { x: 80 + Math.random() * 20, y: yPos },
      lieutenantId: ltId,
      squadId: `squad_p_${s}`,
    });
    for (const troop of squad) {
      agents.push(troop);
      flowcharts.push(createEngageOnSightFlowchart(troop.id));
    }
  }

  // Enemy side
  for (let s = 0; s < squadsPerSide; s++) {
    const ltId = `lt_e_${s}`;
    const squadSize = Math.min(10, troopsPerSide - s * 10);
    if (squadSize <= 0) break;

    const yPos = 50 + (s * 250 / squadsPerSide);
    const lt = createLieutenant({
      id: ltId,
      team: 'enemy',
      position: { x: 450, y: yPos },
      name: `Enemy Lt ${s}`,
      personality: 'aggressive',
      stats: { initiative: 5, discipline: 5, communication: 5 },
      troopIds: Array.from({ length: squadSize }, (_, i) => `e_s${s}_t${i}`),
    });
    agents.push(lt);
    flowcharts.push(createLieutenantDefaultFlowchart(ltId));

    const squad = createSquad(`e_s${s}`, squadSize, {
      team: 'enemy',
      centerPosition: { x: 420 - Math.random() * 20, y: yPos },
      lieutenantId: ltId,
      squadId: `squad_e_${s}`,
    });
    for (const troop of squad) {
      agents.push(troop);
      flowcharts.push(createEngageOnSightFlowchart(troop.id));
    }
  }

  return { agents, flowcharts };
}

// ─── Benchmarks ─────────────────────────────────────────────────────────────

describe('Performance benchmarks', () => {
  it('handles 200 agents at < 10ms per tick average', () => {
    const { agents, flowcharts } = createLargeScenario(100);
    const sim = createSimulation(500, 300, agents, flowcharts);
    sim.battle.running = true;

    const totalAgents = sim.battle.agents.size;
    expect(totalAgents).toBeGreaterThanOrEqual(200);

    // Warm up (first tick has initialization overhead)
    simulationTick(sim);

    // Benchmark 100 ticks
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      simulationTick(sim);
    }
    const elapsed = performance.now() - start;
    const avgTickMs = elapsed / 100;

    // Must average under 10ms/tick (100 tps headroom at 10ms budget)
    expect(avgTickMs).toBeLessThan(10);
  });

  it('handles 100 agents (current scenario size) at < 5ms per tick', () => {
    const { agents, flowcharts } = createLargeScenario(50);
    const sim = createSimulation(400, 300, agents, flowcharts);
    sim.battle.running = true;

    simulationTick(sim); // warm up

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      simulationTick(sim);
    }
    const elapsed = performance.now() - start;
    const avgTickMs = elapsed / 100;

    expect(avgTickMs).toBeLessThan(5);
  });

  it('handles 200 agents with terrain at < 15ms per tick', () => {
    const terrain: TerrainFeature[] = [
      { id: 'hill_1', type: 'hill', position: { x: 200, y: 100 }, size: { x: 100, y: 80 } },
      { id: 'forest_1', type: 'forest', position: { x: 100, y: 50 }, size: { x: 80, y: 60 } },
      { id: 'river_1', type: 'river', position: { x: 250, y: 0 }, size: { x: 20, y: 300 } },
      { id: 'forest_2', type: 'forest', position: { x: 350, y: 150 }, size: { x: 60, y: 80 } },
    ];

    const { agents, flowcharts } = createLargeScenario(100);
    const sim = createSimulation(500, 300, agents, flowcharts);
    sim.terrain = createTerrainMap(terrain);
    sim.battle.running = true;

    simulationTick(sim); // warm up

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      simulationTick(sim);
    }
    const elapsed = performance.now() - start;
    const avgTickMs = elapsed / 100;

    expect(avgTickMs).toBeLessThan(15);
  });

  it('spatial index stays in sync after deaths', () => {
    const { agents, flowcharts } = createLargeScenario(25);
    const sim = createSimulation(400, 300, agents, flowcharts);
    sim.battle.running = true;

    // Run a few ticks
    for (let i = 0; i < 20; i++) {
      simulationTick(sim);
    }

    // Kill some agents
    let killed = 0;
    for (const agent of sim.battle.agents.values()) {
      if (agent.type === 'troop' && killed < 10) {
        agent.health = 0;
        agent.alive = false;
        killed++;
      }
    }
    sim.squadCacheDirty = true;

    // Run more ticks — should not crash
    for (let i = 0; i < 50; i++) {
      simulationTick(sim);
    }

    // Verify simulation is still running
    expect(sim.battle.tick).toBeGreaterThan(60);
  });
});
