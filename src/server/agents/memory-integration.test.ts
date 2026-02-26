/**
 * Tests for memory integration with the prompt builder and schema.
 */
import { describe, it, expect } from 'vitest';
import { buildLieutenantPrompt, type LieutenantContext } from './input-builder.js';
import { parseLieutenantOutput, validateLieutenantOutput } from './schema.js';
import { createAgentMemory, setBelief, recordObservation, buildMemorySummary } from './memory.js';

const baseContext: LieutenantContext = {
  identity: {
    id: 'lt_alpha',
    name: 'Lt. Adaeze',
    personality: 'aggressive',
    stats: { initiative: 7, discipline: 5, communication: 6 },
  },
  currentOrders: 'Attack the north ridge.',
  visibleUnits: [
    { id: 'p_s1_0', position: { x: 100, y: 100 }, health: 100, morale: 80 },
  ],
  authorizedPeers: ['lt_bravo'],
  terrain: 'Open ground.',
  recentMessages: [],
};

describe('memory in lieutenant prompt', () => {
  it('includes memory summary when provided', () => {
    const mem = createAgentMemory('lt_alpha');
    setBelief(mem, 'enemy_position', 'north ridge');
    recordObservation(mem, 50, 'combat', 'Heavy fire from north');

    const context: LieutenantContext = {
      ...baseContext,
      memorySummary: buildMemorySummary(mem),
    };

    const prompt = buildLieutenantPrompt(context);
    expect(prompt).toContain('Working Memory');
    expect(prompt).toContain('enemy_position');
    expect(prompt).toContain('north ridge');
    expect(prompt).toContain('Heavy fire from north');
  });

  it('omits memory section when not provided', () => {
    const prompt = buildLieutenantPrompt(baseContext);
    expect(prompt).not.toContain('Working Memory');
  });
});

describe('response_to_player in schema', () => {
  it('validates output with response_to_player', () => {
    const output = {
      directives: [{
        unit: 'all',
        nodes: [{
          id: 'engage',
          on: 'enemy_spotted',
          action: { type: 'engage', targetId: '' },
        }],
      }],
      response_to_player: 'Sir, we are heavily outnumbered on the north flank. Recommend pulling back.',
    };
    const result = validateLieutenantOutput(output);
    expect(result.success).toBe(true);
    expect(result.data!.response_to_player).toContain('outnumbered');
  });

  it('validates output without response_to_player', () => {
    const output = {
      directives: [{
        unit: 'all',
        nodes: [{
          id: 'engage',
          on: 'enemy_spotted',
          action: { type: 'engage', targetId: '' },
        }],
      }],
    };
    const result = validateLieutenantOutput(output);
    expect(result.success).toBe(true);
    expect(result.data!.response_to_player).toBeUndefined();
  });
});

describe('updated_beliefs in schema', () => {
  it('validates output with updated_beliefs', () => {
    const output = {
      directives: [{
        unit: 'all',
        nodes: [{
          id: 'hold',
          on: 'enemy_spotted',
          action: { type: 'hold' },
        }],
      }],
      updated_beliefs: {
        enemy_main_force: 'north ridge, approximately 20 units',
        threat_level: 'high',
        plan: 'defensive hold until reinforcements',
      },
    };
    const result = validateLieutenantOutput(output);
    expect(result.success).toBe(true);
    expect(result.data!.updated_beliefs).toHaveProperty('enemy_main_force');
  });

  it('parses beliefs from JSON string', () => {
    const json = JSON.stringify({
      directives: [{
        unit: 'all',
        nodes: [{
          id: 'hold',
          on: 'enemy_spotted',
          action: { type: 'hold' },
        }],
      }],
      updated_beliefs: {
        last_known_enemy_position: { x: 250, y: 100 },
      },
    });
    const result = parseLieutenantOutput(json);
    expect(result.success).toBe(true);
  });
});

describe('new event types in schema', () => {
  it('validates nodes with formation_broken event', () => {
    const output = {
      directives: [{
        unit: 'all',
        nodes: [{
          id: 'react_broken',
          on: 'formation_broken',
          action: { type: 'setFormation', formation: 'defensive_circle' },
        }],
      }],
    };
    const result = validateLieutenantOutput(output);
    expect(result.success).toBe(true);
  });

  it('validates nodes with morale_low event', () => {
    const output = {
      directives: [{
        unit: 'all',
        nodes: [{
          id: 'react_morale',
          on: 'morale_low',
          action: { type: 'fallback', position: { x: 50, y: 150 } },
        }],
      }],
    };
    const result = validateLieutenantOutput(output);
    expect(result.success).toBe(true);
  });

  it('validates nodes with enemy_retreating event', () => {
    const output = {
      directives: [{
        unit: 'all',
        nodes: [{
          id: 'pursue',
          on: 'enemy_retreating',
          action: { type: 'engage', targetId: '' },
        }],
      }],
    };
    const result = validateLieutenantOutput(output);
    expect(result.success).toBe(true);
  });

  it('validates nodes with terrain_entered event', () => {
    const output = {
      directives: [{
        unit: 'all',
        nodes: [{
          id: 'on_forest',
          on: 'terrain_entered',
          condition: "terrainType == 'forest'",
          action: { type: 'setFormation', formation: 'scatter' },
        }],
      }],
    };
    const result = validateLieutenantOutput(output);
    expect(result.success).toBe(true);
  });

  it('validates nodes with terrain_exited event', () => {
    const output = {
      directives: [{
        unit: 'all',
        nodes: [{
          id: 'off_forest',
          on: 'terrain_exited',
          action: { type: 'setFormation', formation: 'line' },
        }],
      }],
    };
    const result = validateLieutenantOutput(output);
    expect(result.success).toBe(true);
  });
});
