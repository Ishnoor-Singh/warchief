/**
 * Integration tests for expanded event detection in the simulation loop.
 *
 * Tests that the new events (formation_broken, morale_low, enemy_retreating,
 * terrain_entered, terrain_exited) fire correctly during simulation ticks
 * and are processed by flowchart agents.
 *
 * Strategy: give agents flowchart nodes that react to the new events
 * with observable actions (e.g., setFormation, fallback), then verify
 * the agent's state changed as expected.
 */
import { describe, it, expect } from 'vitest';
import {
  createSimulation,
  simulationTick,
  type SimulationState,
} from './simulation.js';
import type { Flowchart } from '../runtime/flowchart.js';
import { createTroop, createLieutenant } from '../engine/unit-types.js';
import { createTerrainMap, type TerrainFeature } from '../engine/terrain.js';
import type { AgentState } from '../../shared/types/index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTestSim(agents: AgentState[], flowcharts: Flowchart[]): SimulationState {
  const sim = createSimulation(400, 300, agents, flowcharts);
  sim.battle.running = true;
  return sim;
}

function makeLt(id: string, team: 'player' | 'enemy', troopIds: string[]): AgentState {
  return createLieutenant({
    id,
    team,
    position: { x: team === 'player' ? 80 : 320, y: 150 },
    name: id,
    personality: 'disciplined',
    stats: { initiative: 5, discipline: 5, communication: 5 },
    troopIds,
  });
}

function makeTroop(id: string, team: 'player' | 'enemy', ltId: string, overrides: Partial<AgentState> = {}): AgentState {
  const troop = createTroop({
    id,
    team,
    position: overrides.position || { x: team === 'player' ? 100 : 300, y: 150 },
    preset: 'infantry',
    lieutenantId: ltId,
    squadId: `squad_${ltId}`,
  });
  return { ...troop, ...overrides, id, type: 'troop' as const } as AgentState;
}

/** Flowchart that reacts to formation_broken by switching to defensive_circle. */
function formationBrokenFlowchart(agentId: string): Flowchart {
  return {
    agentId,
    nodes: [
      {
        id: 'on_formation_broken',
        on: 'formation_broken',
        action: { type: 'setFormation', formation: 'defensive_circle' },
        priority: 10,
      },
    ],
    defaultAction: { type: 'hold' },
  };
}

/** Flowchart that reacts to morale_low by switching to defensive_circle. */
function moraleLowFlowchart(agentId: string): Flowchart {
  return {
    agentId,
    nodes: [
      {
        id: 'on_morale_low',
        on: 'morale_low',
        action: { type: 'setFormation', formation: 'defensive_circle' },
        priority: 10,
      },
    ],
    defaultAction: { type: 'hold' },
  };
}

/** Flowchart that reacts to enemy_retreating by engaging. */
function enemyRetreatingFlowchart(agentId: string): Flowchart {
  return {
    agentId,
    nodes: [
      {
        id: 'on_enemy_retreating',
        on: 'enemy_retreating',
        action: { type: 'engage', targetId: '' },
        priority: 10,
      },
    ],
    defaultAction: { type: 'hold' },
  };
}

/** Flowchart that reacts to terrain_entered by switching to scatter. */
function terrainEnteredFlowchart(agentId: string): Flowchart {
  return {
    agentId,
    nodes: [
      {
        id: 'on_terrain_entered',
        on: 'terrain_entered',
        action: { type: 'setFormation', formation: 'scatter' },
        priority: 10,
      },
    ],
    defaultAction: { type: 'hold' },
  };
}

/** Flowchart that reacts to terrain_exited by switching to line. */
function terrainExitedFlowchart(agentId: string): Flowchart {
  return {
    agentId,
    nodes: [
      {
        id: 'on_terrain_exited',
        on: 'terrain_exited',
        action: { type: 'setFormation', formation: 'line' },
        priority: 10,
      },
    ],
    defaultAction: { type: 'hold' },
  };
}

/** Simple hold flowchart. */
function holdFlowchart(agentId: string): Flowchart {
  return {
    agentId,
    nodes: [],
    defaultAction: { type: 'hold' },
  };
}

// ─── formation_broken ───────────────────────────────────────────────────────

describe('formation_broken event in simulation', () => {
  it('triggers flowchart response when enough troops die', () => {
    const troopIds = ['t1', 't2', 't3', 't4', 't5'];
    const lt = makeLt('lt_1', 'player', troopIds);
    const troops = troopIds.map(id => makeTroop(id, 'player', 'lt_1'));
    // t1 and t2 have reactive flowcharts, others are simple
    const flowcharts = [
      holdFlowchart('lt_1'),
      formationBrokenFlowchart('t1'),
      formationBrokenFlowchart('t2'),
      holdFlowchart('t3'),
      holdFlowchart('t4'),
      holdFlowchart('t5'),
    ];

    const sim = makeTestSim([lt, ...troops], flowcharts);

    // Kill 3 troops → 40% intact < 60% threshold
    sim.battle.agents.get('t3')!.alive = false;
    sim.battle.agents.get('t4')!.alive = false;
    sim.battle.agents.get('t5')!.alive = false;

    // Tick at the detection interval
    sim.battle.tick = 9;
    simulationTick(sim);

    // t1 and t2 should have switched to defensive_circle
    expect(sim.battle.agents.get('t1')!.formation).toBe('defensive_circle');
    expect(sim.battle.agents.get('t2')!.formation).toBe('defensive_circle');
  });

  it('does not trigger when formation is intact', () => {
    const troopIds = ['t1', 't2', 't3', 't4', 't5'];
    const lt = makeLt('lt_1', 'player', troopIds);
    const troops = troopIds.map(id => makeTroop(id, 'player', 'lt_1'));
    const flowcharts = [
      holdFlowchart('lt_1'),
      formationBrokenFlowchart('t1'),
      ...troopIds.slice(1).map(id => holdFlowchart(id)),
    ];

    const sim = makeTestSim([lt, ...troops], flowcharts);
    const originalFormation = sim.battle.agents.get('t1')!.formation;

    sim.battle.tick = 9;
    simulationTick(sim);

    // t1 should NOT have changed formation
    expect(sim.battle.agents.get('t1')!.formation).toBe(originalFormation);
  });
});

// ─── morale_low ─────────────────────────────────────────────────────────────

describe('morale_low event in simulation', () => {
  it('triggers flowchart response when squad morale is low', () => {
    const troopIds = ['t1', 't2', 't3'];
    const lt = makeLt('lt_1', 'player', troopIds);
    // Use morale 35 (below morale_low threshold of 40).
    // Test formation change instead of currentAction because routing can
    // override currentAction but not formation.
    const troops = troopIds.map(id => {
      const t = makeTroop(id, 'player', 'lt_1', { morale: 35 });
      (t.stats as { courage: number }).courage = 10; // High courage prevents routing interference
      return t;
    });
    const flowcharts = [
      holdFlowchart('lt_1'),
      moraleLowFlowchart('t1'),
      ...troopIds.slice(1).map(id => holdFlowchart(id)),
    ];

    const sim = makeTestSim([lt, ...troops], flowcharts);

    sim.battle.tick = 9;
    simulationTick(sim);

    // t1 should have switched to defensive_circle in response to morale_low
    expect(sim.battle.agents.get('t1')!.formation).toBe('defensive_circle');
  });

  it('does not trigger when morale is healthy', () => {
    const troopIds = ['t1', 't2', 't3'];
    const lt = makeLt('lt_1', 'player', troopIds);
    const troops = troopIds.map(id => makeTroop(id, 'player', 'lt_1', { morale: 80 }));
    const flowcharts = [
      holdFlowchart('lt_1'),
      moraleLowFlowchart('t1'),
      ...troopIds.slice(1).map(id => holdFlowchart(id)),
    ];

    const sim = makeTestSim([lt, ...troops], flowcharts);

    sim.battle.tick = 9;
    simulationTick(sim);

    // t1 should NOT have switched formation (no morale_low triggered)
    expect(sim.battle.agents.get('t1')!.formation).not.toBe('defensive_circle');
  });
});

// ─── enemy_retreating ───────────────────────────────────────────────────────

describe('enemy_retreating event in simulation', () => {
  it('triggers flowchart response when visible enemy is routing', () => {
    const lt = makeLt('lt_1', 'player', ['t1']);
    const ltE = makeLt('lt_e', 'enemy', ['e1']);
    const troop = makeTroop('t1', 'player', 'lt_1', {
      position: { x: 150, y: 150 },
      visibilityRadius: 60,
    });
    const enemy = makeTroop('e1', 'enemy', 'lt_e', {
      position: { x: 180, y: 150 },
      currentAction: 'routing',
    });
    const flowcharts = [
      holdFlowchart('lt_1'),
      holdFlowchart('lt_e'),
      enemyRetreatingFlowchart('t1'),
      holdFlowchart('e1'),
    ];

    const sim = makeTestSim([lt, ltE, troop, enemy], flowcharts);

    sim.battle.tick = 9;
    simulationTick(sim);

    // t1 should now be engaging (pursuing the retreating enemy)
    expect(sim.battle.agents.get('t1')!.currentAction).toBe('engaging');
  });
});

// ─── terrain_entered / terrain_exited ───────────────────────────────────────

describe('terrain_entered and terrain_exited events in simulation', () => {
  const hill: TerrainFeature = {
    id: 'hill_1',
    type: 'hill',
    position: { x: 50, y: 50 },
    size: { x: 50, y: 50 },
  };

  it('triggers flowchart response when unit enters terrain', () => {
    const lt = makeLt('lt_1', 'player', ['t1']);
    const troop = makeTroop('t1', 'player', 'lt_1', {
      position: { x: 30, y: 60 },
    });
    const flowcharts = [holdFlowchart('lt_1'), terrainEnteredFlowchart('t1')];

    const sim = makeTestSim([lt, troop], flowcharts);
    sim.terrain = createTerrainMap([hill]);

    // First tick: initialize terrain tracker (troop is outside)
    sim.battle.tick = 9;
    simulationTick(sim);

    // Move troop into the hill
    sim.battle.agents.get('t1')!.position = { x: 60, y: 60 };
    sim.battle.tick = 19;
    simulationTick(sim);

    // t1 should have switched to scatter formation
    expect(sim.battle.agents.get('t1')!.formation).toBe('scatter');
  });

  it('triggers flowchart response when unit exits terrain', () => {
    const lt = makeLt('lt_1', 'player', ['t1']);
    const troop = makeTroop('t1', 'player', 'lt_1', {
      position: { x: 60, y: 60 },
    });
    const flowcharts = [holdFlowchart('lt_1'), terrainExitedFlowchart('t1')];

    const sim = makeTestSim([lt, troop], flowcharts);
    sim.terrain = createTerrainMap([hill]);

    // First tick: initialize terrain tracker (troop is on hill)
    sim.battle.tick = 9;
    simulationTick(sim);

    // Move troop off the hill
    sim.battle.agents.get('t1')!.position = { x: 30, y: 30 };
    sim.battle.tick = 19;
    simulationTick(sim);

    // t1 should have switched to line formation
    expect(sim.battle.agents.get('t1')!.formation).toBe('line');
  });
});
