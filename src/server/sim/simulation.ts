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
  TroopStats
} from '../../shared/types';
import { 
  GameEvent, 
  GameAction,
  EnemySpottedEvent,
  UnderAttackEvent 
} from '../../shared/events';
import { 
  FlowchartRuntime, 
  Flowchart, 
  createFlowchartRuntime, 
  queueEvent, 
  processEvents 
} from '../runtime/flowchart';

const TICK_RATE = 10;  // ticks per second
const TICK_MS = 1000 / TICK_RATE;
const COMBAT_RANGE = 25;  // units must be this close to fight
const BASE_DAMAGE = 10;   // base damage per combat tick

export interface SimulationState {
  battle: BattleState;
  runtimes: Map<string, FlowchartRuntime>;  // flowchart runtime per agent
  lastCombat: Map<string, number>;  // track combat cooldowns
  onTick?: (state: SimulationState) => void;
  onBattleEnd?: (winner: Team) => void;
}

// Initialize simulation with agents and their flowcharts
export function createSimulation(
  width: number,
  height: number,
  agents: AgentState[],
  flowcharts: Flowchart[]
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

// Update visibility and queue spotted events
function updateVisibility(state: SimulationState): void {
  for (const [agentId, agent] of state.battle.agents) {
    if (!agent.alive) continue;
    
    const runtime = state.runtimes.get(agentId);
    if (!runtime) continue;
    
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
      break;
      
    case 'requestSupport':
      // TODO: Route to lieutenant
      console.log(`[${agentId}] requests support: ${action.message}`);
      break;
      
    case 'emit':
      // TODO: Route message up chain
      console.log(`[${agentId}] ${action.eventType}: ${action.message}`);
      break;
  }
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
    // Both sides deal damage
    const resultA = calculateDamage(a, b);
    const resultB = calculateDamage(b, a);
    
    applyDamage(state, b, resultA);
    applyDamage(state, a, resultB);
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
    
    // Reduce morale of nearby allies
    for (const other of state.battle.agents.values()) {
      if (other.team !== agent.team) continue;
      if (!other.alive) continue;
      
      const dist = distance(agent.position, other.position);
      if (dist < 50) {
        other.morale = Math.max(0, other.morale - 5);
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
