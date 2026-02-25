// Test scenario: Two armies with basic engage-on-sight flowcharts

import { AgentState, TroopAgent, Vec2, Team, TroopStats, LieutenantStats } from '../../shared/types/index.js';
import { Flowchart, createEngageOnSightFlowchart, createHoldPositionFlowchart } from '../runtime/flowchart.js';

// Create a troop agent
function createTroop(
  id: string,
  team: Team,
  position: Vec2,
  lieutenantId: string,
  squadId: string,
  stats?: Partial<TroopStats>
): TroopAgent {
  const defaultStats: TroopStats = {
    combat: 5,
    speed: 2,
    courage: 5,
    discipline: 5,
  };

  return {
    id,
    type: 'troop',
    team,
    position: { ...position },
    health: 100,
    maxHealth: 100,
    morale: 100,
    currentAction: 'holding',
    targetPosition: null,
    targetId: null,
    formation: 'line',
    visibilityRadius: 60,
    stats: { ...defaultStats, ...stats },
    lieutenantId,
    squadId,
    alive: true,
  };
}

// Create a squad of troops in formation
function createSquad(
  baseId: string,
  team: Team,
  centerPosition: Vec2,
  count: number,
  lieutenantId: string,
  squadId: string,
  stats?: Partial<TroopStats>
): TroopAgent[] {
  const troops: TroopAgent[] = [];
  const spacing = 15;
  
  // Arrange in a line
  const startX = centerPosition.x - ((count - 1) * spacing) / 2;
  
  for (let i = 0; i < count; i++) {
    const position: Vec2 = {
      x: startX + i * spacing,
      y: centerPosition.y,
    };
    troops.push(createTroop(`${baseId}_${i}`, team, position, lieutenantId, squadId, stats));
  }
  
  return troops;
}

// Create a lieutenant simulation agent with elevated visibility radius
function createLieutenantAgent(
  id: string,
  team: Team,
  position: Vec2,
  stats?: Partial<LieutenantStats>
): AgentState {
  const defaultStats: LieutenantStats = {
    initiative: 5,
    discipline: 5,
    communication: 5,
  };

  return {
    id,
    type: 'lieutenant',
    team,
    position: { ...position },
    health: 100,
    maxHealth: 100,
    morale: 100,
    currentAction: 'holding',
    targetPosition: null,
    targetId: null,
    formation: 'line',
    visibilityRadius: 150,
    stats: { ...defaultStats, ...stats },
    lieutenantId: null,
    squadId: null,
    alive: true,
  };
}

export interface ScenarioSetup {
  agents: AgentState[];
  flowcharts: Flowchart[];
  width: number;
  height: number;
}

// Create the basic test scenario
// Two armies facing each other, all with engage-on-sight behavior
export function createBasicScenario(): ScenarioSetup {
  const width = 400;
  const height = 300;
  
  const agents: AgentState[] = [];
  const flowcharts: Flowchart[] = [];
  
  // Player army - left side
  // 3 squads of 10 troops each, one per lieutenant
  const playerSquad1 = createSquad('p_s1', 'player', { x: 50, y: 80 }, 10, 'lt_alpha', 'squad_1');
  const playerSquad2 = createSquad('p_s2', 'player', { x: 50, y: 150 }, 10, 'lt_bravo', 'squad_2');
  const playerSquad3 = createSquad('p_s3', 'player', { x: 50, y: 220 }, 10, 'lt_charlie', 'squad_3');
  
  // Lieutenant agents for player — positioned behind their squads, higher visibility radius
  const ltAlpha = createLieutenantAgent('lt_alpha', 'player', { x: 30, y: 80 });
  const ltBravo = createLieutenantAgent('lt_bravo', 'player', { x: 30, y: 150 });
  const ltCharlie = createLieutenantAgent('lt_charlie', 'player', { x: 30, y: 220 });

  agents.push(...playerSquad1, ...playerSquad2, ...playerSquad3, ltAlpha, ltBravo, ltCharlie);

  // Enemy army - right side
  // 3 squads of 10 troops each
  const enemySquad1 = createSquad('e_s1', 'enemy', { x: 350, y: 100 }, 10, 'lt_enemy_1', 'enemy_squad_1');
  const enemySquad2 = createSquad('e_s2', 'enemy', { x: 350, y: 150 }, 10, 'lt_enemy_1', 'enemy_squad_2');
  const enemySquad3 = createSquad('e_s3', 'enemy', { x: 350, y: 200 }, 10, 'lt_enemy_2', 'enemy_squad_3');

  // Lieutenant agents for enemy — positioned behind their squads
  const ltEnemy1 = createLieutenantAgent('lt_enemy_1', 'enemy', { x: 370, y: 125 });
  const ltEnemy2 = createLieutenantAgent('lt_enemy_2', 'enemy', { x: 370, y: 200 });

  agents.push(...enemySquad1, ...enemySquad2, ...enemySquad3, ltEnemy1, ltEnemy2);
  
  // Create flowcharts for all agents
  // Player troops: engage on sight (will advance toward enemy)
  for (const agent of [...playerSquad1, ...playerSquad2, ...playerSquad3]) {
    flowcharts.push(createEngageOnSightFlowchart(agent.id, { x: 350, y: 150 }));
  }
  
  // Enemy troops: hold position (defensive) - they advance toward player if no contact
  for (const agent of [...enemySquad1, ...enemySquad2, ...enemySquad3]) {
    flowcharts.push(createEngageOnSightFlowchart(agent.id, { x: 50, y: 150 }));
  }
  
  return { agents, flowcharts, width, height };
}

// Asymmetric scenario: player attacking fortified position
export function createAssaultScenario(): ScenarioSetup {
  const width = 500;
  const height = 300;
  
  const agents: AgentState[] = [];
  const flowcharts: Flowchart[] = [];
  
  // Player army - left side, attacking
  // More troops, lower individual stats
  const playerSquad1 = createSquad('p_s1', 'player', { x: 50, y: 80 }, 12, 'lt_alpha', 'squad_1', { combat: 4 });
  const playerSquad2 = createSquad('p_s2', 'player', { x: 50, y: 150 }, 12, 'lt_bravo', 'squad_2', { combat: 4 });
  const playerSquad3 = createSquad('p_s3', 'player', { x: 50, y: 220 }, 12, 'lt_charlie', 'squad_3', { combat: 4 });
  
  // Lieutenant agents for player — positioned behind their squads, higher visibility radius
  const ltAlpha = createLieutenantAgent('lt_alpha', 'player', { x: 30, y: 80 });
  const ltBravo = createLieutenantAgent('lt_bravo', 'player', { x: 30, y: 150 });
  const ltCharlie = createLieutenantAgent('lt_charlie', 'player', { x: 30, y: 220 });

  agents.push(...playerSquad1, ...playerSquad2, ...playerSquad3, ltAlpha, ltBravo, ltCharlie);

  // Enemy army - right side, defending a ridge
  // Fewer troops, higher stats, better position
  const enemySquad1 = createSquad('e_s1', 'enemy', { x: 400, y: 120 }, 8, 'lt_enemy_1', 'enemy_squad_1', { combat: 7 });
  const enemySquad2 = createSquad('e_s2', 'enemy', { x: 400, y: 180 }, 8, 'lt_enemy_2', 'enemy_squad_2', { combat: 7 });

  // Lieutenant agents for enemy
  const ltEnemy1 = createLieutenantAgent('lt_enemy_1', 'enemy', { x: 420, y: 120 });
  const ltEnemy2 = createLieutenantAgent('lt_enemy_2', 'enemy', { x: 420, y: 180 });

  agents.push(...enemySquad1, ...enemySquad2, ltEnemy1, ltEnemy2);
  
  // Flowcharts
  for (const agent of [...playerSquad1, ...playerSquad2, ...playerSquad3]) {
    flowcharts.push(createEngageOnSightFlowchart(agent.id));
  }
  
  for (const agent of [...enemySquad1, ...enemySquad2]) {
    flowcharts.push(createHoldPositionFlowchart(agent.id));
  }
  
  return { agents, flowcharts, width, height };
}
