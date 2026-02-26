import { describe, it, expect } from 'vitest';
import {
  createAgentMemory,
  recordObservation,
  setBelief,
  getBelief,
  getRecentObservations,
  buildMemorySummary,
  type AgentMemory,
  MAX_OBSERVATIONS,
} from './memory.js';

describe('createAgentMemory', () => {
  it('creates empty memory', () => {
    const mem = createAgentMemory('lt_1');
    expect(mem.agentId).toBe('lt_1');
    expect(mem.beliefs.size).toBe(0);
    expect(mem.observations).toHaveLength(0);
  });
});

describe('beliefs', () => {
  it('stores and retrieves a belief', () => {
    const mem = createAgentMemory('lt_1');
    setBelief(mem, 'enemy_position', { x: 200, y: 100 });
    expect(getBelief(mem, 'enemy_position')).toEqual({ x: 200, y: 100 });
  });

  it('overwrites existing belief', () => {
    const mem = createAgentMemory('lt_1');
    setBelief(mem, 'threat_level', 'low');
    setBelief(mem, 'threat_level', 'high');
    expect(getBelief(mem, 'threat_level')).toBe('high');
  });

  it('returns undefined for missing belief', () => {
    const mem = createAgentMemory('lt_1');
    expect(getBelief(mem, 'nonexistent')).toBeUndefined();
  });
});

describe('observations', () => {
  it('records an observation with tick', () => {
    const mem = createAgentMemory('lt_1');
    recordObservation(mem, 10, 'enemy_spotted', 'Spotted 3 enemies at north ridge');
    expect(mem.observations).toHaveLength(1);
    expect(mem.observations[0]).toEqual({
      tick: 10,
      type: 'enemy_spotted',
      summary: 'Spotted 3 enemies at north ridge',
    });
  });

  it('maintains chronological order', () => {
    const mem = createAgentMemory('lt_1');
    recordObservation(mem, 10, 'enemy_spotted', 'First');
    recordObservation(mem, 20, 'casualty', 'Second');
    recordObservation(mem, 30, 'terrain', 'Third');

    expect(mem.observations[0]!.summary).toBe('First');
    expect(mem.observations[2]!.summary).toBe('Third');
  });

  it('caps at MAX_OBSERVATIONS (oldest evicted)', () => {
    const mem = createAgentMemory('lt_1');
    for (let i = 0; i < MAX_OBSERVATIONS + 5; i++) {
      recordObservation(mem, i, 'tick', `Observation ${i}`);
    }

    expect(mem.observations).toHaveLength(MAX_OBSERVATIONS);
    // Oldest should be evicted
    expect(mem.observations[0]!.summary).toBe(`Observation 5`);
  });

  it('getRecentObservations returns latest N', () => {
    const mem = createAgentMemory('lt_1');
    for (let i = 0; i < 10; i++) {
      recordObservation(mem, i, 'tick', `Obs ${i}`);
    }

    const recent = getRecentObservations(mem, 3);
    expect(recent).toHaveLength(3);
    expect(recent[0]!.summary).toBe('Obs 7');
    expect(recent[2]!.summary).toBe('Obs 9');
  });
});

describe('buildMemorySummary', () => {
  it('builds a readable summary with beliefs and observations', () => {
    const mem = createAgentMemory('lt_1');
    setBelief(mem, 'enemy_main_force', 'north ridge, ~20 units');
    setBelief(mem, 'own_status', 'holding defensive position');
    recordObservation(mem, 50, 'combat', 'Took heavy fire from north');
    recordObservation(mem, 80, 'retreat', 'Enemy retreating east');

    const summary = buildMemorySummary(mem);
    expect(summary).toContain('enemy_main_force');
    expect(summary).toContain('north ridge');
    expect(summary).toContain('Took heavy fire');
    expect(summary).toContain('Enemy retreating east');
  });

  it('returns empty indicator when memory is blank', () => {
    const mem = createAgentMemory('lt_1');
    const summary = buildMemorySummary(mem);
    expect(summary).toContain('No observations');
  });
});
