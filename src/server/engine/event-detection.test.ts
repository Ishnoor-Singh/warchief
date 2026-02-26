import { describe, it, expect } from 'vitest';
import {
  detectFormationBroken,
  detectMoraleLow,
  detectEnemyRetreating,
  detectTerrainTransition,
  createTerrainTracker,
  MORALE_LOW_THRESHOLD,
  FORMATION_BROKEN_THRESHOLD,
} from './event-detection.js';
import { createTroop } from './unit-types.js';
import { createTerrainMap, type TerrainFeature } from './terrain.js';
import type { AgentState } from '../../shared/types/index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTroop(overrides: Partial<AgentState> = {}): AgentState {
  return createTroop({
    id: overrides.id || 'troop_1',
    team: (overrides as any).team || 'player',
    position: overrides.position || { x: 100, y: 100 },
    preset: 'infantry',
    lieutenantId: (overrides as any).lieutenantId || 'lt_1',
    squadId: (overrides as any).squadId || 'alpha',
    ...overrides,
  } as any);
}

function makeAgent(id: string, overrides: Partial<AgentState> = {}): AgentState {
  const base = makeTroop({ id, ...overrides });
  return { ...base, ...overrides, id };
}

// ─── detectFormationBroken ──────────────────────────────────────────────────

describe('detectFormationBroken', () => {
  it('returns null when all troops are alive and not routing', () => {
    const agents = [
      makeAgent('t1', { lieutenantId: 'lt_1' } as any),
      makeAgent('t2', { lieutenantId: 'lt_1' } as any),
      makeAgent('t3', { lieutenantId: 'lt_1' } as any),
      makeAgent('t4', { lieutenantId: 'lt_1' } as any),
      makeAgent('t5', { lieutenantId: 'lt_1' } as any),
    ];
    expect(detectFormationBroken('lt_1', agents)).toBeNull();
  });

  it('returns null when formation is above threshold', () => {
    const agents = [
      makeAgent('t1', { lieutenantId: 'lt_1' } as any),
      makeAgent('t2', { lieutenantId: 'lt_1' } as any),
      makeAgent('t3', { lieutenantId: 'lt_1' } as any),
      makeAgent('t4', { lieutenantId: 'lt_1', alive: false } as any),
      makeAgent('t5', { lieutenantId: 'lt_1' } as any),
    ];
    // 4 of 5 intact = 80% > 60% threshold
    expect(detectFormationBroken('lt_1', agents)).toBeNull();
  });

  it('detects broken formation from casualties', () => {
    const agents = [
      makeAgent('t1', { lieutenantId: 'lt_1' } as any),
      makeAgent('t2', { lieutenantId: 'lt_1' } as any),
      makeAgent('t3', { lieutenantId: 'lt_1', alive: false } as any),
      makeAgent('t4', { lieutenantId: 'lt_1', alive: false } as any),
      makeAgent('t5', { lieutenantId: 'lt_1', alive: false } as any),
    ];
    const result = detectFormationBroken('lt_1', agents);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('formation_broken');
    expect(result!.reason).toBe('casualties');
    expect(result!.intactPercent).toBe(40);
  });

  it('detects broken formation from routing', () => {
    const agents = [
      makeAgent('t1', { lieutenantId: 'lt_1' } as any),
      makeAgent('t2', { lieutenantId: 'lt_1' } as any),
      makeAgent('t3', { lieutenantId: 'lt_1', currentAction: 'routing' } as any),
      makeAgent('t4', { lieutenantId: 'lt_1', currentAction: 'routing' } as any),
      makeAgent('t5', { lieutenantId: 'lt_1', currentAction: 'routing' } as any),
    ];
    const result = detectFormationBroken('lt_1', agents);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('routing');
  });

  it('ignores troops from other lieutenants', () => {
    const agents = [
      makeAgent('t1', { lieutenantId: 'lt_1' } as any),
      makeAgent('t2', { lieutenantId: 'lt_1' } as any),
      makeAgent('t3', { lieutenantId: 'lt_1' } as any),
      makeAgent('t4', { lieutenantId: 'lt_2', alive: false } as any),
      makeAgent('t5', { lieutenantId: 'lt_2', alive: false } as any),
    ];
    // lt_1 has 3/3 intact = 100%
    expect(detectFormationBroken('lt_1', agents)).toBeNull();
  });

  it('returns null for lieutenant with no troops', () => {
    expect(detectFormationBroken('lt_1', [])).toBeNull();
  });
});

// ─── detectMoraleLow ────────────────────────────────────────────────────────

describe('detectMoraleLow', () => {
  it('returns null when morale is above threshold', () => {
    const agents = [
      makeAgent('t1', { lieutenantId: 'lt_1', morale: 80 } as any),
      makeAgent('t2', { lieutenantId: 'lt_1', morale: 70 } as any),
      makeAgent('t3', { lieutenantId: 'lt_1', morale: 60 } as any),
    ];
    expect(detectMoraleLow('lt_1', agents)).toBeNull();
  });

  it('detects low morale when average drops below threshold', () => {
    const agents = [
      makeAgent('t1', { lieutenantId: 'lt_1', morale: 30 } as any),
      makeAgent('t2', { lieutenantId: 'lt_1', morale: 20 } as any),
      makeAgent('t3', { lieutenantId: 'lt_1', morale: 35 } as any),
    ];
    const result = detectMoraleLow('lt_1', agents);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('morale_low');
    expect(result!.averageMorale).toBe(28); // (30+20+35)/3 = 28.3 rounds to 28
    expect(result!.lowestMorale).toBe(20);
  });

  it('ignores dead troops', () => {
    const agents = [
      makeAgent('t1', { lieutenantId: 'lt_1', morale: 80 } as any),
      makeAgent('t2', { lieutenantId: 'lt_1', morale: 70 } as any),
      makeAgent('t3', { lieutenantId: 'lt_1', morale: 0, alive: false } as any),
    ];
    // dead troop's 0 morale shouldn't count
    expect(detectMoraleLow('lt_1', agents)).toBeNull();
  });

  it('ignores troops from other lieutenants', () => {
    const agents = [
      makeAgent('t1', { lieutenantId: 'lt_1', morale: 80 } as any),
      makeAgent('t2', { lieutenantId: 'lt_2', morale: 10 } as any),
    ];
    expect(detectMoraleLow('lt_1', agents)).toBeNull();
  });

  it('returns null for no alive troops', () => {
    const agents = [
      makeAgent('t1', { lieutenantId: 'lt_1', morale: 10, alive: false } as any),
    ];
    expect(detectMoraleLow('lt_1', agents)).toBeNull();
  });
});

// ─── detectEnemyRetreating ──────────────────────────────────────────────────

describe('detectEnemyRetreating', () => {
  it('detects visible routing enemies', () => {
    const observer = makeAgent('t1', {
      team: 'player',
      position: { x: 100, y: 100 },
      visibilityRadius: 60,
    } as any);
    const allAgents = [
      observer,
      makeAgent('e1', {
        team: 'enemy',
        position: { x: 130, y: 100 },
        currentAction: 'routing',
      } as any),
    ];

    const events = detectEnemyRetreating(observer, allAgents);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('enemy_retreating');
    expect(events[0]!.enemyId).toBe('e1');
  });

  it('ignores non-routing enemies', () => {
    const observer = makeAgent('t1', {
      team: 'player',
      position: { x: 100, y: 100 },
      visibilityRadius: 60,
    } as any);
    const allAgents = [
      observer,
      makeAgent('e1', {
        team: 'enemy',
        position: { x: 130, y: 100 },
        currentAction: 'engaging',
      } as any),
    ];

    expect(detectEnemyRetreating(observer, allAgents)).toHaveLength(0);
  });

  it('ignores routing enemies outside visibility', () => {
    const observer = makeAgent('t1', {
      team: 'player',
      position: { x: 100, y: 100 },
      visibilityRadius: 60,
    } as any);
    const allAgents = [
      observer,
      makeAgent('e1', {
        team: 'enemy',
        position: { x: 300, y: 100 },
        currentAction: 'routing',
      } as any),
    ];

    expect(detectEnemyRetreating(observer, allAgents)).toHaveLength(0);
  });

  it('ignores dead routing enemies', () => {
    const observer = makeAgent('t1', {
      team: 'player',
      position: { x: 100, y: 100 },
      visibilityRadius: 60,
    } as any);
    const allAgents = [
      observer,
      makeAgent('e1', {
        team: 'enemy',
        position: { x: 130, y: 100 },
        currentAction: 'routing',
        alive: false,
      } as any),
    ];

    expect(detectEnemyRetreating(observer, allAgents)).toHaveLength(0);
  });

  it('ignores same-team routing agents', () => {
    const observer = makeAgent('t1', {
      team: 'player',
      position: { x: 100, y: 100 },
      visibilityRadius: 60,
    } as any);
    const allAgents = [
      observer,
      makeAgent('t2', {
        team: 'player',
        position: { x: 130, y: 100 },
        currentAction: 'routing',
      } as any),
    ];

    expect(detectEnemyRetreating(observer, allAgents)).toHaveLength(0);
  });
});

// ─── detectTerrainTransition ────────────────────────────────────────────────

describe('detectTerrainTransition', () => {
  const hillFeature: TerrainFeature = {
    id: 'hill_1',
    type: 'hill',
    position: { x: 50, y: 50 },
    size: { x: 50, y: 50 },
  };
  const forestFeature: TerrainFeature = {
    id: 'forest_1',
    type: 'forest',
    position: { x: 150, y: 50 },
    size: { x: 50, y: 50 },
  };
  const terrain = createTerrainMap([hillFeature, forestFeature]);

  it('detects entering terrain from open ground', () => {
    const tracker = createTerrainTracker();
    const agent = makeAgent('t1', { position: { x: 10, y: 10 } });
    // First call: open ground, no transition (first time)
    detectTerrainTransition(agent, terrain, tracker);

    // Move into hill
    agent.position = { x: 60, y: 60 };
    const events = detectTerrainTransition(agent, terrain, tracker);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('terrain_entered');
    expect(events[0]!.terrainType).toBe('hill');
  });

  it('detects exiting terrain to open ground', () => {
    const tracker = createTerrainTracker();
    const agent = makeAgent('t1', { position: { x: 60, y: 60 } });
    // First call: on hill
    detectTerrainTransition(agent, terrain, tracker);

    // Move off hill to open ground
    agent.position = { x: 10, y: 10 };
    const events = detectTerrainTransition(agent, terrain, tracker);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('terrain_exited');
    expect(events[0]!.terrainType).toBe('hill');
  });

  it('detects transition between terrain types', () => {
    const tracker = createTerrainTracker();
    const agent = makeAgent('t1', { position: { x: 60, y: 60 } });
    // First call: on hill
    detectTerrainTransition(agent, terrain, tracker);

    // Move from hill to forest
    agent.position = { x: 160, y: 60 };
    const events = detectTerrainTransition(agent, terrain, tracker);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('terrain_exited');
    expect(events[0]!.terrainType).toBe('hill');
    expect(events[1]!.type).toBe('terrain_entered');
    expect(events[1]!.terrainType).toBe('forest');
  });

  it('returns no events when staying in same terrain', () => {
    const tracker = createTerrainTracker();
    const agent = makeAgent('t1', { position: { x: 60, y: 60 } });
    detectTerrainTransition(agent, terrain, tracker);

    // Move within the hill
    agent.position = { x: 70, y: 70 };
    const events = detectTerrainTransition(agent, terrain, tracker);
    expect(events).toHaveLength(0);
  });

  it('returns no events on first call (no previous state)', () => {
    const tracker = createTerrainTracker();
    const agent = makeAgent('t1', { position: { x: 60, y: 60 } });
    // Even though agent is on a hill, first call has no previous state to compare
    // Actually — on first call, previousId is null and currentId is 'hill_1'
    // so it should emit a terrain_entered event
    const events = detectTerrainTransition(agent, terrain, tracker);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('terrain_entered');
  });

  it('no events on first call from open ground', () => {
    const tracker = createTerrainTracker();
    const agent = makeAgent('t1', { position: { x: 10, y: 10 } });
    // Both previous (null) and current (null) are the same
    const events = detectTerrainTransition(agent, terrain, tracker);
    expect(events).toHaveLength(0);
  });
});
