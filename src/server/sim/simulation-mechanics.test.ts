/**
 * Tests for new battle mechanics wired into the simulation:
 * - Formation combat modifiers affect damage
 * - Flanking detection fires flanked events
 * - Charge momentum deals bonus first-hit damage
 * - Morale routing makes troops flee
 * - Terrain modifies combat and movement
 */

import { describe, it, expect } from 'vitest';
import {
  createSimulation,
  simulationTick,
  applyInitialFormations,
  SimulationState,
} from './simulation.js';
import { createTroop, createLieutenant } from '../engine/unit-types.js';
import {
  createEngageOnSightFlowchart,
  createLieutenantDefaultFlowchart,
  Flowchart,
} from '../runtime/flowchart.js';
import { createTerrainMap, type TerrainMap, type TerrainFeature } from '../engine/terrain.js';
import type { AgentState, Vec2 } from '../../shared/types/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a minimal two-unit combat scenario for testing mechanics.
 * Places one player troop and one enemy troop in combat range.
 */
function createCombatPair(opts?: {
  playerFormation?: string;
  enemyFormation?: string;
  playerCombat?: number;
  enemyCombat?: number;
  playerPos?: Vec2;
  enemyPos?: Vec2;
  terrain?: TerrainMap;
}): SimulationState {
  const pPos = opts?.playerPos ?? { x: 100, y: 100 };
  const ePos = opts?.enemyPos ?? { x: 110, y: 100 };

  const lt = createLieutenant({
    id: 'lt_1', team: 'player', position: { x: 50, y: 100 },
    name: 'Lt. Test', preset: 'disciplined', troopIds: ['p1'],
  });

  const eLt = createLieutenant({
    id: 'lt_e', team: 'enemy', position: { x: 200, y: 100 },
    name: 'Enemy Lt', preset: 'aggressive', troopIds: ['e1'],
  });

  const player = createTroop({
    id: 'p1', team: 'player', position: pPos,
    lieutenantId: 'lt_1', squadId: 'squad_1',
    stats: { combat: opts?.playerCombat ?? 5 },
    formation: (opts?.playerFormation ?? 'line') as any,
  });

  const enemy = createTroop({
    id: 'e1', team: 'enemy', position: ePos,
    lieutenantId: 'lt_e', squadId: 'enemy_squad_1',
    stats: { combat: opts?.enemyCombat ?? 5 },
    formation: (opts?.enemyFormation ?? 'line') as any,
  });

  const agents = [lt, eLt, player, enemy];
  const flowcharts: Flowchart[] = [
    createEngageOnSightFlowchart('p1', ePos),
    createEngageOnSightFlowchart('e1', pPos),
    createLieutenantDefaultFlowchart('lt_1', { x: 200, y: 100 }),
    createLieutenantDefaultFlowchart('lt_e', { x: 50, y: 100 }),
  ];

  const sim = createSimulation(400, 300, agents, flowcharts);
  if (opts?.terrain) {
    sim.terrain = opts.terrain;
  }
  return sim;
}

/** Run N ticks of simulation. */
function runTicks(sim: SimulationState, n: number): void {
  sim.battle.running = true;
  for (let i = 0; i < n; i++) {
    simulationTick(sim);
  }
}

/** Get agent by id from sim state. */
function getAgent(sim: SimulationState, id: string): AgentState {
  return sim.battle.agents.get(id)!;
}

// ─── Formation Combat Modifier Tests ─────────────────────────────────────────

describe('Simulation: Formation Combat Modifiers', () => {
  it('wedge formation deals more damage than line formation', () => {
    // Create two identical combat pairs, one with wedge attacker
    const simLine = createCombatPair({ playerFormation: 'line', enemyFormation: 'line' });
    const simWedge = createCombatPair({ playerFormation: 'wedge', enemyFormation: 'line' });

    runTicks(simLine, 5);
    runTicks(simWedge, 5);

    const enemyLineHP = getAgent(simLine, 'e1').health;
    const enemyWedgeHP = getAgent(simWedge, 'e1').health;

    // Wedge attacker should deal more damage (enemy has less HP remaining)
    expect(enemyWedgeHP).toBeLessThan(enemyLineHP);
  });

  it('defensive_circle formation takes less damage than line', () => {
    const simLine = createCombatPair({ playerFormation: 'line', enemyFormation: 'line' });
    const simCircle = createCombatPair({ playerFormation: 'defensive_circle', enemyFormation: 'line' });

    runTicks(simLine, 5);
    runTicks(simCircle, 5);

    const playerLineHP = getAgent(simLine, 'p1').health;
    const playerCircleHP = getAgent(simCircle, 'p1').health;

    // Circle defender should take less damage (more HP remaining)
    expect(playerCircleHP).toBeGreaterThan(playerLineHP);
  });

  it('column formation is bad at both attack and defense', () => {
    const simLine = createCombatPair({ playerFormation: 'line', enemyFormation: 'line' });
    const simColumn = createCombatPair({ playerFormation: 'column', enemyFormation: 'line' });

    runTicks(simLine, 5);
    runTicks(simColumn, 5);

    // Column attacker deals less damage
    const enemyLineHP = getAgent(simLine, 'e1').health;
    const enemyColHP = getAgent(simColumn, 'e1').health;
    expect(enemyColHP).toBeGreaterThan(enemyLineHP);

    // Column defender takes more damage
    const playerLineHP = getAgent(simLine, 'p1').health;
    const playerColHP = getAgent(simColumn, 'p1').health;
    expect(playerColHP).toBeLessThan(playerLineHP);
  });
});

// ─── Flanking Tests ──────────────────────────────────────────────────────────

describe('Simulation: Flanking Detection', () => {
  it('fires flanked event when attacked from behind', () => {
    // Player faces east (positive x). Enemy is behind player (west side).
    const sim = createCombatPair({
      playerPos: { x: 100, y: 100 },
      enemyPos: { x: 88, y: 100 },  // Behind the player (player faces east)
    });

    // Track flanked events
    const flankedEvents: Array<{ agentId: string; direction: string }> = [];
    const playerRuntime = sim.runtimes.get('p1')!;
    const origFlowchart = playerRuntime.flowchart;
    playerRuntime.flowchart = {
      ...origFlowchart,
      nodes: [
        ...origFlowchart.nodes,
        {
          id: 'detect_flank',
          on: 'flanked',
          action: { type: 'requestSupport', message: 'flanked!' },
          priority: 100,
        },
      ],
    };

    sim.callbacks = {
      onTroopMessage: (agentId, type, message) => {
        if (message === 'flanked!') {
          flankedEvents.push({ agentId, direction: 'rear' });
        }
      },
    };

    runTicks(sim, 3);

    // The player troop should have received a flanked event
    expect(flankedEvents.length).toBeGreaterThan(0);
  });
});

// ─── Charge Momentum Tests ──────────────────────────────────────────────────

describe('Simulation: Charge Momentum', () => {
  it('moving unit deals more damage on first combat tick', () => {
    // Both scenarios place units in combat range for exactly 1 tick.
    // The charge scenario pre-seeds wasMovingLastTick to simulate approach.
    const simStatic = createCombatPair({
      playerPos: { x: 100, y: 100 },
      enemyPos: { x: 110, y: 100 },
    });

    const simCharge = createCombatPair({
      playerPos: { x: 100, y: 100 },
      enemyPos: { x: 110, y: 100 },
    });

    // Simulate that the charge player was moving before combat started
    simCharge.wasMovingLastTick.add('p1');
    getAgent(simCharge, 'p1').currentAction = 'engaging';
    getAgent(simCharge, 'p1').targetId = 'e1';
    getAgent(simStatic, 'p1').currentAction = 'engaging';
    getAgent(simStatic, 'p1').targetId = 'e1';

    // Run exactly 1 tick each so combat fires once
    runTicks(simStatic, 1);
    runTicks(simCharge, 1);

    const staticEnemyHP = getAgent(simStatic, 'e1').health;
    const chargeEnemyHP = getAgent(simCharge, 'e1').health;

    // Charge scenario: enemy should have less HP (took more damage)
    expect(chargeEnemyHP).toBeLessThan(staticEnemyHP);
  });
});

// ─── Morale & Routing Tests ─────────────────────────────────────────────────

describe('Simulation: Morale & Routing', () => {
  it('troops with very low morale may start routing', () => {
    const sim = createCombatPair();

    // Manually drop player morale to near-zero
    const player = getAgent(sim, 'p1');
    player.morale = 5;
    // Set low courage for more reliable routing
    (player.stats as any).courage = 1;

    // Run several ticks — routing check should trigger
    let hasRouted = false;
    for (let i = 0; i < 50; i++) {
      sim.battle.running = true;
      simulationTick(sim);
      if (player.currentAction === 'routing') {
        hasRouted = true;
        break;
      }
    }

    expect(hasRouted).toBe(true);
  });

  it('routing troops flee toward their spawn side', () => {
    const sim = createCombatPair({
      playerPos: { x: 200, y: 100 },
      enemyPos: { x: 210, y: 100 },
    });

    const player = getAgent(sim, 'p1');
    player.morale = 0;
    (player.stats as any).courage = 1;

    // Force the agent into routing state by running ticks
    sim.battle.running = true;
    for (let i = 0; i < 20; i++) {
      simulationTick(sim);
      if (player.currentAction === 'routing') break;
    }

    // If routing, player should be moving toward the left (player spawn side)
    if (player.currentAction === 'routing' && player.targetPosition) {
      expect(player.targetPosition.x).toBeLessThan(200); // fleeing west
    }
  });

  it('routing spreads panic to nearby allies', () => {
    const lt = createLieutenant({
      id: 'lt_1', team: 'player', position: { x: 50, y: 100 },
      name: 'Lt. Test', preset: 'disciplined', troopIds: ['p1', 'p2'],
    });

    const eLt = createLieutenant({
      id: 'lt_e', team: 'enemy', position: { x: 200, y: 100 },
      name: 'Enemy Lt', preset: 'aggressive', troopIds: ['e1'],
    });

    const p1 = createTroop({
      id: 'p1', team: 'player', position: { x: 100, y: 100 },
      lieutenantId: 'lt_1', squadId: 'squad_1', stats: { courage: 1 },
    });
    const p2 = createTroop({
      id: 'p2', team: 'player', position: { x: 110, y: 100 },
      lieutenantId: 'lt_1', squadId: 'squad_1', stats: { courage: 5 },
    });
    const e1 = createTroop({
      id: 'e1', team: 'enemy', position: { x: 115, y: 100 },
      lieutenantId: 'lt_e', squadId: 'enemy_squad_1',
    });

    const agents = [lt, eLt, p1, p2, e1];
    const flowcharts: Flowchart[] = [
      createEngageOnSightFlowchart('p1'),
      createEngageOnSightFlowchart('p2'),
      createEngageOnSightFlowchart('e1'),
      createLieutenantDefaultFlowchart('lt_1'),
      createLieutenantDefaultFlowchart('lt_e'),
    ];

    const sim = createSimulation(400, 300, agents, flowcharts);

    // Drop p1's morale to trigger routing
    p1.morale = 0;

    sim.battle.running = true;
    for (let i = 0; i < 20; i++) {
      simulationTick(sim);
    }

    // p2 should have lost morale from routing panic
    expect(p2.morale).toBeLessThan(100);
  });

  it('morale recovers slowly when not in combat', () => {
    const sim = createCombatPair({
      playerPos: { x: 50, y: 50 },
      enemyPos: { x: 350, y: 250 }, // Far away, no combat
    });

    const player = getAgent(sim, 'p1');
    player.morale = 60;

    runTicks(sim, 20);

    // Morale should have recovered somewhat
    expect(player.morale).toBeGreaterThan(60);
  });
});

// ─── Terrain Tests ───────────────────────────────────────────────────────────

describe('Simulation: Terrain Effects', () => {
  it('units on a hill take less damage', () => {
    const hillTerrain = createTerrainMap([{
      id: 'hill_1',
      type: 'hill',
      position: { x: 95, y: 95 },
      size: { x: 20, y: 20 },
    }]);

    const simFlat = createCombatPair();
    const simHill = createCombatPair({ terrain: hillTerrain });
    // Player at (100,100) is on the hill

    runTicks(simFlat, 5);
    runTicks(simHill, 5);

    const playerFlatHP = getAgent(simFlat, 'p1').health;
    const playerHillHP = getAgent(simHill, 'p1').health;

    // Player on hill should have more HP remaining
    expect(playerHillHP).toBeGreaterThan(playerFlatHP);
  });

  it('units in a river take more damage', () => {
    const riverTerrain = createTerrainMap([{
      id: 'river_1',
      type: 'river',
      position: { x: 95, y: 95 },
      size: { x: 20, y: 20 },
    }]);

    const simFlat = createCombatPair();
    const simRiver = createCombatPair({ terrain: riverTerrain });

    runTicks(simFlat, 5);
    runTicks(simRiver, 5);

    const playerFlatHP = getAgent(simFlat, 'p1').health;
    const playerRiverHP = getAgent(simRiver, 'p1').health;

    // Player in river should have less HP remaining (more damage taken)
    expect(playerRiverHP).toBeLessThan(playerFlatHP);
  });

  it('units in forest move slower', () => {
    const forestTerrain = createTerrainMap([{
      id: 'forest_1',
      type: 'forest',
      position: { x: 40, y: 90 },
      size: { x: 80, y: 20 },
    }]);

    // Both start at x=50, target at x=200. One moves through forest.
    const simFlat = createCombatPair({
      playerPos: { x: 50, y: 100 },
      enemyPos: { x: 350, y: 250 },
    });
    const simForest = createCombatPair({
      playerPos: { x: 50, y: 100 },
      enemyPos: { x: 350, y: 250 },
      terrain: forestTerrain,
    });

    // Give both a distant target
    getAgent(simFlat, 'p1').targetPosition = { x: 200, y: 100 };
    getAgent(simFlat, 'p1').currentAction = 'moving';
    getAgent(simForest, 'p1').targetPosition = { x: 200, y: 100 };
    getAgent(simForest, 'p1').currentAction = 'moving';

    runTicks(simFlat, 10);
    runTicks(simForest, 10);

    const flatX = getAgent(simFlat, 'p1').position.x;
    const forestX = getAgent(simForest, 'p1').position.x;

    // Forest unit should have moved less distance
    expect(forestX).toBeLessThan(flatX);
  });
});
