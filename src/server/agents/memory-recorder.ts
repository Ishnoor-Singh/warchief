/**
 * Memory recorder — automatically records significant simulation events
 * as observations in lieutenant memory.
 *
 * Called by the server layer after each tick to keep lieutenant memory
 * updated with battlefield developments. Only records events relevant
 * to the specific lieutenant (their troops, their area of visibility).
 */

import { recordObservation, type AgentMemory } from './memory.js';
import type { BattleEvent } from '../sim/simulation.js';

/**
 * Record relevant battle events into a lieutenant's memory.
 *
 * Filters events to only those the lieutenant would care about,
 * and formats them as concise observation summaries.
 */
export function recordBattleEvents(
  mem: AgentMemory,
  events: BattleEvent[],
  tick: number,
  team: 'player' | 'enemy',
): void {
  for (const event of events) {
    // Only record events relevant to this team
    if (event.team !== team && event.type !== 'stalemate_warning' && event.type !== 'stalemate_force_advance') {
      continue;
    }

    switch (event.type) {
      case 'kill':
        recordObservation(mem, tick, 'casualty', event.message);
        break;
      case 'retreat':
        recordObservation(mem, tick, 'routing', event.message);
        break;
      case 'squad_wiped':
        recordObservation(mem, tick, 'squad_wiped', event.message);
        break;
      case 'casualty_milestone':
        recordObservation(mem, tick, 'casualties', event.message);
        break;
      case 'stalemate_warning':
        recordObservation(mem, tick, 'stalemate', event.message);
        break;
      case 'engagement':
        recordObservation(mem, tick, 'engagement', event.message);
        break;
    }
  }
}
