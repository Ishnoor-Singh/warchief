/**
 * Core simulation loop for Warchief.
 *
 * Runs at 10 ticks/second, processing events, executing flowcharts,
 * resolving combat, and updating movement. Built on top of the
 * game engine module (matter-js backed) for reliable mechanics.
 *
 * ## Tick Cycle
 *
 * Each tick performs these steps in order:
 * 1. Update visibility and queue `enemy_spotted` events
 * 2. Process flowchart events for each agent and execute resulting actions
 * 3. Move agents toward their targets
 * 4. Resolve combat (stat-based damage)
 * 5. Check win conditions
 * 6. Fire callbacks
 */

import {
  Vec2,
  BattleState,
  AgentState,
  Team,
  CombatResult,
  VisibleEnemy,
  FormationType,
} from '../../shared/types/index.js';
import {
  GameEvent,
  GameAction,
  EnemySpottedEvent,
  UnderAttackEvent,
  AllyDownEvent,
  CasualtyThresholdEvent,
} from '../../shared/events/index.js';
import {
  FlowchartRuntime,
  Flowchart,
  createFlowchartRuntime,
  queueEvent,
  processEvents,
} from '../runtime/flowchart.js';
import {
  // Vector math
  distance as vecDistance,
  clone as vecClone,
  isWithinRange,
  moveToward,
  // Combat
  calculateDamage as engineCalculateDamage,
  applyDamage as engineApplyDamage,
  applyMoraleLoss,
  findCombatPairs,
  buildSquadCasualties,
  recordSquadDeath,
  checkWinCondition as engineCheckWinCondition,
  getTeamStrength,
  COMBAT_RANGE,
  MORALE_EFFECT_RANGE,
  // Movement
  getSpeed,
  getVisibleEnemies as engineGetVisibleEnemies,
  // Formations
  computeFormationSlot,
  // Unit types
  isTroop,
} from '../engine/index.js';

const TICK_RATE = 10;  // ticks per second
const TICK_MS = 1000 / TICK_RATE;
const VISIBILITY_EVENT_INTERVAL = 10;  // fire enemy_spotted every N ticks (1/sec)

// ─── Types ──────────────────────────────────────────────────────────────────

/** Callback for actions that need to route messages to the server layer. */
export interface SimulationCallbacks {
  onTroopMessage?: (agentId: string, type: 'requestSupport' | 'report' | 'alert', message: string) => void;
}

/** Battle events for the client-side ticker. */
export interface BattleEvent {
  type: 'kill' | 'engagement' | 'retreat' | 'squad_wiped' | 'casualty_milestone';
  tick: number;
  team: Team;
  message: string;
  position?: Vec2;
}

/** Full simulation state. */
export interface SimulationState {
  battle: BattleState;
  runtimes: Map<string, FlowchartRuntime>;
  lastCombat: Map<string, number>;
  squadCasualties: Map<string, { total: number; dead: number }>;
  callbacks: SimulationCallbacks;
  onTick?: (state: SimulationState) => void;
  onBattleEnd?: (winner: Team) => void;
  pendingBattleEvents: BattleEvent[];
  activeEngagements: Set<string>;
}

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize simulation with agents and their flowcharts.
 *
 * Uses engine's buildSquadCasualties for proper casualty tracking setup.
 */
export function createSimulation(
  width: number,
  height: number,
  agents: AgentState[],
  flowcharts: Flowchart[],
  callbacks: SimulationCallbacks = {}
): SimulationState {
  const battle: BattleState = {
    tick: 0,
    agents: new Map(agents.map(a => [a.id, a])),
    width,
    height,
    running: false,
    winner: null,
  };

  const runtimes = new Map<string, FlowchartRuntime>();
  for (const flowchart of flowcharts) {
    runtimes.set(flowchart.agentId, createFlowchartRuntime(flowchart));
  }

  return {
    battle,
    runtimes,
    lastCombat: new Map(),
    squadCasualties: buildSquadCasualties(agents),
    callbacks,
    pendingBattleEvents: [],
    activeEngagements: new Set(),
  };
}

// ─── Main Tick ──────────────────────────────────────────────────────────────

/** Process one simulation tick. */
export function simulationTick(state: SimulationState): void {
  const { battle, runtimes } = state;

  if (!battle.running) return;

  battle.tick++;

  // 1. Update visibility and queue enemy_spotted events
  updateVisibility(state);

  // 2. Process flowchart events for each agent
  for (const [agentId, runtime] of runtimes) {
    const agent = battle.agents.get(agentId);
    if (!agent || !agent.alive) continue;

    // Queue tick event
    queueEvent(runtime, { type: 'tick', tick: battle.tick });

    // Process all queued events
    const actions = processEvents(runtime);

    // Execute actions
    for (const action of actions) {
      executeAction(state, agentId, action);
    }
  }

  // 3. Move agents toward their targets (using engine movement)
  updateMovement(state);

  // 4. Resolve combat (using engine combat)
  resolveCombat(state);

  // 5. Check win condition (using engine win condition)
  checkWinCondition(state);

  // 6. Callback
  state.onTick?.(state);
}

// ─── Distance (re-exported for backwards compatibility) ─────────────────────

/** Calculate distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return vecDistance(a, b);
}

// ─── Visibility ─────────────────────────────────────────────────────────────

/** Get all enemies visible to an agent. */
function getVisibleEnemies(state: SimulationState, agent: AgentState): VisibleEnemy[] {
  const visible = engineGetVisibleEnemies(agent, state.battle.agents.values());
  return visible.map(v => ({
    enemyId: v.agent.id,
    position: vecClone(v.agent.position),
    distance: v.distance,
  }));
}

/** Update visibility and queue spotted events (throttled). */
function updateVisibility(state: SimulationState): void {
  const shouldFireVisibility = state.battle.tick % VISIBILITY_EVENT_INTERVAL === 0;

  for (const [, agent] of state.battle.agents) {
    if (!agent.alive) continue;

    const runtime = state.runtimes.get(agent.id);
    if (!runtime) continue;

    if (!shouldFireVisibility) continue;

    const visible = getVisibleEnemies(state, agent);

    if (visible.length > 0) {
      const closest = visible.reduce((a, b) => a.distance < b.distance ? a : b);
      const event: EnemySpottedEvent = {
        type: 'enemy_spotted',
        enemyId: closest.enemyId,
        position: closest.position,
        distance: closest.distance,
      };
      queueEvent(runtime, event);
    } else {
      queueEvent(runtime, { type: 'no_enemies_visible' });
    }
  }
}

// ─── Action Execution ───────────────────────────────────────────────────────

/** Execute an action for an agent. */
function executeAction(state: SimulationState, agentId: string, action: GameAction): void {
  const agent = state.battle.agents.get(agentId);
  if (!agent || !agent.alive) return;

  switch (action.type) {
    case 'moveTo':
      agent.targetPosition = action.position;
      agent.currentAction = 'moving';
      agent.targetId = null;
      break;

    case 'engage': {
      if (action.targetId) {
        agent.targetId = action.targetId;
      } else {
        const visible = getVisibleEnemies(state, agent);
        if (visible.length > 0) {
          const closest = visible.reduce((a, b) => a.distance < b.distance ? a : b);
          agent.targetId = closest.enemyId;
        }
      }
      agent.currentAction = 'engaging';
      break;
    }

    case 'fallback':
      agent.targetPosition = action.position;
      agent.currentAction = 'falling_back';
      agent.targetId = null;
      break;

    case 'hold':
      agent.targetPosition = null;
      agent.targetId = null;
      agent.currentAction = 'holding';
      break;

    case 'setFormation':
      agent.formation = action.formation;
      if (isTroop(agent)) {
        const lt = state.battle.agents.get(agent.lieutenantId);
        if (lt?.alive) {
          repositionInFormation(state, agent, action.formation, lt.position);
        }
      }
      break;

    case 'requestSupport':
      state.callbacks.onTroopMessage?.(agentId, 'requestSupport', action.message);
      break;

    case 'emit':
      state.callbacks.onTroopMessage?.(agentId, action.eventType, action.message);
      break;
  }
}

// ─── Formation Repositioning ────────────────────────────────────────────────

/**
 * Set a troop's target position to its slot in a formation around the lieutenant.
 * Uses engine's computeFormationSlot for positioning math.
 */
function repositionInFormation(
  state: SimulationState,
  agent: AgentState,
  formation: FormationType,
  ltPos: Vec2
): void {
  const teammates = Array.from(state.battle.agents.values())
    .filter(a => isTroop(a) && a.lieutenantId === agent.lieutenantId && a.alive)
    .sort((a, b) => a.id.localeCompare(b.id));

  const index = teammates.findIndex(a => a.id === agent.id);
  if (index === -1) return;

  const pos = computeFormationSlot(formation, ltPos, index, teammates.length);
  agent.targetPosition = pos;
  agent.currentAction = 'moving';
  agent.targetId = null;
}

// ─── Movement ───────────────────────────────────────────────────────────────

/**
 * Update agent positions based on their targets.
 * Uses engine's moveToward and getSpeed for reliable movement math.
 */
function updateMovement(state: SimulationState): void {
  for (const agent of state.battle.agents.values()) {
    if (!agent.alive) continue;

    const speed = getSpeed(agent);

    let targetPos: Vec2 | null = null;
    let isChasing = false;

    if (agent.targetId) {
      const target = state.battle.agents.get(agent.targetId);
      if (target && target.alive) {
        targetPos = target.position;
        isChasing = true;
      } else {
        agent.targetId = null;
      }
    } else if (agent.targetPosition) {
      targetPos = agent.targetPosition;
    }

    if (targetPos) {
      const dist = vecDistance(agent.position, targetPos);

      if (dist <= speed) {
        if (!isChasing) {
          agent.position = vecClone(targetPos);
          agent.targetPosition = null;
          agent.currentAction = 'holding';

          const runtime = state.runtimes.get(agent.id);
          if (runtime) {
            queueEvent(runtime, { type: 'arrived', position: targetPos });
          }
        }
      } else {
        agent.position = moveToward(agent.position, targetPos, speed);
      }
    }
  }
}

// ─── Combat ─────────────────────────────────────────────────────────────────

/**
 * Resolve combat between agents in range.
 * Uses engine's calculateDamage, applyDamage, and applyMoraleLoss.
 */
function resolveCombat(state: SimulationState): void {
  const agents = Array.from(state.battle.agents.values());
  const combatPairs = findCombatPairs(agents);

  for (const [a, b] of combatPairs) {
    // Emit engagement event for new combat pairs
    const pairKey = [a.id, b.id].sort().join(':');
    if (!state.activeEngagements.has(pairKey)) {
      state.activeEngagements.add(pairKey);
      const aTeamLabel = a.team === 'player' ? 'Your' : 'Enemy';
      state.pendingBattleEvents.push({
        type: 'engagement',
        tick: state.battle.tick,
        team: a.team,
        message: `${aTeamLabel} forces clashing with the enemy at (${Math.round(a.position.x)}, ${Math.round(a.position.y)})`,
        position: { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 },
      });
    }

    // Both sides deal damage using engine damage calculation
    const resultA = engineCalculateDamage(a, b);
    const resultB = engineCalculateDamage(b, a);

    applySimDamage(state, b, resultA);
    applySimDamage(state, a, resultB);
  }

  // Clean up engagement tracking for pairs no longer in combat
  for (const key of state.activeEngagements) {
    const [idA, idB] = key.split(':');
    const agentA = state.battle.agents.get(idA!);
    const agentB = state.battle.agents.get(idB!);
    if (!agentA?.alive || !agentB?.alive ||
        !isWithinRange(agentA.position, agentB.position, COMBAT_RANGE * 1.5)) {
      state.activeEngagements.delete(key);
    }
  }
}

/**
 * Apply damage to an agent within the simulation context.
 *
 * Handles:
 * - Health reduction and death (via engine applyDamage)
 * - under_attack event queuing
 * - Kill battle events
 * - Morale loss for nearby allies (via engine applyMoraleLoss)
 * - ally_down event queuing
 * - Squad casualty tracking (via engine recordSquadDeath)
 * - Casualty milestone battle events
 */
function applySimDamage(state: SimulationState, agent: AgentState, result: CombatResult): void {
  // Queue under_attack event
  const runtime = state.runtimes.get(agent.id);
  if (runtime) {
    const event: UnderAttackEvent = {
      type: 'under_attack',
      attackerId: result.attackerId,
      damage: result.damage,
    };
    queueEvent(runtime, event);
  }

  // Apply damage using engine
  const died = engineApplyDamage(agent, result.damage);
  result.defenderDied = died;

  if (died) {
    // Emit kill battle event
    const teamLabel = agent.team === 'player' ? 'Your' : 'Enemy';
    state.pendingBattleEvents.push({
      type: 'kill',
      tick: state.battle.tick,
      team: agent.team,
      message: `${teamLabel} ${agent.type} fell at (${Math.round(agent.position.x)}, ${Math.round(agent.position.y)})`,
      position: vecClone(agent.position),
    });

    // Apply morale loss to nearby allies (engine handles distance check)
    const affected = applyMoraleLoss(agent, state.battle.agents.values());

    // Queue ally_down event for affected allies
    for (const other of affected) {
      const otherRuntime = state.runtimes.get(other.id);
      if (otherRuntime) {
        const allyDownEvent: AllyDownEvent = {
          type: 'ally_down',
          unitId: agent.id,
          position: vecClone(agent.position),
        };
        queueEvent(otherRuntime, allyDownEvent);
      }
    }

    // Track squad casualties using engine
    const lossPercent = recordSquadDeath(state.squadCasualties, agent);

    if (lossPercent !== null && lossPercent >= 25) {
      // Fire casualty_threshold for all alive agents in same squad
      for (const other of state.battle.agents.values()) {
        if (other.team !== agent.team || !other.alive) continue;
        if (other.squadId !== agent.squadId) continue;

        const otherRuntime = state.runtimes.get(other.id);
        if (otherRuntime) {
          const casualtyEvent: CasualtyThresholdEvent = {
            type: 'casualty_threshold',
            lossPercent,
          };
          queueEvent(otherRuntime, casualtyEvent);
        }
      }

      // Emit casualty milestone events at 25%, 50%, 75%
      if (lossPercent === 25 || lossPercent === 50 || lossPercent === 75) {
        const teamLabel = agent.team === 'player' ? 'Your' : 'Enemy';
        state.pendingBattleEvents.push({
          type: 'casualty_milestone',
          tick: state.battle.tick,
          team: agent.team,
          message: `${teamLabel} ${agent.squadId} has taken ${lossPercent}% casualties`,
        });
      }

      // Squad wiped
      if (agent.squadId) {
        const key = `${agent.team}:${agent.squadId}`;
        const squad = state.squadCasualties.get(key);
        if (squad && squad.dead >= squad.total) {
          const teamLabel = agent.team === 'player' ? 'Your' : 'Enemy';
          state.pendingBattleEvents.push({
            type: 'squad_wiped',
            tick: state.battle.tick,
            team: agent.team,
            message: `${teamLabel} ${agent.squadId} has been wiped out!`,
          });
        }
      }
    }
  }
}

// ─── Win Condition ──────────────────────────────────────────────────────────

/** Check if battle is over using engine win condition. */
function checkWinCondition(state: SimulationState): void {
  const winner = engineCheckWinCondition(state.battle.agents.values());

  if (winner) {
    state.battle.running = false;
    state.battle.winner = winner;
    state.onBattleEnd?.(winner);
  }
}

// ─── Simulation Lifecycle ───────────────────────────────────────────────────

/** Start the simulation loop. */
export function startSimulation(state: SimulationState): NodeJS.Timeout {
  state.battle.running = true;

  return setInterval(() => {
    simulationTick(state);
  }, TICK_MS);
}

/** Stop the simulation. */
export function stopSimulation(state: SimulationState, timer: NodeJS.Timeout): void {
  state.battle.running = false;
  clearInterval(timer);
}

// ─── Summaries ──────────────────────────────────────────────────────────────

/** Get a one-line battle summary string. */
export function getBattleSummary(state: SimulationState): string {
  const strength = getTeamStrength(state.battle.agents.values());
  return `Tick ${state.battle.tick} | Player: ${strength.player.alive}/${strength.player.total} | Enemy: ${strength.enemy.alive}/${strength.enemy.total}`;
}

/** Visibility zone for fog-of-war rendering. */
export interface VisibilityZone {
  position: Vec2;
  radius: number;
}

/** Filtered state for a specific team (fog of war). */
export interface FilteredBattleState {
  tick: number;
  agents: Array<{
    id: string;
    type: string;
    team: Team;
    position: Vec2;
    health: number;
    maxHealth: number;
    morale: number;
    currentAction: string | null;
    formation: string;
    alive: boolean;
    lieutenantId: string | null;
  }>;
  visibilityZones: VisibilityZone[];
  width: number;
  height: number;
  running: boolean;
  winner: Team | null;
}

/** Get battle state filtered by team visibility (fog of war). */
export function getFilteredStateForTeam(state: SimulationState, team: Team): FilteredBattleState {
  const friendlyAgents: AgentState[] = [];
  const visibilityZones: VisibilityZone[] = [];

  for (const agent of state.battle.agents.values()) {
    if (agent.team === team && agent.alive) {
      friendlyAgents.push(agent);
      visibilityZones.push({
        position: vecClone(agent.position),
        radius: agent.visibilityRadius,
      });
    }
  }

  const visibleEnemies: AgentState[] = [];
  for (const agent of state.battle.agents.values()) {
    if (agent.team === team || !agent.alive) continue;

    for (const friendly of friendlyAgents) {
      if (isWithinRange(agent.position, friendly.position, friendly.visibilityRadius)) {
        visibleEnemies.push(agent);
        break;
      }
    }
  }

  const allVisible = [...friendlyAgents, ...visibleEnemies];

  return {
    tick: state.battle.tick,
    agents: allVisible.map(a => ({
      id: a.id,
      type: a.type,
      team: a.team,
      position: vecClone(a.position),
      health: a.health,
      maxHealth: a.maxHealth,
      morale: a.morale,
      currentAction: a.currentAction,
      formation: a.formation,
      alive: a.alive,
      lieutenantId: a.lieutenantId,
    })),
    visibilityZones,
    width: state.battle.width,
    height: state.battle.height,
    running: state.battle.running,
    winner: state.battle.winner,
  };
}

/** Detailed battle summary for end screen. */
export interface DetailedBattleSummary {
  tick: number;
  durationSeconds: number;
  winner: Team | null;
  player: { alive: number; dead: number; total: number };
  enemy: { alive: number; dead: number; total: number };
}

export function getDetailedBattleSummary(state: SimulationState): DetailedBattleSummary {
  const strength = getTeamStrength(state.battle.agents.values());

  return {
    tick: state.battle.tick,
    durationSeconds: state.battle.tick / 10,
    winner: state.battle.winner,
    player: {
      alive: strength.player.alive,
      dead: strength.player.total - strength.player.alive,
      total: strength.player.total,
    },
    enemy: {
      alive: strength.enemy.alive,
      dead: strength.enemy.total - strength.enemy.alive,
      total: strength.enemy.total,
    },
  };
}
