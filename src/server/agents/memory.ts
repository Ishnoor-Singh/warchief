/**
 * Agent working memory — structured state that persists across LLM calls.
 *
 * This gives lieutenants the ability to:
 * - Track beliefs about the battlefield (enemy positions, threat levels)
 * - Maintain a rolling log of important observations
 * - Build context that accumulates over time
 *
 * Memory is NOT free-form text. It's structured so the LLM can read
 * and write to it deterministically, and so the prompt builder can
 * include it efficiently.
 *
 * The LLM sets beliefs via its output. The simulation records
 * observations automatically from significant events.
 */

/** Maximum observations retained before oldest are evicted. */
export const MAX_OBSERVATIONS = 20;

/** A single observation recorded from the battlefield. */
export interface Observation {
  tick: number;
  type: string;
  summary: string;
}

/** Persistent memory for a lieutenant agent. */
export interface AgentMemory {
  agentId: string;
  /** Named beliefs the agent holds about the world. */
  beliefs: Map<string, unknown>;
  /** Rolling log of significant observations (capped at MAX_OBSERVATIONS). */
  observations: Observation[];
}

/** Create a fresh, empty memory for an agent. */
export function createAgentMemory(agentId: string): AgentMemory {
  return {
    agentId,
    beliefs: new Map(),
    observations: [],
  };
}

/** Set or update a named belief. */
export function setBelief(mem: AgentMemory, key: string, value: unknown): void {
  mem.beliefs.set(key, value);
}

/** Get a named belief (returns undefined if not set). */
export function getBelief(mem: AgentMemory, key: string): unknown {
  return mem.beliefs.get(key);
}

/** Record a new observation. Evicts oldest if at capacity. */
export function recordObservation(
  mem: AgentMemory,
  tick: number,
  type: string,
  summary: string,
): void {
  mem.observations.push({ tick, type, summary });
  if (mem.observations.length > MAX_OBSERVATIONS) {
    mem.observations.shift();
  }
}

/** Get the N most recent observations. */
export function getRecentObservations(mem: AgentMemory, count: number): Observation[] {
  return mem.observations.slice(-count);
}

/**
 * Build a human-readable memory summary for inclusion in the LLM prompt.
 *
 * Includes both beliefs and recent observations so the lieutenant
 * can reason about what it has learned over the course of the battle.
 */
export function buildMemorySummary(mem: AgentMemory): string {
  const sections: string[] = [];

  // Beliefs
  if (mem.beliefs.size > 0) {
    const beliefLines = Array.from(mem.beliefs.entries()).map(([key, value]) => {
      const valStr = typeof value === 'string' ? value : JSON.stringify(value);
      return `- ${key}: ${valStr}`;
    });
    sections.push(`Beliefs:\n${beliefLines.join('\n')}`);
  }

  // Observations
  if (mem.observations.length > 0) {
    const obsLines = mem.observations.map(o =>
      `- [tick ${o.tick}] (${o.type}) ${o.summary}`
    );
    sections.push(`Recent observations:\n${obsLines.join('\n')}`);
  } else {
    sections.push('No observations recorded yet.');
  }

  return sections.join('\n\n');
}
