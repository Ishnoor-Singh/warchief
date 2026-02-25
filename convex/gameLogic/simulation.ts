// Core simulation logic for Warchief (Convex-compatible, uses Records not Maps)

import {
  Vec2,
  BattleState,
  AgentState,
  TroopStats,
  Team,
  CombatResult,
  VisibleEnemy,
} from './types';
import {
  GameEvent,
  GameAction,
  EnemySpottedEvent,
  UnderAttackEvent,
  AllyDownEvent,
  CasualtyThresholdEvent,
} from './events';
import {
  FlowchartRuntime,
  Flowchart,
  createFlowchartRuntime,
  queueEvent,
  processEvents,
} from './flowchart';

const COMBAT_RANGE = 25;
const BASE_DAMAGE = 10;
const VISIBILITY_EVENT_INTERVAL = 10;

// Battle events for the client-side ticker
export interface BattleEvent {
  type: 'kill' | 'engagement' | 'retreat' | 'squad_wiped' | 'casualty_milestone';
  tick: number;
  team: Team;
  message: string;
  position?: Vec2;
}

// Messages generated during tick (for troop emit/requestSupport actions)
export interface TroopMessage {
  agentId: string;
  messageType: 'requestSupport' | 'report' | 'alert';
  message: string;
}

export interface SimulationState {
  battle: BattleState;
  runtimes: Record<string, FlowchartRuntime>;
  squadCasualties: Record<string, { total: number; dead: number }>;
  activeEngagements: string[];
}

// Result of a single simulation tick
export interface TickResult {
  state: SimulationState;
  battleEvents: BattleEvent[];
  troopMessages: TroopMessage[];
}

// Initialize simulation state from agents and flowcharts
export function createSimulationState(
  width: number,
  height: number,
  agents: AgentState[],
  flowcharts: Flowchart[]
): SimulationState {
  const agentMap: Record<string, AgentState> = {};
  for (const a of agents) {
    agentMap[a.id] = a;
  }

  const runtimes: Record<string, FlowchartRuntime> = {};
  for (const flowchart of flowcharts) {
    runtimes[flowchart.agentId] = createFlowchartRuntime(flowchart);
  }

  const squadCasualties: Record<string, { total: number; dead: number }> = {};
  for (const agent of agents) {
    if (agent.type === 'troop' && agent.squadId) {
      const key = `${agent.team}:${agent.squadId}`;
      if (!squadCasualties[key]) {
        squadCasualties[key] = { total: 0, dead: 0 };
      }
      squadCasualties[key]!.total++;
    }
  }

  return {
    battle: {
      tick: 0,
      agents: agentMap,
      width,
      height,
      running: false,
      winner: null,
    },
    runtimes,
    squadCasualties,
    activeEngagements: [],
  };
}

// Calculate distance between two points
export function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Main simulation tick - pure function, returns new state + events
export function simulationTick(state: SimulationState): TickResult {
  const { battle, runtimes } = state;
  const battleEvents: BattleEvent[] = [];
  const troopMessages: TroopMessage[] = [];

  if (!battle.running) return { state, battleEvents, troopMessages };

  battle.tick++;

  // 1. Update visibility and queue enemy_spotted events
  updateVisibility(state);

  // 2. Process flowchart events for each agent
  for (const agentId of Object.keys(runtimes)) {
    const agent = battle.agents[agentId];
    const runtime = runtimes[agentId];
    if (!agent || !agent.alive || !runtime) continue;

    queueEvent(runtime, { type: 'tick', tick: battle.tick });
    const actions = processEvents(runtime);

    for (const action of actions) {
      executeAction(state, agentId, action, troopMessages);
    }
  }

  // 3. Move agents toward their targets
  updateMovement(state);

  // 4. Resolve combat
  resolveCombat(state, battleEvents, troopMessages);

  // 5. Check win condition
  checkWinCondition(state);

  return { state, battleEvents, troopMessages };
}

function getVisibleEnemies(state: SimulationState, agent: AgentState): VisibleEnemy[] {
  const visible: VisibleEnemy[] = [];

  for (const other of Object.values(state.battle.agents)) {
    if (other.team === agent.team) continue;
    if (!other.alive) continue;

    const dist = distance(agent.position, other.position);
    if (dist <= agent.visibilityRadius) {
      visible.push({
        enemyId: other.id,
        position: { ...other.position },
        distance: dist,
      });
    }
  }

  return visible;
}

function updateVisibility(state: SimulationState): void {
  const shouldFireVisibility = state.battle.tick % VISIBILITY_EVENT_INTERVAL === 0;
  if (!shouldFireVisibility) return;

  for (const agent of Object.values(state.battle.agents)) {
    if (!agent.alive) continue;

    const runtime = state.runtimes[agent.id];
    if (!runtime) continue;

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

function executeAction(
  state: SimulationState,
  agentId: string,
  action: GameAction,
  troopMessages: TroopMessage[]
): void {
  const agent = state.battle.agents[agentId];
  if (!agent || !agent.alive) return;

  switch (action.type) {
    case 'moveTo':
      agent.targetPosition = action.position;
      agent.currentAction = 'moving';
      agent.targetId = null;
      break;

    case 'engage':
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
      break;

    case 'requestSupport':
      troopMessages.push({ agentId, messageType: 'requestSupport', message: action.message });
      break;

    case 'emit':
      troopMessages.push({ agentId, messageType: action.eventType, message: action.message });
      break;
  }
}

function updateMovement(state: SimulationState): void {
  for (const agent of Object.values(state.battle.agents)) {
    if (!agent.alive) continue;

    const stats = agent.stats as TroopStats;
    const speed = stats.speed || 2;

    let targetPos: Vec2 | null = null;

    if (agent.targetId) {
      const target = state.battle.agents[agent.targetId];
      if (target && target.alive) {
        targetPos = target.position;
      } else {
        agent.targetId = null;
      }
    } else if (agent.targetPosition) {
      targetPos = agent.targetPosition;
    }

    if (targetPos) {
      const dist = distance(agent.position, targetPos);

      if (dist <= speed) {
        if (!agent.targetId) {
          agent.position = { ...targetPos };
          agent.targetPosition = null;
          agent.currentAction = 'holding';

          const runtime = state.runtimes[agent.id];
          if (runtime) {
            queueEvent(runtime, { type: 'arrived', position: targetPos });
          }
        }
      } else {
        const dx = targetPos.x - agent.position.x;
        const dy = targetPos.y - agent.position.y;
        const ratio = speed / dist;

        agent.position.x += dx * ratio;
        agent.position.y += dy * ratio;
      }
    }
  }
}

function resolveCombat(
  state: SimulationState,
  battleEvents: BattleEvent[],
  troopMessages: TroopMessage[]
): void {
  const combatPairs: Array<[AgentState, AgentState]> = [];
  const agents = Object.values(state.battle.agents).filter(a => a.alive);

  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i]!;
      const b = agents[j]!;

      if (a.team === b.team) continue;

      const dist = distance(a.position, b.position);
      if (dist <= COMBAT_RANGE) {
        combatPairs.push([a, b]);
      }
    }
  }

  const engagementsSet = new Set(state.activeEngagements);

  for (const [a, b] of combatPairs) {
    const pairKey = [a.id, b.id].sort().join(':');
    if (!engagementsSet.has(pairKey)) {
      engagementsSet.add(pairKey);
      const aTeamLabel = a.team === 'player' ? 'Your' : 'Enemy';
      battleEvents.push({
        type: 'engagement',
        tick: state.battle.tick,
        team: a.team,
        message: `${aTeamLabel} forces clashing with the enemy at (${Math.round(a.position.x)}, ${Math.round(a.position.y)})`,
        position: { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 },
      });
    }

    const resultA = calculateDamage(a, b);
    const resultB = calculateDamage(b, a);

    applyDamage(state, b, resultA, battleEvents, troopMessages);
    applyDamage(state, a, resultB, battleEvents, troopMessages);
  }

  // Clean up engagement tracking
  for (const key of engagementsSet) {
    const [idA, idB] = key.split(':');
    const agentA = state.battle.agents[idA!];
    const agentB = state.battle.agents[idB!];
    if (!agentA?.alive || !agentB?.alive || distance(agentA.position, agentB.position) > COMBAT_RANGE * 1.5) {
      engagementsSet.delete(key);
    }
  }

  state.activeEngagements = Array.from(engagementsSet);
}

function calculateDamage(attacker: AgentState, defender: AgentState): CombatResult {
  const attackerStats = attacker.stats as TroopStats;
  const defenderStats = defender.stats as TroopStats;

  const attackPower = attackerStats.combat || 5;
  const defensePower = defenderStats.combat || 5;

  const baseDamage = BASE_DAMAGE * (attackPower / defensePower);
  const variance = 0.2;
  const damage = Math.round(baseDamage * (1 + (Math.random() - 0.5) * variance));

  return {
    attackerId: attacker.id,
    defenderId: defender.id,
    damage: Math.max(1, damage),
    defenderDied: false,
  };
}

function applyDamage(
  state: SimulationState,
  agent: AgentState,
  result: CombatResult,
  battleEvents: BattleEvent[],
  _troopMessages: TroopMessage[]
): void {
  agent.health -= result.damage;

  const runtime = state.runtimes[agent.id];
  if (runtime) {
    const event: UnderAttackEvent = {
      type: 'under_attack',
      attackerId: result.attackerId,
      damage: result.damage,
    };
    queueEvent(runtime, event);
  }

  if (agent.health <= 0) {
    agent.health = 0;
    agent.alive = false;
    result.defenderDied = true;

    const victimTeam = agent.team;
    const teamLabel = victimTeam === 'player' ? 'Your' : 'Enemy';
    battleEvents.push({
      type: 'kill',
      tick: state.battle.tick,
      team: victimTeam,
      message: `${teamLabel} ${agent.type} fell at (${Math.round(agent.position.x)}, ${Math.round(agent.position.y)})`,
      position: { ...agent.position },
    });

    for (const other of Object.values(state.battle.agents)) {
      if (other.team !== agent.team) continue;
      if (!other.alive) continue;

      const dist = distance(agent.position, other.position);
      if (dist < 50) {
        other.morale = Math.max(0, other.morale - 5);

        const otherRuntime = state.runtimes[other.id];
        if (otherRuntime) {
          const allyDownEvent: AllyDownEvent = {
            type: 'ally_down',
            unitId: agent.id,
            position: { ...agent.position },
          };
          queueEvent(otherRuntime, allyDownEvent);
        }
      }
    }

    if (agent.squadId) {
      const key = `${agent.team}:${agent.squadId}`;
      const squad = state.squadCasualties[key];
      if (squad) {
        squad.dead++;
        const lossPercent = Math.round((squad.dead / squad.total) * 100);

        if (lossPercent >= 25) {
          for (const other of Object.values(state.battle.agents)) {
            if (other.team !== agent.team || !other.alive) continue;
            if (other.squadId !== agent.squadId) continue;

            const otherRuntime = state.runtimes[other.id];
            if (otherRuntime) {
              const casualtyEvent: CasualtyThresholdEvent = {
                type: 'casualty_threshold',
                lossPercent,
              };
              queueEvent(otherRuntime, casualtyEvent);
            }
          }

          if (lossPercent === 25 || lossPercent === 50 || lossPercent === 75) {
            const tLabel = agent.team === 'player' ? 'Your' : 'Enemy';
            battleEvents.push({
              type: 'casualty_milestone',
              tick: state.battle.tick,
              team: agent.team,
              message: `${tLabel} ${agent.squadId} has taken ${lossPercent}% casualties`,
            });
          }

          if (squad.dead >= squad.total) {
            const tLabel = agent.team === 'player' ? 'Your' : 'Enemy';
            battleEvents.push({
              type: 'squad_wiped',
              tick: state.battle.tick,
              team: agent.team,
              message: `${tLabel} ${agent.squadId} has been wiped out!`,
            });
          }
        }
      }
    }
  }
}

function checkWinCondition(state: SimulationState): void {
  let playerAlive = 0;
  let playerTotal = 0;
  let enemyAlive = 0;
  let enemyTotal = 0;

  for (const agent of Object.values(state.battle.agents)) {
    if (agent.type !== 'troop') continue;

    if (agent.team === 'player') {
      playerTotal++;
      if (agent.alive) playerAlive++;
    } else {
      enemyTotal++;
      if (agent.alive) enemyAlive++;
    }
  }

  if (enemyTotal > 0 && enemyAlive / enemyTotal < 0.2) {
    state.battle.running = false;
    state.battle.winner = 'player';
  } else if (playerTotal > 0 && playerAlive / playerTotal < 0.2) {
    state.battle.running = false;
    state.battle.winner = 'enemy';
  }
}

// Visibility zone for fog-of-war rendering
export interface VisibilityZone {
  position: Vec2;
  radius: number;
}

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

export function getFilteredStateForTeam(state: SimulationState, team: Team): FilteredBattleState {
  const friendlyAgents: AgentState[] = [];
  const visibilityZones: VisibilityZone[] = [];

  for (const agent of Object.values(state.battle.agents)) {
    if (agent.team === team && agent.alive) {
      friendlyAgents.push(agent);
      visibilityZones.push({
        position: { ...agent.position },
        radius: agent.visibilityRadius,
      });
    }
  }

  const visibleEnemies: AgentState[] = [];
  for (const agent of Object.values(state.battle.agents)) {
    if (agent.team === team || !agent.alive) continue;

    for (const friendly of friendlyAgents) {
      const dist = distance(agent.position, friendly.position);
      if (dist <= friendly.visibilityRadius) {
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
      position: { ...a.position },
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

export function getFullStateForObserver(state: SimulationState) {
  const agents = Object.values(state.battle.agents).map(a => ({
    id: a.id,
    type: a.type,
    team: a.team,
    position: { x: a.position.x, y: a.position.y },
    health: a.health,
    maxHealth: a.maxHealth,
    morale: a.morale,
    currentAction: a.currentAction,
    formation: a.formation,
    alive: a.alive,
    lieutenantId: a.lieutenantId,
  }));

  return {
    tick: state.battle.tick,
    agents,
    width: state.battle.width,
    height: state.battle.height,
    running: state.battle.running,
    winner: state.battle.winner,
  };
}

export function getDetailedBattleSummary(state: SimulationState) {
  let playerAlive = 0;
  let playerDead = 0;
  let enemyAlive = 0;
  let enemyDead = 0;

  for (const agent of Object.values(state.battle.agents)) {
    if (agent.type !== 'troop') continue;

    if (agent.team === 'player') {
      if (agent.alive) playerAlive++;
      else playerDead++;
    } else {
      if (agent.alive) enemyAlive++;
      else enemyDead++;
    }
  }

  return {
    tick: state.battle.tick,
    durationSeconds: state.battle.tick / 10,
    winner: state.battle.winner,
    player: { alive: playerAlive, dead: playerDead, total: playerAlive + playerDead },
    enemy: { alive: enemyAlive, dead: enemyDead, total: enemyAlive + enemyDead },
  };
}
