import { describe, it, expect } from 'vitest';
import { recordBattleEvents } from './memory-recorder.js';
import { createAgentMemory } from './memory.js';
import type { BattleEvent } from '../sim/simulation.js';

describe('recordBattleEvents', () => {
  it('records kill events for the lieutenant team', () => {
    const mem = createAgentMemory('lt_1');
    const events: BattleEvent[] = [
      { type: 'kill', tick: 50, team: 'player', message: 'Your troop fell at (100, 150)' },
    ];
    recordBattleEvents(mem, events, 50, 'player');
    expect(mem.observations).toHaveLength(1);
    expect(mem.observations[0]!.type).toBe('casualty');
  });

  it('ignores enemy team events', () => {
    const mem = createAgentMemory('lt_1');
    const events: BattleEvent[] = [
      { type: 'kill', tick: 50, team: 'enemy', message: 'Enemy troop fell' },
    ];
    recordBattleEvents(mem, events, 50, 'player');
    expect(mem.observations).toHaveLength(0);
  });

  it('records stalemate warnings for any team', () => {
    const mem = createAgentMemory('lt_1');
    const events: BattleEvent[] = [
      { type: 'stalemate_warning', tick: 100, team: 'player', message: 'Battle stalled' },
    ];
    recordBattleEvents(mem, events, 100, 'enemy');
    expect(mem.observations).toHaveLength(1);
    expect(mem.observations[0]!.type).toBe('stalemate');
  });

  it('records retreat events', () => {
    const mem = createAgentMemory('lt_1');
    const events: BattleEvent[] = [
      { type: 'retreat', tick: 75, team: 'player', message: 'Your troop routing' },
    ];
    recordBattleEvents(mem, events, 75, 'player');
    expect(mem.observations).toHaveLength(1);
    expect(mem.observations[0]!.type).toBe('routing');
  });

  it('records multiple events in order', () => {
    const mem = createAgentMemory('lt_1');
    const events: BattleEvent[] = [
      { type: 'engagement', tick: 50, team: 'player', message: 'Clashing at (100, 100)' },
      { type: 'kill', tick: 55, team: 'player', message: 'Troop fell' },
      { type: 'casualty_milestone', tick: 60, team: 'player', message: '25% casualties' },
    ];
    recordBattleEvents(mem, events, 60, 'player');
    expect(mem.observations).toHaveLength(3);
    expect(mem.observations[0]!.type).toBe('engagement');
    expect(mem.observations[2]!.type).toBe('casualties');
  });
});
