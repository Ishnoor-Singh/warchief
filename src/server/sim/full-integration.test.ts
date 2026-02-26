/**
 * Full integration tests — verifies the complete simulation lifecycle
 * including expanded events, memory, and message bus working together.
 *
 * These tests run a multi-tick simulation with realistic scenarios:
 * - Mixed terrain maps
 * - Multiple squads with different flowcharts
 * - Events firing and being processed
 * - Battle events accumulating
 * - Memory observations being recorded
 */
import { describe, it, expect } from 'vitest';
import {
  createSimulation,
  simulationTick,
  getFilteredStateForTeam,
  getDetailedBattleSummary,
  type SimulationState,
  type BattleEvent,
} from './simulation.js';
import type { Flowchart } from '../runtime/flowchart.js';
import { createTroop, createLieutenant } from '../engine/unit-types.js';
import { createTerrainMap, type TerrainFeature } from '../engine/terrain.js';
import { createAgentMemory, recordObservation, setBelief, buildMemorySummary } from '../agents/memory.js';
import { recordBattleEvents } from '../agents/memory-recorder.js';
import { buildLieutenantPrompt, type LieutenantContext } from '../agents/input-builder.js';
import { parseLieutenantOutput } from '../agents/schema.js';
import type { AgentState } from '../../shared/types/index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function runTicks(sim: SimulationState, n: number): void {
  for (let i = 0; i < n; i++) {
    simulationTick(sim);
  }
}

// ─── Full simulation lifecycle test ─────────────────────────────────────────

describe('full simulation lifecycle with expanded features', () => {
  it('runs a complete battle with terrain, events, and memory', () => {
    // Setup: 3 player troops vs 3 enemy troops with a hill in between
    const playerLt = makeLt('lt_p', 'player', ['p1', 'p2', 'p3']);
    const enemyLt = makeLt('lt_e', 'enemy', ['e1', 'e2', 'e3']);

    const playerTroops = [
      makeTroop('p1', 'player', 'lt_p', { position: { x: 50, y: 150 } }),
      makeTroop('p2', 'player', 'lt_p', { position: { x: 50, y: 160 } }),
      makeTroop('p3', 'player', 'lt_p', { position: { x: 50, y: 170 } }),
    ];
    const enemyTroops = [
      makeTroop('e1', 'enemy', 'lt_e', { position: { x: 350, y: 150 } }),
      makeTroop('e2', 'enemy', 'lt_e', { position: { x: 350, y: 160 } }),
      makeTroop('e3', 'enemy', 'lt_e', { position: { x: 350, y: 170 } }),
    ];

    const hill: TerrainFeature = {
      id: 'hill_center',
      type: 'hill',
      position: { x: 180, y: 130 },
      size: { x: 40, y: 60 },
    };

    // Flowcharts: player troops advance and engage, enemy troops hold
    const flowcharts: Flowchart[] = [
      {
        agentId: 'lt_p',
        nodes: [],
        defaultAction: { type: 'hold' },
      },
      {
        agentId: 'lt_e',
        nodes: [],
        defaultAction: { type: 'hold' },
      },
      // Player troops advance toward the enemy
      ...['p1', 'p2', 'p3'].map(id => ({
        agentId: id,
        nodes: [
          {
            id: 'advance',
            on: 'no_enemies_visible' as const,
            action: { type: 'moveTo' as const, position: { x: 300, y: 160 } },
            priority: 1,
          },
          {
            id: 'engage_spotted',
            on: 'enemy_spotted' as const,
            action: { type: 'engage' as const, targetId: '' },
            priority: 5,
          },
          {
            id: 'on_terrain',
            on: 'terrain_entered' as const,
            action: { type: 'setFormation' as const, formation: 'scatter' as const },
            priority: 3,
          },
        ],
        defaultAction: { type: 'hold' as const },
      })),
      // Enemy troops hold and engage when attacked
      ...['e1', 'e2', 'e3'].map(id => ({
        agentId: id,
        nodes: [
          {
            id: 'engage_spotted',
            on: 'enemy_spotted' as const,
            action: { type: 'engage' as const, targetId: '' },
            priority: 5,
          },
          {
            id: 'on_formation_broken',
            on: 'formation_broken' as const,
            action: { type: 'setFormation' as const, formation: 'defensive_circle' as const },
            priority: 8,
          },
        ],
        defaultAction: { type: 'hold' as const },
      })),
    ];

    const sim = createSimulation(400, 300, [playerLt, enemyLt, ...playerTroops, ...enemyTroops], flowcharts);
    sim.terrain = createTerrainMap([hill]);
    sim.battle.running = true;

    // Run 20 ticks — troops should start moving
    runTicks(sim, 20);

    // Verify simulation is running and agents are alive
    expect(sim.battle.running).toBe(true);
    expect(sim.battle.agents.get('p1')!.alive).toBe(true);
    expect(sim.battle.agents.get('e1')!.alive).toBe(true);

    // Player troops should be moving toward enemy
    const p1 = sim.battle.agents.get('p1')!;
    expect(p1.position.x).toBeGreaterThan(50);

    // Filtered state for fog of war should work
    const filteredState = getFilteredStateForTeam(sim, 'player');
    expect(filteredState.agents.length).toBeGreaterThan(0);
    expect(filteredState.terrain).toHaveLength(1);
    expect(filteredState.terrain[0]!.type).toBe('hill');
  });

  it('terrain tracker detects transitions during movement', () => {
    const lt = makeLt('lt_p', 'player', ['p1']);
    const troop = makeTroop('p1', 'player', 'lt_p', {
      position: { x: 40, y: 60 },
    });

    const forest: TerrainFeature = {
      id: 'forest_1',
      type: 'forest',
      position: { x: 60, y: 50 },
      size: { x: 40, y: 40 },
    };

    const flowcharts: Flowchart[] = [
      { agentId: 'lt_p', nodes: [], defaultAction: { type: 'hold' } },
      {
        agentId: 'p1',
        nodes: [
          {
            id: 'on_forest',
            on: 'terrain_entered',
            action: { type: 'setFormation', formation: 'scatter' },
            priority: 5,
          },
        ],
        defaultAction: { type: 'hold' },
      },
    ];

    const sim = createSimulation(200, 200, [lt, troop], flowcharts);
    sim.terrain = createTerrainMap([forest]);
    sim.battle.running = true;

    // Initialize tracker
    runTicks(sim, 10);

    // Move troop into forest
    sim.battle.agents.get('p1')!.position = { x: 70, y: 60 };
    runTicks(sim, 10);

    // Should have switched to scatter
    expect(sim.battle.agents.get('p1')!.formation).toBe('scatter');
  });

  it('memory recorder captures battle events correctly', () => {
    const mem = createAgentMemory('lt_alpha');

    // Simulate a series of battle events
    const events: BattleEvent[] = [
      { type: 'engagement', tick: 50, team: 'player', message: 'Forces clashing at (200, 150)' },
      { type: 'kill', tick: 55, team: 'player', message: 'Your infantry fell at (200, 155)' },
      { type: 'kill', tick: 60, team: 'player', message: 'Your infantry fell at (205, 150)' },
      { type: 'casualty_milestone', tick: 60, team: 'player', message: 'Squad Alpha has taken 25% casualties' },
      { type: 'retreat', tick: 65, team: 'player', message: 'Your troop is routing!' },
    ];

    recordBattleEvents(mem, events, 65, 'player');

    expect(mem.observations).toHaveLength(5);
    expect(mem.observations[0]!.type).toBe('engagement');
    expect(mem.observations[4]!.type).toBe('routing');

    // Build summary for LLM prompt
    const summary = buildMemorySummary(mem);
    expect(summary).toContain('engagement');
    expect(summary).toContain('Forces clashing');
    expect(summary).toContain('routing');
  });

  it('memory summary integrates into lieutenant prompt', () => {
    const mem = createAgentMemory('lt_alpha');
    setBelief(mem, 'enemy_main_force', 'advancing from the east, ~15 units');
    setBelief(mem, 'threat_level', 'high');
    recordObservation(mem, 50, 'combat', 'Engaged enemy vanguard at ridge');
    recordObservation(mem, 80, 'casualty', 'Lost 2 troops to flanking attack');

    const context: LieutenantContext = {
      identity: {
        id: 'lt_alpha',
        name: 'Lt. Adaeze',
        personality: 'aggressive',
        stats: { initiative: 8, discipline: 5, communication: 7 },
      },
      currentOrders: 'Hold the ridge.',
      visibleUnits: [
        { id: 'p1', position: { x: 100, y: 100 }, health: 80, morale: 60 },
      ],
      authorizedPeers: ['lt_bravo'],
      terrain: 'Ridge with forest to the south.',
      recentMessages: [],
      memorySummary: buildMemorySummary(mem),
    };

    const prompt = buildLieutenantPrompt(context);

    // Verify memory is included in the prompt
    expect(prompt).toContain('Working Memory');
    expect(prompt).toContain('enemy_main_force');
    expect(prompt).toContain('advancing from the east');
    expect(prompt).toContain('Lost 2 troops');

    // Verify new event types are in the vocabulary
    expect(prompt).toContain('formation_broken');
    expect(prompt).toContain('morale_low');
    expect(prompt).toContain('enemy_retreating');
    expect(prompt).toContain('terrain_entered');
    expect(prompt).toContain('terrain_exited');

    // Verify new output fields documented
    expect(prompt).toContain('response_to_player');
    expect(prompt).toContain('updated_beliefs');
  });

  it('schema validates full LLM output with all new fields', () => {
    const output = {
      directives: [
        {
          unit: 'all',
          nodes: [
            {
              id: 'engage_close',
              on: 'enemy_spotted',
              condition: 'distance < 50',
              action: { type: 'engage', targetId: '' },
              priority: 5,
            },
            {
              id: 'react_broken',
              on: 'formation_broken',
              action: { type: 'setFormation', formation: 'defensive_circle' },
              priority: 8,
            },
            {
              id: 'react_morale',
              on: 'morale_low',
              action: { type: 'fallback', position: { x: 50, y: 150 } },
              priority: 9,
            },
            {
              id: 'pursue',
              on: 'enemy_retreating',
              action: { type: 'engage', targetId: '' },
              priority: 3,
            },
            {
              id: 'on_forest',
              on: 'terrain_entered',
              condition: "terrainType == 'forest'",
              action: { type: 'setFormation', formation: 'scatter' },
              priority: 4,
            },
          ],
        },
      ],
      message_up: 'Holding the ridge. Taking fire from the east.',
      message_peers: [{ to: 'lt_bravo', content: 'Need support on east flank.' }],
      response_to_player: 'Sir, we are holding but taking heavy casualties. Recommend reinforcements or permission to fall back.',
      updated_beliefs: {
        enemy_main_force: 'east ridge, approximately 15 units',
        threat_level: 'high',
        own_casualties: '2 lost, 8 remaining',
      },
    };

    const result = parseLieutenantOutput(JSON.stringify(output));
    expect(result.success).toBe(true);
    expect(result.data!.response_to_player).toContain('holding but taking heavy casualties');
    expect(result.data!.updated_beliefs).toHaveProperty('enemy_main_force');
    expect(result.data!.directives[0]!.nodes).toHaveLength(5);
  });
});
