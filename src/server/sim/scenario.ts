/**
 * Battle scenarios for Warchief.
 *
 * Defines pre-built army configurations for testing and gameplay.
 * Uses engine unit factories for consistent, well-defined agents.
 */

import { AgentState } from '../../shared/types/index.js';
import {
  Flowchart,
  createEngageOnSightFlowchart,
  createHoldPositionFlowchart,
  createLieutenantDefaultFlowchart,
} from '../runtime/flowchart.js';
import {
  createTroop,
  createLieutenant,
  createSquad,
} from '../engine/index.js';

export interface ScenarioSetup {
  agents: AgentState[];
  flowcharts: Flowchart[];
  width: number;
  height: number;
}

/**
 * Basic scenario: Two armies facing each other.
 *
 * - 3 player squads of 10 troops each (30 total) on the left
 * - 3 enemy squads of 10 troops each (30 total) on the right
 * - All troops use engage-on-sight behavior
 * - 3 player lieutenants, 2 enemy lieutenants
 */
export function createBasicScenario(): ScenarioSetup {
  const width = 400;
  const height = 300;

  const agents: AgentState[] = [];
  const flowcharts: Flowchart[] = [];

  // ── Player Army (left side) ─────────────────────────────────────────────

  const playerSquad1 = createSquad('p_s1', 10, {
    team: 'player',
    centerPosition: { x: 80, y: 80 },
    lieutenantId: 'lt_alpha',
    squadId: 'squad_1',
  });

  const playerSquad2 = createSquad('p_s2', 10, {
    team: 'player',
    centerPosition: { x: 80, y: 150 },
    lieutenantId: 'lt_bravo',
    squadId: 'squad_2',
  });

  const playerSquad3 = createSquad('p_s3', 10, {
    team: 'player',
    centerPosition: { x: 80, y: 220 },
    lieutenantId: 'lt_charlie',
    squadId: 'squad_3',
  });

  const ltAlpha = createLieutenant({
    id: 'lt_alpha',
    team: 'player',
    position: { x: 20, y: 80 },
    name: 'Lt. Alpha',
    preset: 'aggressive',
    troopIds: playerSquad1.map(t => t.id),
  });

  const ltBravo = createLieutenant({
    id: 'lt_bravo',
    team: 'player',
    position: { x: 20, y: 150 },
    name: 'Lt. Bravo',
    preset: 'disciplined',
    troopIds: playerSquad2.map(t => t.id),
  });

  const ltCharlie = createLieutenant({
    id: 'lt_charlie',
    team: 'player',
    position: { x: 20, y: 220 },
    name: 'Lt. Charlie',
    preset: 'cautious',
    troopIds: playerSquad3.map(t => t.id),
  });

  agents.push(...playerSquad1, ...playerSquad2, ...playerSquad3, ltAlpha, ltBravo, ltCharlie);

  // ── Enemy Army (right side) ─────────────────────────────────────────────

  const enemySquad1 = createSquad('e_s1', 10, {
    team: 'enemy',
    centerPosition: { x: 320, y: 80 },
    lieutenantId: 'lt_enemy_1',
    squadId: 'enemy_squad_1',
  });

  const enemySquad2 = createSquad('e_s2', 10, {
    team: 'enemy',
    centerPosition: { x: 320, y: 150 },
    lieutenantId: 'lt_enemy_1',
    squadId: 'enemy_squad_2',
  });

  const enemySquad3 = createSquad('e_s3', 10, {
    team: 'enemy',
    centerPosition: { x: 320, y: 220 },
    lieutenantId: 'lt_enemy_2',
    squadId: 'enemy_squad_3',
  });

  const ltEnemy1 = createLieutenant({
    id: 'lt_enemy_1',
    team: 'enemy',
    position: { x: 370, y: 115 },
    name: 'Enemy Commander 1',
    preset: 'aggressive',
    troopIds: [...enemySquad1.map(t => t.id), ...enemySquad2.map(t => t.id)],
  });

  const ltEnemy2 = createLieutenant({
    id: 'lt_enemy_2',
    team: 'enemy',
    position: { x: 370, y: 220 },
    name: 'Enemy Commander 2',
    preset: 'disciplined',
    troopIds: enemySquad3.map(t => t.id),
  });

  agents.push(...enemySquad1, ...enemySquad2, ...enemySquad3, ltEnemy1, ltEnemy2);

  // ── Flowcharts ──────────────────────────────────────────────────────────

  // Player troops: engage on sight, advance toward enemy side
  for (const agent of [...playerSquad1, ...playerSquad2, ...playerSquad3]) {
    flowcharts.push(createEngageOnSightFlowchart(agent.id, { x: 350, y: 150 }));
  }

  // Enemy troops: engage on sight, advance toward player side
  for (const agent of [...enemySquad1, ...enemySquad2, ...enemySquad3]) {
    flowcharts.push(createEngageOnSightFlowchart(agent.id, { x: 50, y: 150 }));
  }

  // All lieutenants get default flowcharts (FIX: ltCharlie was previously missing)
  for (const lt of [ltAlpha, ltBravo, ltCharlie, ltEnemy1, ltEnemy2]) {
    flowcharts.push(createLieutenantDefaultFlowchart(lt.id));
  }

  return { agents, flowcharts, width, height };
}

/**
 * Assault scenario: Player attacking a fortified position.
 *
 * - 3 player squads of 12 troops (36 total), lower combat stats
 * - 2 enemy squads of 8 troops (16 total), higher combat stats
 * - Player troops advance, enemy troops hold position
 */
export function createAssaultScenario(): ScenarioSetup {
  const width = 500;
  const height = 300;

  const agents: AgentState[] = [];
  const flowcharts: Flowchart[] = [];

  // ── Player Army (left side, attacking) ──────────────────────────────────

  const playerSquad1 = createSquad('p_s1', 12, {
    team: 'player',
    centerPosition: { x: 50, y: 80 },
    lieutenantId: 'lt_alpha',
    squadId: 'squad_1',
    stats: { combat: 4 },
  });

  const playerSquad2 = createSquad('p_s2', 12, {
    team: 'player',
    centerPosition: { x: 50, y: 150 },
    lieutenantId: 'lt_bravo',
    squadId: 'squad_2',
    stats: { combat: 4 },
  });

  const playerSquad3 = createSquad('p_s3', 12, {
    team: 'player',
    centerPosition: { x: 50, y: 220 },
    lieutenantId: 'lt_charlie',
    squadId: 'squad_3',
    stats: { combat: 4 },
  });

  const ltAlpha = createLieutenant({
    id: 'lt_alpha',
    team: 'player',
    position: { x: 30, y: 80 },
    name: 'Lt. Alpha',
    preset: 'aggressive',
    troopIds: playerSquad1.map(t => t.id),
  });

  const ltBravo = createLieutenant({
    id: 'lt_bravo',
    team: 'player',
    position: { x: 30, y: 150 },
    name: 'Lt. Bravo',
    preset: 'disciplined',
    troopIds: playerSquad2.map(t => t.id),
  });

  const ltCharlie = createLieutenant({
    id: 'lt_charlie',
    team: 'player',
    position: { x: 30, y: 220 },
    name: 'Lt. Charlie',
    preset: 'cautious',
    troopIds: playerSquad3.map(t => t.id),
  });

  agents.push(...playerSquad1, ...playerSquad2, ...playerSquad3, ltAlpha, ltBravo, ltCharlie);

  // ── Enemy Army (right side, defending) ──────────────────────────────────

  const enemySquad1 = createSquad('e_s1', 8, {
    team: 'enemy',
    centerPosition: { x: 400, y: 120 },
    lieutenantId: 'lt_enemy_1',
    squadId: 'enemy_squad_1',
    preset: 'vanguard',
    stats: { combat: 7 },
  });

  const enemySquad2 = createSquad('e_s2', 8, {
    team: 'enemy',
    centerPosition: { x: 400, y: 180 },
    lieutenantId: 'lt_enemy_2',
    squadId: 'enemy_squad_2',
    preset: 'guardian',
    stats: { combat: 7 },
  });

  const ltEnemy1 = createLieutenant({
    id: 'lt_enemy_1',
    team: 'enemy',
    position: { x: 420, y: 120 },
    name: 'Enemy Commander 1',
    preset: 'disciplined',
    troopIds: enemySquad1.map(t => t.id),
  });

  const ltEnemy2 = createLieutenant({
    id: 'lt_enemy_2',
    team: 'enemy',
    position: { x: 420, y: 180 },
    name: 'Enemy Commander 2',
    preset: 'cautious',
    troopIds: enemySquad2.map(t => t.id),
  });

  agents.push(...enemySquad1, ...enemySquad2, ltEnemy1, ltEnemy2);

  // ── Flowcharts ──────────────────────────────────────────────────────────

  // Player troops: advance and engage
  for (const agent of [...playerSquad1, ...playerSquad2, ...playerSquad3]) {
    flowcharts.push(createEngageOnSightFlowchart(agent.id));
  }

  // Enemy troops: hold position and defend
  for (const agent of [...enemySquad1, ...enemySquad2]) {
    flowcharts.push(createHoldPositionFlowchart(agent.id));
  }

  // All lieutenants get default flowcharts
  for (const lt of [ltAlpha, ltBravo, ltCharlie, ltEnemy1, ltEnemy2]) {
    flowcharts.push(createLieutenantDefaultFlowchart(lt.id));
  }

  return { agents, flowcharts, width, height };
}
