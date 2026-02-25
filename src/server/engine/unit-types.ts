/**
 * Unit type definitions and factory functions for Warchief.
 *
 * Every unit in the game has clearly defined stats, defaults, and
 * creation functions. This replaces ad-hoc agent creation throughout
 * the codebase with a single source of truth.
 *
 * ## Unit Types
 *
 * ### Troops
 * Troops are the combat units. They execute flowchart logic, fight
 * enemies, and move in formations. Troops never call LLMs.
 *
 * - **combat** (1-10): Attack/defense effectiveness.
 * - **speed**: Movement rate in units per tick.
 * - **courage** (1-10): Threshold before breaking formation under fire.
 * - **discipline** (1-10): How precisely they follow flowchart logic.
 *
 * ### Lieutenants
 * Lieutenants are LLM-powered commanders. They interpret player orders,
 * produce flowchart directives for their troops, and report upward.
 *
 * - **initiative** (1-10): Likelihood of acting without explicit orders.
 * - **discipline** (1-10): How literally they interpret orders.
 * - **communication** (1-10): Quality/frequency of reports upward.
 * - **personality**: Shapes tactical decision-making style.
 */

import type {
  Vec2,
  TroopStats,
  LieutenantStats,
  TroopAgent,
  LieutenantAgent,
  AgentState,
  FormationType,
  Team,
} from '../../shared/types/index.js';
import { clone } from './vec2.js';

// ─── Default Stats ──────────────────────────────────────────────────────────

/** Default stats for a generic troop. */
export const DEFAULT_TROOP_STATS: Readonly<TroopStats> = Object.freeze({
  combat: 5,
  speed: 2,
  courage: 5,
  discipline: 5,
});

/** Default stats for a generic lieutenant. */
export const DEFAULT_LIEUTENANT_STATS: Readonly<LieutenantStats> = Object.freeze({
  initiative: 5,
  discipline: 5,
  communication: 5,
});

// ─── Preset Troop Archetypes ────────────────────────────────────────────────

/**
 * Pre-defined troop stat presets for common unit archetypes.
 * Each archetype represents a distinct tactical role with
 * balanced trade-offs between stats.
 */
export const TROOP_PRESETS = {
  /** Standard balanced infantry. */
  infantry: {
    combat: 5,
    speed: 2,
    courage: 5,
    discipline: 5,
  },

  /** Lightly armed, fast-moving scouts. Low combat, high speed. */
  scout: {
    combat: 3,
    speed: 4,
    courage: 4,
    discipline: 4,
  },

  /** Heavy front-line fighters. High combat, low speed. */
  vanguard: {
    combat: 8,
    speed: 1.5,
    courage: 7,
    discipline: 6,
  },

  /** Disciplined ranged units. Moderate combat, hold formation well. */
  archer: {
    combat: 4,
    speed: 2,
    courage: 4,
    discipline: 8,
  },

  /** Shock troops. High combat and speed, but low discipline and courage. */
  berserker: {
    combat: 9,
    speed: 3,
    courage: 3,
    discipline: 2,
  },

  /** Defensive units. High courage/discipline, moderate combat. */
  guardian: {
    combat: 6,
    speed: 1.5,
    courage: 9,
    discipline: 8,
  },

  /** Militia/conscripts. Below average in everything. */
  militia: {
    combat: 3,
    speed: 2,
    courage: 3,
    discipline: 3,
  },
} as const satisfies Record<string, TroopStats>;

export type TroopPreset = keyof typeof TROOP_PRESETS;

// ─── Preset Lieutenant Archetypes ───────────────────────────────────────────

export const LIEUTENANT_PRESETS = {
  /** Aggressive commander. High initiative, will press the attack. */
  aggressive: {
    personality: 'aggressive' as const,
    stats: { initiative: 8, discipline: 4, communication: 5 },
  },

  /** Cautious commander. Careful, communicates well, waits for orders. */
  cautious: {
    personality: 'cautious' as const,
    stats: { initiative: 3, discipline: 7, communication: 8 },
  },

  /** Disciplined commander. Follows orders precisely, moderate initiative. */
  disciplined: {
    personality: 'disciplined' as const,
    stats: { initiative: 5, discipline: 9, communication: 6 },
  },

  /** Impulsive commander. Acts fast, communicates poorly. */
  impulsive: {
    personality: 'impulsive' as const,
    stats: { initiative: 9, discipline: 3, communication: 3 },
  },
} as const;

export type LieutenantPreset = keyof typeof LIEUTENANT_PRESETS;

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default visibility radius for troops. */
export const TROOP_VISIBILITY_RADIUS = 60;

/** Default visibility radius for lieutenants (higher than troops). */
export const LIEUTENANT_VISIBILITY_RADIUS = 150;

/** Default starting health for all units. */
export const DEFAULT_HEALTH = 100;

/** Default starting morale for all units. */
export const DEFAULT_MORALE = 100;

/** Default formation for newly created units. */
export const DEFAULT_FORMATION: FormationType = 'line';

// ─── Factory Functions ──────────────────────────────────────────────────────

export interface CreateTroopOptions {
  id: string;
  team: Team;
  position: Vec2;
  lieutenantId: string;
  squadId: string;
  stats?: Partial<TroopStats>;
  preset?: TroopPreset;
  health?: number;
  morale?: number;
  formation?: FormationType;
  visibilityRadius?: number;
}

/**
 * Create a troop agent with sensible defaults.
 *
 * Stats can be provided directly, via a preset name, or will default
 * to standard infantry stats.
 *
 * @example
 * ```ts
 * const trooper = createTroop({
 *   id: 'p_s1_0',
 *   team: 'player',
 *   position: { x: 100, y: 100 },
 *   lieutenantId: 'lt_alpha',
 *   squadId: 'squad_1',
 *   preset: 'vanguard',
 * });
 * ```
 */
export function createTroop(options: CreateTroopOptions): TroopAgent {
  const baseStats: TroopStats = options.preset
    ? { ...TROOP_PRESETS[options.preset] }
    : { ...DEFAULT_TROOP_STATS };

  const stats: TroopStats = options.stats
    ? { ...baseStats, ...options.stats }
    : baseStats;

  return {
    id: options.id,
    type: 'troop',
    team: options.team,
    position: clone(options.position),
    health: options.health ?? DEFAULT_HEALTH,
    maxHealth: options.health ?? DEFAULT_HEALTH,
    morale: options.morale ?? DEFAULT_MORALE,
    currentAction: 'holding',
    targetPosition: null,
    targetId: null,
    formation: options.formation ?? DEFAULT_FORMATION,
    visibilityRadius: options.visibilityRadius ?? TROOP_VISIBILITY_RADIUS,
    stats,
    lieutenantId: options.lieutenantId,
    squadId: options.squadId,
    alive: true,
  };
}

export interface CreateLieutenantOptions {
  id: string;
  team: Team;
  position: Vec2;
  name: string;
  personality?: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
  preset?: LieutenantPreset;
  stats?: Partial<LieutenantStats>;
  troopIds?: string[];
  health?: number;
  morale?: number;
  visibilityRadius?: number;
}

/**
 * Create a lieutenant agent with sensible defaults.
 *
 * Stats and personality can be provided directly, via a preset name,
 * or will default to balanced stats.
 *
 * @example
 * ```ts
 * const lt = createLieutenant({
 *   id: 'lt_alpha',
 *   team: 'player',
 *   position: { x: 20, y: 80 },
 *   name: 'Lt. Adaeze',
 *   preset: 'aggressive',
 *   troopIds: ['p_s1_0', 'p_s1_1'],
 * });
 * ```
 */
export function createLieutenant(options: CreateLieutenantOptions): LieutenantAgent {
  let personality = options.personality ?? 'disciplined';
  let stats: LieutenantStats = { ...DEFAULT_LIEUTENANT_STATS };

  if (options.preset) {
    const preset = LIEUTENANT_PRESETS[options.preset];
    personality = preset.personality;
    stats = { ...preset.stats };
  }

  if (options.stats) {
    stats = { ...stats, ...options.stats };
  }

  return {
    id: options.id,
    type: 'lieutenant',
    team: options.team,
    position: clone(options.position),
    health: options.health ?? DEFAULT_HEALTH,
    maxHealth: options.health ?? DEFAULT_HEALTH,
    morale: options.morale ?? DEFAULT_MORALE,
    currentAction: 'holding',
    targetPosition: null,
    targetId: null,
    formation: DEFAULT_FORMATION,
    visibilityRadius: options.visibilityRadius ?? LIEUTENANT_VISIBILITY_RADIUS,
    stats,
    lieutenantId: null,
    squadId: null,
    alive: true,
    personality,
    name: options.name,
    troopIds: options.troopIds ?? [],
  };
}

/**
 * Create a squad of troops arranged in a line formation.
 *
 * @param baseId - Prefix for troop IDs (e.g., 'p_s1' produces 'p_s1_0', 'p_s1_1', etc.)
 * @param count - Number of troops in the squad
 * @param options - Shared options for all troops in the squad
 */
export function createSquad(
  baseId: string,
  count: number,
  options: Omit<CreateTroopOptions, 'id' | 'position'> & { centerPosition: Vec2 }
): TroopAgent[] {
  const troops: TroopAgent[] = [];
  const spacing = 15;
  const startX = options.centerPosition.x - ((count - 1) * spacing) / 2;

  for (let i = 0; i < count; i++) {
    troops.push(createTroop({
      ...options,
      id: `${baseId}_${i}`,
      position: { x: startX + i * spacing, y: options.centerPosition.y },
    }));
  }

  return troops;
}

// ─── Type Guards ────────────────────────────────────────────────────────────

/** Check if an agent is a troop. */
export function isTroop(agent: AgentState): agent is TroopAgent {
  return agent.type === 'troop';
}

/** Check if an agent is a lieutenant. */
export function isLieutenant(agent: AgentState): agent is LieutenantAgent {
  return agent.type === 'lieutenant';
}

/** Get troop stats, throwing if the agent is not a troop. */
export function getTroopStats(agent: AgentState): TroopStats {
  if (!isTroop(agent)) {
    throw new Error(`Expected troop, got ${agent.type} (id: ${agent.id})`);
  }
  return agent.stats;
}

/** Get lieutenant stats, throwing if the agent is not a lieutenant. */
export function getLieutenantStats(agent: AgentState): LieutenantStats {
  if (!isLieutenant(agent)) {
    throw new Error(`Expected lieutenant, got ${agent.type} (id: ${agent.id})`);
  }
  return agent.stats;
}
