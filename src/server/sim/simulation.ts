// Core simulation loop for Warchief
// Runs at 10 ticks/second, processes events, resolves combat

import {
  Vec2,
  BattleState,
  AgentState,
  TroopAgent,
  Team,
  CombatResult,
  VisibleEnemy,
  TroopStats,
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
  processEvents 
} from '../runtime/flowchart.js';

const TICK_RATE = 10;  // ticks per second
const TICK_MS = 1000 / TICK_RATE;
const COMBAT_RANGE = 25;  // units must be this close to fight
const BASE_DAMAGE = 10;   // base damage per combat tick
const VISIBILITY_EVENT_INTERVAL = 10;  // fire enemy_spotted every N ticks (1/sec)

// Callback for actions that need to route messages to the server layer
export interface SimulationCallbacks {
  onTroopMessage?: (agentId: string, type: 'requestSupport' | 'report' | 'alert', message: string) => void;
}

// Battle events for the client-side ticker
export interface BattleEvent {
  type: 'kill' | 'engagement' | 'retreat' | 'squad_wiped' | 'casualty_milestone';
  tick: number;
  team: Team;          // which team this event primarily concerns
  message: string;     // human-readable description
  position?: Vec2;     // where it happened (for map highlighting)
}

export interface SimulationState {
  battle: BattleState;
  runtimes: Map<string, FlowchartRuntime>;  // flowchart runtime per agent
  lastCombat: Map<string, number>;  // track combat cooldowns
  squadCasualties: Map<string, { total: number; dead: number }>;  // per-squad loss tracking
  callbacks: SimulationCallbacks;
  onTick?: (state: SimulationState) => void;
  onBattleEnd?: (winner: Team) => void;
  pendingBattleEvents: BattleEvent[];  // events generated this tick, drained by server
  activeEngagements: Set<string>;  // track which pairs are currently fighting (to avoid duplicate events)
}

// Initialize simulation with agents and their flowcharts
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

  // Build squad casualty tracking
  const squadCasualties = new Map<string, { total: number; dead: number }>();
  for (const agent of agents) {
    if (agent.type === 'troop' && agent.squadId) {
      const key = `${agent.team}:${agent.squadId}`;
      const existing = squadCasualties.get(key) || { total: 0, dead: 0 };
      existing.total++;
      squadCasualties.set(key, existing);
    }
  }

  return {
    battle,
    runtimes,
    lastCombat: new Map(),
    squadCasualties,
    callbacks,
    pendingBattleEvents: [],
    activeEngagements: new Set(),
  };
}

// Main simulation tick
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
  
  // 3. Move agents toward their targets
  updateMovement(state);
  
  // 4. Resolve combat
  resolveCombat(state);
  
  // 5. Check win condition
  checkWinCondition(state);
  
  // 6. Callback
  state.onTick?.(state);
}

// Calculate distance between two points
export function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Get all enemies visible to an agent
function getVisibleEnemies(state: SimulationState, agent: AgentState): VisibleEnemy[] {
  const visible: VisibleEnemy[] = [];
  
  for (const other of state.battle.agents.values()) {
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

// Update visibility and queue spotted events (throttled to reduce event thrashing)
function updateVisibility(state: SimulationState): void {
  const shouldFireVisibility = state.battle.tick % VISIBILITY_EVENT_INTERVAL === 0;

  for (const [_agentId, agent] of state.battle.agents) {
    if (!agent.alive) continue;

    const runtime = state.runtimes.get(agent.id);
    if (!runtime) continue;

    // Only fire visibility events every VISIBILITY_EVENT_INTERVAL ticks
    if (!shouldFireVisibility) continue;

    const visible = getVisibleEnemies(state, agent);

    // Queue enemy_spotted for closest visible enemy
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
      // No enemies visible - trigger advance behavior
      queueEvent(runtime, { type: 'no_enemies_visible' });
    }
  }
}

// Execute an action for an agent
function executeAction(state: SimulationState, agentId: string, action: GameAction): void {
  const agent = state.battle.agents.get(agentId);
  if (!agent || !agent.alive) return;
  
  switch (action.type) {
    case 'moveTo':
      agent.targetPosition = action.position;
      agent.currentAction = 'moving';
      agent.targetId = null;
      break;
      
    case 'engage':
      // Find the target or use closest enemy
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
      // Reposition this troop to its slot in the formation around their lieutenant
      if (agent.type === 'troop' && agent.lieutenantId) {
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

// Compute where a single troop should stand in a formation around a lieutenant
function computeFormationSlot(formation: FormationType, ltPos: Vec2, index: number, total: number): Vec2 {
  const spacing = 15;

  switch (formation) {
    case 'line': {
      // Horizontal line centered on the lieutenant, 30 units in front
      const startX = ltPos.x - ((total - 1) * spacing) / 2;
      return { x: startX + index * spacing, y: ltPos.y + 30 };
    }
    case 'column': {
      // Single file extending forward from the lieutenant
      return { x: ltPos.x, y: ltPos.y + 20 + index * spacing };
    }
    case 'wedge': {
      // V-shape pointing forward: pairs fan out to left/right with each row
      const row = Math.floor(index / 2);
      const side = index % 2 === 0 ? -1 : 1;
      return { x: ltPos.x + side * row * spacing, y: ltPos.y + 20 + row * spacing };
    }
    case 'defensive_circle': {
      // Ring of troops around the lieutenant
      const radius = Math.max(30, (total * spacing) / (2 * Math.PI));
      const angle = (index / total) * 2 * Math.PI;
      return { x: ltPos.x + Math.cos(angle) * radius, y: ltPos.y + Math.sin(angle) * radius };
    }
    case 'scatter': {
      // Loose grid spread around the lieutenant
      const cols = Math.ceil(Math.sqrt(total));
      const row = Math.floor(index / cols);
      const col = index % cols;
      return {
        x: ltPos.x - (cols * spacing) / 2 + col * spacing * 1.5,
        y: ltPos.y - (Math.ceil(total / cols) * spacing) / 2 + row * spacing * 1.5,
      };
    }
    case 'pincer': {
      // Two flanking groups — left half and right half of troops
      const half = Math.ceil(total / 2);
      if (index < half) {
        return { x: ltPos.x - 40, y: ltPos.y + (index - half / 2) * spacing };
      } else {
        const i = index - half;
        return { x: ltPos.x + 40, y: ltPos.y + (i - (total - half) / 2) * spacing };
      }
    }
  }
}

// Set a troop's target position to its slot in a formation around the lieutenant
function repositionInFormation(
  state: SimulationState,
  agent: AgentState,
  formation: FormationType,
  ltPos: Vec2
): void {
  // All alive troops under the same lieutenant, sorted for stable slot assignment
  const teammates = Array.from(state.battle.agents.values())
    .filter(a => a.type === 'troop' && a.lieutenantId === agent.lieutenantId && a.alive)
    .sort((a, b) => a.id.localeCompare(b.id));

  const index = teammates.findIndex(a => a.id === agent.id);
  if (index === -1) return;

  const pos = computeFormationSlot(formation, ltPos, index, teammates.length);
  agent.targetPosition = pos;
  agent.currentAction = 'moving';
  agent.targetId = null;
}

// Update agent positions based on their targets
function updateMovement(state: SimulationState): void {
  for (const agent of state.battle.agents.values()) {
    if (!agent.alive) continue;
    
    const stats = agent.stats as TroopStats;
    const speed = stats.speed || 2;
    
    let targetPos: Vec2 | null = null;
    
    if (agent.targetId) {
      // Moving toward a target enemy
      const target = state.battle.agents.get(agent.targetId);
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
        // Arrived
        if (!agent.targetId) {
          agent.position = { ...targetPos };
          agent.targetPosition = null;
          agent.currentAction = 'holding';
          
          // Queue arrived event
          const runtime = state.runtimes.get(agent.id);
          if (runtime) {
            queueEvent(runtime, { type: 'arrived', position: targetPos });
          }
        }
      } else {
        // Move toward target
        const dx = targetPos.x - agent.position.x;
        const dy = targetPos.y - agent.position.y;
        const ratio = speed / dist;
        
        agent.position.x += dx * ratio;
        agent.position.y += dy * ratio;
      }
    }
  }
}

// Resolve combat between agents in range
function resolveCombat(state: SimulationState): void {
  const combatPairs: Array<[AgentState, AgentState]> = [];
  
  // Find all pairs in combat range
  const agents = Array.from(state.battle.agents.values()).filter(a => a.alive);
  
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];
      
      if (a.team === b.team) continue;
      
      const dist = distance(a.position, b.position);
      if (dist <= COMBAT_RANGE) {
        combatPairs.push([a, b]);
      }
    }
  }
  
  // Resolve each combat
  for (const [a, b] of combatPairs) {
    // Emit engagement event for new combat pairs
    const pairKey = [a.id, b.id].sort().join(':');
    if (!state.activeEngagements.has(pairKey)) {
      state.activeEngagements.add(pairKey);
      // Only emit engagement events occasionally to avoid spam
      const aTeamLabel = a.team === 'player' ? 'Your' : 'Enemy';
      state.pendingBattleEvents.push({
        type: 'engagement',
        tick: state.battle.tick,
        team: a.team,
        message: `${aTeamLabel} forces clashing with the enemy at (${Math.round(a.position.x)}, ${Math.round(a.position.y)})`,
        position: { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 },
      });
    }

    // Both sides deal damage
    const resultA = calculateDamage(a, b);
    const resultB = calculateDamage(b, a);

    applyDamage(state, b, resultA);
    applyDamage(state, a, resultB);
  }

  // Clean up engagement tracking for pairs no longer in combat
  for (const key of state.activeEngagements) {
    const [idA, idB] = key.split(':');
    const agentA = state.battle.agents.get(idA!);
    const agentB = state.battle.agents.get(idB!);
    if (!agentA?.alive || !agentB?.alive || distance(agentA.position, agentB.position) > COMBAT_RANGE * 1.5) {
      state.activeEngagements.delete(key);
    }
  }
}

// Calculate damage from attacker to defender
function calculateDamage(attacker: AgentState, defender: AgentState): CombatResult {
  const attackerStats = attacker.stats as TroopStats;
  const defenderStats = defender.stats as TroopStats;
  
  const attackPower = attackerStats.combat || 5;
  const defensePower = defenderStats.combat || 5;
  
  // Simple damage formula with some randomness
  const baseDamage = BASE_DAMAGE * (attackPower / defensePower);
  const variance = 0.2;
  const damage = Math.round(baseDamage * (1 + (Math.random() - 0.5) * variance));
  
  return {
    attackerId: attacker.id,
    defenderId: defender.id,
    damage: Math.max(1, damage),
    defenderDied: false,  // filled in by applyDamage
  };
}

// Apply damage to an agent
function applyDamage(state: SimulationState, agent: AgentState, result: CombatResult): void {
  agent.health -= result.damage;
  
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
  
  // Check death
  if (agent.health <= 0) {
    agent.health = 0;
    agent.alive = false;
    result.defenderDied = true;

    // Emit kill event
    const victimTeam = agent.team;
    const teamLabel = victimTeam === 'player' ? 'Your' : 'Enemy';
    state.pendingBattleEvents.push({
      type: 'kill',
      tick: state.battle.tick,
      team: victimTeam,
      message: `${teamLabel} ${agent.type} fell at (${Math.round(agent.position.x)}, ${Math.round(agent.position.y)})`,
      position: { ...agent.position },
    });

    // Fire ally_down event and reduce morale for nearby allies
    for (const other of state.battle.agents.values()) {
      if (other.team !== agent.team) continue;
      if (!other.alive) continue;

      const dist = distance(agent.position, other.position);
      if (dist < 50) {
        other.morale = Math.max(0, other.morale - 5);

        // Queue ally_down event
        const otherRuntime = state.runtimes.get(other.id);
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

    // Track squad casualties and fire casualty_threshold
    if (agent.squadId) {
      const key = `${agent.team}:${agent.squadId}`;
      const squad = state.squadCasualties.get(key);
      if (squad) {
        squad.dead++;
        const lossPercent = Math.round((squad.dead / squad.total) * 100);

        // Fire casualty_threshold for all alive agents in same squad
        if (lossPercent >= 25) {
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
          if (squad.dead >= squad.total) {
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
}

// Check if battle is over
function checkWinCondition(state: SimulationState): void {
  let playerAlive = 0;
  let playerTotal = 0;
  let enemyAlive = 0;
  let enemyTotal = 0;
  
  for (const agent of state.battle.agents.values()) {
    if (agent.type !== 'troop') continue;
    
    if (agent.team === 'player') {
      playerTotal++;
      if (agent.alive) playerAlive++;
    } else {
      enemyTotal++;
      if (agent.alive) enemyAlive++;
    }
  }
  
  // Win condition: enemy below 20% strength
  if (enemyTotal > 0 && enemyAlive / enemyTotal < 0.2) {
    state.battle.running = false;
    state.battle.winner = 'player';
    state.onBattleEnd?.('player');
  } else if (playerTotal > 0 && playerAlive / playerTotal < 0.2) {
    state.battle.running = false;
    state.battle.winner = 'enemy';
    state.onBattleEnd?.('enemy');
  }
}

// Start the simulation loop
export function startSimulation(state: SimulationState): NodeJS.Timeout {
  state.battle.running = true;
  
  return setInterval(() => {
    simulationTick(state);
  }, TICK_MS);
}

// Stop the simulation
export function stopSimulation(state: SimulationState, timer: NodeJS.Timeout): void {
  state.battle.running = false;
  clearInterval(timer);
}

// Get battle summary
export function getBattleSummary(state: SimulationState): string {
  let playerAlive = 0;
  let playerDead = 0;
  let enemyAlive = 0;
  let enemyDead = 0;
  
  for (const agent of state.battle.agents.values()) {
    if (agent.type !== 'troop') continue;
    
    if (agent.team === 'player') {
      if (agent.alive) playerAlive++;
      else playerDead++;
    } else {
      if (agent.alive) enemyAlive++;
      else enemyDead++;
    }
  }
  
  return `Tick ${state.battle.tick} | Player: ${playerAlive}/${playerAlive + playerDead} | Enemy: ${enemyAlive}/${enemyAlive + enemyDead}`;
}

// Visibility zone for fog-of-war rendering
export interface VisibilityZone {
  position: Vec2;
  radius: number;
}

// Filtered state for a specific team (fog of war)
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

// Get battle state filtered by team visibility (fog of war)
export function getFilteredStateForTeam(state: SimulationState, team: Team): FilteredBattleState {
  const friendlyAgents: AgentState[] = [];
  const visibilityZones: VisibilityZone[] = [];

  // Collect friendly agents and their visibility zones
  for (const agent of state.battle.agents.values()) {
    if (agent.team === team && agent.alive) {
      friendlyAgents.push(agent);
      visibilityZones.push({
        position: { ...agent.position },
        radius: agent.visibilityRadius,
      });
    }
  }

  // Find enemy agents within any friendly agent's visibility
  const visibleEnemies: AgentState[] = [];
  for (const agent of state.battle.agents.values()) {
    if (agent.team === team || !agent.alive) continue;

    for (const friendly of friendlyAgents) {
      const dist = distance(agent.position, friendly.position);
      if (dist <= friendly.visibilityRadius) {
        visibleEnemies.push(agent);
        break;
      }
    }
  }

  // Combine alive friendly agents + visible enemies
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

// Detailed battle summary for end screen
export interface DetailedBattleSummary {
  tick: number;
  durationSeconds: number;
  winner: Team | null;
  player: { alive: number; dead: number; total: number };
  enemy: { alive: number; dead: number; total: number };
}

export function getDetailedBattleSummary(state: SimulationState): DetailedBattleSummary {
  let playerAlive = 0;
  let playerDead = 0;
  let enemyAlive = 0;
  let enemyDead = 0;

  for (const agent of state.battle.agents.values()) {
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
