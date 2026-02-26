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
  clamp as clampVec,
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
  FORMATION_SPACING,
  // Unit types
  isTroop,
  isLieutenant,
} from '../engine/index.js';
import type { LieutenantAgent } from '../engine/index.js';
import {
  getFormationModifiers,
  calculateFlankingMultiplier,
  calculateChargeBonusDamage,
} from '../engine/combat-modifiers.js';
import {
  shouldRout,
  applyRoutingPanic,
  checkMoraleRecovery,
} from '../engine/morale.js';
import {
  createTerrainMap,
  getTerrainModifiers,
  type TerrainMap,
} from '../engine/terrain.js';
import {
  createStalemateTracker,
  recordCombat,
  checkStalemate,
  type StalemateTracker,
} from '../engine/stalemate.js';
import {
  createMessageBus,
  send as busSend,
  type MessageBus,
} from '../comms/message-bus.js';
import type { FlankedEvent } from '../../shared/events/index.js';

const TICK_RATE = 10;  // ticks per second
const TICK_MS = 1000 / TICK_RATE;
const VISIBILITY_EVENT_INTERVAL = 10;  // fire enemy_spotted every N ticks (1/sec)

/** Margin from map edge — units cannot move closer than this to any edge. */
const BOUNDARY_MARGIN = 12;

/** Minimum distance between any two alive units before separation is applied. */
const UNIT_MIN_SEPARATION = 8;

/** How strongly overlapping units are pushed apart each tick. */
const UNIT_PUSH_FORCE = 0.6;

/** Team-based facing directions (toward the enemy). */
const PLAYER_FACING: Vec2 = { x: 1, y: 0 };  // east
const ENEMY_FACING: Vec2 = { x: -1, y: 0 };  // west

// ─── Types ──────────────────────────────────────────────────────────────────

/** Callback for actions that need to route messages to the server layer. */
export interface SimulationCallbacks {
  onTroopMessage?: (agentId: string, type: 'requestSupport' | 'report' | 'alert', message: string) => void;
}

/** Battle events for the client-side ticker. */
export interface BattleEvent {
  type: 'kill' | 'engagement' | 'retreat' | 'squad_wiped' | 'casualty_milestone' | 'stalemate_warning' | 'stalemate_force_advance';
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
  /** Terrain map for the battle (hills, forests, rivers). */
  terrain: TerrainMap;
  /** Tracks which agents were moving last tick (for charge bonus). */
  wasMovingLastTick: Set<string>;
  /** Tracks agents that have already received their charge bonus (one-time). */
  chargeApplied: Set<string>;
  /** Tracks ticks since last combat for stalemate detection. */
  stalemateTracker: StalemateTracker;
  /** Central message bus for agent-to-agent communication. */
  messageBus: MessageBus;
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
    terrain: createTerrainMap(),
    wasMovingLastTick: new Set(),
    chargeApplied: new Set(),
    stalemateTracker: createStalemateTracker(),
    messageBus: createMessageBus(),
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

  // 2. Process flowchart events for each agent (skip routing units)
  for (const [agentId, runtime] of runtimes) {
    const agent = battle.agents.get(agentId);
    if (!agent || !agent.alive) continue;
    if (agent.currentAction === 'routing') continue; // routing overrides flowchart

    // Queue tick event
    queueEvent(runtime, { type: 'tick', tick: battle.tick });

    // Process all queued events
    const actions = processEvents(runtime);

    // Execute actions
    for (const action of actions) {
      executeAction(state, agentId, action);
    }
  }

  // 3. Maintain formations — continuously update non-engaged troops to track their
  //    lieutenant's current position so formations move as a unit.
  maintainFormations(state);

  // 4. Move agents toward their targets (with terrain speed modifiers)
  updateMovement(state);

  // 5. Separate overlapping units — prevent units from stacking on same spot.
  separateUnits(state);

  // 6. Resolve combat (with formation, flanking, terrain, and charge modifiers)
  resolveCombat(state);

  // 7. Check morale and trigger routing
  checkMoraleRouting(state);

  // 8. Recover morale for out-of-combat units
  recoverMorale(state);

  // 9. Check win condition (using engine win condition)
  checkWinCondition(state);

  // 10. Track which agents are moving this tick (for charge bonus next tick)
  trackMovingAgents(state);

  // 11. Stalemate detection and escalation
  updateStalemate(state);

  // 12. Callback
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

/** Get the team-based facing direction (toward the enemy). */
function getTeamFacing(team: Team): Vec2 {
  return team === 'player' ? PLAYER_FACING : ENEMY_FACING;
}

/** Clamp a position to within map bounds. */
function clampToMap(pos: Vec2, battle: BattleState): Vec2 {
  return clampVec(pos, BOUNDARY_MARGIN, BOUNDARY_MARGIN, battle.width - BOUNDARY_MARGIN, battle.height - BOUNDARY_MARGIN);
}

/** Execute an action for an agent. */
function executeAction(state: SimulationState, agentId: string, action: GameAction): void {
  const agent = state.battle.agents.get(agentId);
  if (!agent || !agent.alive) return;

  switch (action.type) {
    case 'moveTo':
      // Clamp destination to map bounds so agents can't be ordered off the map
      agent.targetPosition = clampToMap(action.position, state.battle);
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
      // Clamp fallback destination to map bounds
      agent.targetPosition = clampToMap(action.position, state.battle);
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
        // Troop received setFormation — reposition to slot around lieutenant
        const lt = state.battle.agents.get(agent.lieutenantId);
        if (lt?.alive) {
          repositionInFormation(state, agent, action.formation, lt.position, lt.team);
        }
      } else if (isLieutenant(agent)) {
        // Lieutenant received setFormation — propagate to ALL troops under command
        const ltAgent = agent as LieutenantAgent;
        for (const troopId of ltAgent.troopIds) {
          const troop = state.battle.agents.get(troopId);
          if (troop?.alive && isTroop(troop)) {
            troop.formation = action.formation;
            repositionInFormation(state, troop, action.formation, agent.position, agent.team);
          }
        }
      }
      break;

    case 'requestSupport':
      state.callbacks.onTroopMessage?.(agentId, 'requestSupport', action.message);
      // Route to lieutenant via message bus
      if (isTroop(agent) && agent.lieutenantId) {
        busSend(state.messageBus, {
          from: agentId,
          to: agent.lieutenantId,
          type: 'support_request',
          payload: { message: action.message },
          priority: 7,
          tick: state.battle.tick,
        });
      }
      break;

    case 'emit':
      state.callbacks.onTroopMessage?.(agentId, action.eventType, action.message);
      // Route reports/alerts to lieutenant via message bus
      if (isTroop(agent) && agent.lieutenantId) {
        busSend(state.messageBus, {
          from: agentId,
          to: agent.lieutenantId,
          type: action.eventType === 'report' ? 'troop_report' : 'troop_alert',
          payload: { message: action.message },
          priority: action.eventType === 'alert' ? 8 : 3,
          tick: state.battle.tick,
        });
      }
      break;
  }
}

// ─── Formation Repositioning ────────────────────────────────────────────────

/**
 * Set a troop's target position to its slot in a formation around the lieutenant.
 * Uses engine's computeFormationSlot with team-appropriate facing direction.
 */
function repositionInFormation(
  state: SimulationState,
  agent: AgentState,
  formation: FormationType,
  ltPos: Vec2,
  team: Team
): void {
  const teammates = Array.from(state.battle.agents.values())
    .filter(a => isTroop(a) && a.lieutenantId === agent.lieutenantId && a.alive)
    .sort((a, b) => a.id.localeCompare(b.id));

  const index = teammates.findIndex(a => a.id === agent.id);
  if (index === -1) return;

  const facing = getTeamFacing(team);
  const rawPos = computeFormationSlot(formation, ltPos, index, teammates.length, FORMATION_SPACING, facing);
  const pos = clampToMap(rawPos, state.battle);
  agent.targetPosition = pos;
  agent.currentAction = 'moving';
  agent.targetId = null;
}

// ─── Formation Maintenance ───────────────────────────────────────────────────

/**
 * Keep non-engaged troops moving to their formation slots around their lieutenant.
 *
 * Runs every tick. For each troop that is NOT actively engaging an enemy or
 * falling back, update their target position to their current formation slot
 * relative to the lieutenant's live position. This makes formations move as a
 * unit when the lieutenant advances, and causes troops to re-form naturally
 * after combat ends.
 *
 * Skips troops that are:
 * - Engaging (chasing an enemy target)
 * - Falling back
 * - Already within 1 unit of their formation slot (no-op)
 */
function maintainFormations(state: SimulationState): void {
  const { battle } = state;

  for (const agent of battle.agents.values()) {
    if (!agent.alive || !isTroop(agent)) continue;

    // Don't override active engagement, fallback, or routing
    if (agent.currentAction === 'engaging') continue;
    if (agent.currentAction === 'falling_back') continue;
    if (agent.currentAction === 'routing') continue;
    if (agent.targetId) continue;  // actively pursuing an enemy

    const lt = battle.agents.get(agent.lieutenantId);
    if (!lt?.alive) continue;

    // Get all alive troops under this lieutenant, sorted for stable slot assignment
    const teammates = Array.from(battle.agents.values())
      .filter(a => isTroop(a) && a.lieutenantId === agent.lieutenantId && a.alive)
      .sort((a, b) => a.id.localeCompare(b.id));

    const index = teammates.findIndex(a => a.id === agent.id);
    if (index === -1) continue;

    const facing = getTeamFacing(lt.team);
    const rawPos = computeFormationSlot(agent.formation, lt.position, index, teammates.length, FORMATION_SPACING, facing);
    const formationPos = clampToMap(rawPos, battle);

    // Only update target if it differs significantly from the current target
    const currentTarget = agent.targetPosition;
    if (!currentTarget || vecDistance(currentTarget, formationPos) > 1.5) {
      agent.targetPosition = formationPos;
      if (vecDistance(agent.position, formationPos) > 2) {
        agent.currentAction = 'moving';
      }
    }
  }
}

// ─── Unit Separation ────────────────────────────────────────────────────────

/**
 * Push apart units that are overlapping or too close to each other.
 *
 * Runs every tick after movement. Prevents units from stacking on the same
 * position. Uses a simple repulsion force proportional to overlap depth.
 * Only applies to alive units. O(n²) — acceptable for ≤100 units.
 */
function separateUnits(state: SimulationState): void {
  const { battle } = state;
  const agents = Array.from(battle.agents.values()).filter(a => a.alive);

  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i]!;
      const b = agents[j]!;

      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < UNIT_MIN_SEPARATION * UNIT_MIN_SEPARATION) {
        if (distSq > 0.001) {
          const dist = Math.sqrt(distSq);
          const overlap = (UNIT_MIN_SEPARATION - dist) / 2;
          const pushX = (dx / dist) * overlap * UNIT_PUSH_FORCE;
          const pushY = (dy / dist) * overlap * UNIT_PUSH_FORCE;

          a.position = clampToMap({ x: a.position.x - pushX, y: a.position.y - pushY }, battle);
          b.position = clampToMap({ x: b.position.x + pushX, y: b.position.y + pushY }, battle);
        } else {
          // Identical positions — push one unit slightly in each axis
          a.position = clampToMap({ x: a.position.x - UNIT_PUSH_FORCE, y: a.position.y }, battle);
          b.position = clampToMap({ x: b.position.x + UNIT_PUSH_FORCE, y: b.position.y }, battle);
        }
      }
    }
  }
}

// ─── Movement ───────────────────────────────────────────────────────────────

// ─── Charge Tracking ─────────────────────────────────────────────────────────

/** Record which agents are currently moving (for charge bonus on first combat).
 *  Only tracks 'moving' units — units already 'engaging' are in combat, not charging. */
function trackMovingAgents(state: SimulationState): void {
  state.wasMovingLastTick.clear();
  for (const agent of state.battle.agents.values()) {
    if (!agent.alive) continue;
    if (agent.currentAction === 'moving') {
      if (agent.targetPosition || agent.targetId) {
        state.wasMovingLastTick.add(agent.id);
      }
    }
  }
}

/**
 * Update agent positions based on their targets.
 * Uses engine's moveToward and getSpeed for reliable movement math.
 * Applies terrain speed modifiers when units are in terrain features.
 * All positions are clamped to map bounds after every move.
 */
function updateMovement(state: SimulationState): void {
  for (const agent of state.battle.agents.values()) {
    if (!agent.alive) continue;

    let speed = getSpeed(agent);

    // Apply terrain speed modifier
    const terrainMods = getTerrainModifiers(agent.position, state.terrain);
    speed *= terrainMods.speedMultiplier;

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
          // Snap to target and clamp to map bounds
          agent.position = clampToMap(vecClone(targetPos), state.battle);
          agent.targetPosition = null;
          if (agent.currentAction !== 'routing') {
            agent.currentAction = 'holding';
          }

          const runtime = state.runtimes.get(agent.id);
          if (runtime) {
            queueEvent(runtime, { type: 'arrived', position: agent.position });
          }
        }
      } else {
        // Move toward target and clamp to map bounds
        agent.position = clampToMap(moveToward(agent.position, targetPos, speed), state.battle);
      }
    }
  }
}

// ─── Combat ─────────────────────────────────────────────────────────────────

/**
 * Resolve combat between agents in range.
 *
 * Enhanced with:
 * - Formation combat modifiers (wedge = more attack, circle = more defense, etc.)
 * - Flanking detection (side/rear attacks deal bonus damage)
 * - Terrain modifiers (hills = less damage taken, rivers = more)
 * - Charge momentum (moving units deal bonus first-hit damage)
 */
function resolveCombat(state: SimulationState): void {
  const agents = Array.from(state.battle.agents.values());
  const combatPairs = findCombatPairs(agents);

  // Track which agents are in combat this tick (for morale recovery check)
  const inCombatThisTick = new Set<string>();

  for (const [a, b] of combatPairs) {
    inCombatThisTick.add(a.id);
    inCombatThisTick.add(b.id);

    // Emit engagement event for new combat pairs
    const pairKey = [a.id, b.id].sort().join(':');
    const isNewEngagement = !state.activeEngagements.has(pairKey);
    if (isNewEngagement) {
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

    // Calculate base damage for both sides
    const resultA = engineCalculateDamage(a, b);
    const resultB = engineCalculateDamage(b, a);

    // Apply formation modifiers
    const aFormMods = getFormationModifiers(a.formation);
    const bFormMods = getFormationModifiers(b.formation);

    // A attacks B: A's attack modifier * B's defense modifier
    resultA.damage = Math.max(1, Math.round(resultA.damage * aFormMods.attackMultiplier / bFormMods.defenseMultiplier));
    // B attacks A: B's attack modifier * A's defense modifier
    resultB.damage = Math.max(1, Math.round(resultB.damage * bFormMods.attackMultiplier / aFormMods.defenseMultiplier));

    // Apply flanking modifiers
    const aFacing = getTeamFacing(a.team);
    const bFacing = getTeamFacing(b.team);

    // B is attacking A — check if B is flanking A
    const flankOnA = calculateFlankingMultiplier(b.position, a.position, aFacing);
    resultB.damage = Math.max(1, Math.round(resultB.damage * flankOnA.multiplier));

    // A is attacking B — check if A is flanking B
    const flankOnB = calculateFlankingMultiplier(a.position, b.position, bFacing);
    resultA.damage = Math.max(1, Math.round(resultA.damage * flankOnB.multiplier));

    // Fire flanked events for side/rear attacks
    if (flankOnA.direction !== 'front') {
      const runtimeA = state.runtimes.get(a.id);
      if (runtimeA) {
        const flankedDir = flankOnA.direction === 'rear' ? 'rear' : (
          // Determine left/right from cross product
          b.position.y > a.position.y ? 'right' : 'left'
        );
        const flankedEvent: FlankedEvent = { type: 'flanked', direction: flankedDir as 'left' | 'right' | 'rear' };
        queueEvent(runtimeA, flankedEvent);
      }
    }
    if (flankOnB.direction !== 'front') {
      const runtimeB = state.runtimes.get(b.id);
      if (runtimeB) {
        const flankedDir = flankOnB.direction === 'rear' ? 'rear' : (
          a.position.y > b.position.y ? 'right' : 'left'
        );
        const flankedEvent: FlankedEvent = { type: 'flanked', direction: flankedDir as 'left' | 'right' | 'rear' };
        queueEvent(runtimeB, flankedEvent);
      }
    }

    // Apply terrain defense modifiers
    const aTerrainMods = getTerrainModifiers(a.position, state.terrain);
    const bTerrainMods = getTerrainModifiers(b.position, state.terrain);

    // Defender's terrain modifies incoming damage
    resultA.damage = Math.max(1, Math.round(resultA.damage * bTerrainMods.defenseMultiplier));
    resultB.damage = Math.max(1, Math.round(resultB.damage * aTerrainMods.defenseMultiplier));

    // Apply charge momentum (first hit only)
    if (isNewEngagement) {
      const aWasMoving = state.wasMovingLastTick.has(a.id) && !state.chargeApplied.has(a.id);
      const bWasMoving = state.wasMovingLastTick.has(b.id) && !state.chargeApplied.has(b.id);

      if (aWasMoving) {
        const aSpeed = getSpeed(a);
        const chargeBonus = calculateChargeBonusDamage(resultA.damage, true, aSpeed);
        resultA.damage += chargeBonus;
        state.chargeApplied.add(a.id);
      }
      if (bWasMoving) {
        const bSpeed = getSpeed(b);
        const chargeBonus = calculateChargeBonusDamage(resultB.damage, true, bSpeed);
        resultB.damage += chargeBonus;
        state.chargeApplied.add(b.id);
      }
    }

    applySimDamage(state, b, resultA);
    applySimDamage(state, a, resultB);

    // Combat occurred — reset stalemate tracker
    recordCombat(state.stalemateTracker);
  }

  // Store in-combat set on state for morale recovery check
  (state as any)._inCombatThisTick = inCombatThisTick;

  // Clean up engagement tracking for pairs no longer in combat
  for (const key of state.activeEngagements) {
    const [idA, idB] = key.split(':');
    const agentA = state.battle.agents.get(idA!);
    const agentB = state.battle.agents.get(idB!);
    if (!agentA?.alive || !agentB?.alive ||
        !isWithinRange(agentA.position, agentB.position, COMBAT_RANGE * 1.5)) {
      state.activeEngagements.delete(key);
      // Clear charge tracking when combat ends
      state.chargeApplied.delete(idA!);
      state.chargeApplied.delete(idB!);
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

// ─── Morale Routing ──────────────────────────────────────────────────────────

/** Check morale for all troops and trigger routing if needed. */
function checkMoraleRouting(state: SimulationState): void {
  for (const agent of state.battle.agents.values()) {
    if (!agent.alive || !isTroop(agent)) continue;
    if (agent.currentAction === 'routing') continue; // already routing

    const courage = agent.stats.courage;
    if (shouldRout(agent.morale, courage)) {
      // Unit routs — override flowchart, flee toward spawn
      agent.currentAction = 'routing';
      agent.targetId = null;

      // Flee toward spawn side (player → west, enemy → east)
      const fleeX = agent.team === 'player' ? BOUNDARY_MARGIN : state.battle.width - BOUNDARY_MARGIN;
      agent.targetPosition = clampToMap({ x: fleeX, y: agent.position.y }, state.battle);

      // Emit retreat battle event
      const teamLabel = agent.team === 'player' ? 'Your' : 'Enemy';
      state.pendingBattleEvents.push({
        type: 'retreat',
        tick: state.battle.tick,
        team: agent.team,
        message: `${teamLabel} troop is routing at (${Math.round(agent.position.x)}, ${Math.round(agent.position.y)})!`,
        position: vecClone(agent.position),
      });

      // Spread panic to nearby allies
      applyRoutingPanic(agent, state.battle.agents.values());
    }
  }
}

/** Recover morale for units not in combat. */
function recoverMorale(state: SimulationState): void {
  const inCombat: Set<string> = (state as any)._inCombatThisTick || new Set();

  for (const agent of state.battle.agents.values()) {
    if (!agent.alive) continue;

    const isInCombat = inCombat.has(agent.id);
    checkMoraleRecovery(agent, isInCombat);

    // If routing unit's morale recovers above rout threshold, stop routing
    if (agent.currentAction === 'routing' && agent.morale >= 50) {
      agent.currentAction = 'holding';
      agent.targetPosition = null;
    }
  }
}

// ─── Stalemate Detection ────────────────────────────────────────────────────

/**
 * Increment the stalemate counter and handle escalation transitions.
 *
 * - Warning: emits a battle event that the server can relay to lieutenants
 * - Force advance: sets all alive troops' targets to the map center
 */
function updateStalemate(state: SimulationState): void {
  state.stalemateTracker.ticksSinceLastCombat++;

  const status = checkStalemate(state.stalemateTracker);

  if (status === 'warning') {
    state.pendingBattleEvents.push({
      type: 'stalemate_warning',
      tick: state.battle.tick,
      team: 'player',
      message: 'The battle has stalled — forces are not engaging!',
    });

    // Broadcast stalemate warning to all lieutenants via message bus
    busSend(state.messageBus, {
      from: 'simulation',
      to: null,  // broadcast
      type: 'stalemate_warning',
      payload: { message: 'Battle has stalled — forces are not engaging' },
      priority: 9,
      tick: state.battle.tick,
    });
  }

  if (status === 'force_advance') {
    state.pendingBattleEvents.push({
      type: 'stalemate_force_advance',
      tick: state.battle.tick,
      team: 'player',
      message: 'Both armies are forced to advance!',
    });

    const centerX = state.battle.width / 2;
    const centerY = state.battle.height / 2;

    for (const agent of state.battle.agents.values()) {
      if (!agent.alive || agent.currentAction === 'routing') continue;
      if (agent.type !== 'troop') continue;

      agent.targetPosition = clampToMap({ x: centerX, y: centerY }, state.battle);
      agent.currentAction = 'moving';
      agent.targetId = null;
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

// ─── Initial Formation Setup ────────────────────────────────────────────────

/**
 * Apply formation positions to all troops before the battle starts.
 *
 * This ensures troops begin the battle already arranged in their formation
 * slots around their lieutenant, rather than in a flat line.
 * Call this after all briefings are applied and before starting the sim loop.
 */
export function applyInitialFormations(state: SimulationState): void {
  const { battle } = state;

  // Build a map of lieutenant → sorted troop list for stable slot assignment
  const ltTroops = new Map<string, AgentState[]>();
  for (const agent of battle.agents.values()) {
    if (!agent.alive || !isTroop(agent)) continue;
    const list = ltTroops.get(agent.lieutenantId) ?? [];
    list.push(agent);
    ltTroops.set(agent.lieutenantId, list);
  }

  for (const [ltId, troops] of ltTroops) {
    const lt = battle.agents.get(ltId);
    if (!lt?.alive) continue;

    troops.sort((a, b) => a.id.localeCompare(b.id));
    const facing = getTeamFacing(lt.team);

    for (let i = 0; i < troops.length; i++) {
      const troop = troops[i]!;
      const rawPos = computeFormationSlot(troop.formation, lt.position, i, troops.length, FORMATION_SPACING, facing);
      // Teleport troops to formation positions at start (no lerp needed)
      troop.position = clampToMap(rawPos, battle);
      troop.targetPosition = null;
      troop.currentAction = 'holding';
    }
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

/** Serialized terrain feature for the client. */
export interface ClientTerrainFeature {
  id: string;
  type: string;
  position: Vec2;
  size: Vec2;
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
  terrain: ClientTerrainFeature[];
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
    terrain: state.terrain.features.map(f => ({
      id: f.id,
      type: f.type,
      position: { x: f.position.x, y: f.position.y },
      size: { x: f.size.x, y: f.size.y },
    })),
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
