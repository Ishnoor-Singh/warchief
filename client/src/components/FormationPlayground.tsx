import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Vec2 { x: number; y: number }

type FormationType = 'line' | 'wedge' | 'scatter' | 'pincer' | 'defensive_circle' | 'column';
type Team = 'player' | 'enemy';
type BehaviorType =
  | 'charge'           // engage on sight, advance when no enemies
  | 'hold'             // hold position, engage only when very close
  | 'cautious'         // engage close, hold at range
  | 'aggressive'       // rush toward nearest enemy always
  | 'fallback'         // retreat when under attack
  | 'defensive'        // hold tight, engage in range, no advance
  | 'flank_left'       // move to flank left then engage
  | 'flank_right'      // move to flank right then engage
  | 'advance_slow'     // advance slowly, maintain formation
  | 'pursue';          // chase and engage

interface PlaygroundAgent {
  id: string;
  type: 'troop' | 'lieutenant';
  team: Team;
  position: Vec2;
  targetPosition: Vec2 | null;
  formationSlot: Vec2 | null;
  health: number;
  maxHealth: number;
  morale: number;
  formation: FormationType;
  behavior: BehaviorType;
  currentAction: string;
  alive: boolean;
  lieutenantId: string | null;
  speed: number;
  combat: number;
}

interface PlaygroundState {
  agents: PlaygroundAgent[];
  tick: number;
  running: boolean;
  width: number;
  height: number;
}

interface PresetCategory {
  name: string;
  presets: Preset[];
}

interface Preset {
  id: string;
  name: string;
  description: string;
  command?: string;  // what a player might say to trigger this
  playerFormation: FormationType;
  playerBehavior: BehaviorType;
  enemyFormation: FormationType;
  enemyBehavior: BehaviorType;
  playerStats?: { combat?: number; speed?: number };
  enemyStats?: { combat?: number; speed?: number };
  playerPosition?: Vec2;
  enemyPosition?: Vec2;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FORMATIONS: FormationType[] = ['line', 'wedge', 'scatter', 'pincer', 'defensive_circle', 'column'];
const FORMATION_LABELS: Record<FormationType, string> = {
  line: 'Line',
  wedge: 'Wedge',
  scatter: 'Scatter',
  pincer: 'Pincer',
  defensive_circle: 'Circle',
  column: 'Column',
};

const MAP_W = 500;
const MAP_H = 350;
const SPACING = 15;
const COMBAT_RANGE = 25;
const BASE_DAMAGE = 8;
const CANVAS_SCALE = 2;
const SQUAD_SIZE = 10;

const PLAYER_COLOR = '#4a9eff';
const PLAYER_TROOP_COLOR = '#3a7ecc';
const ENEMY_COLOR = '#ff4a4a';
const ENEMY_TROOP_COLOR = '#cc3a3a';
const SLOT_COLOR = 'rgba(255,255,255,0.15)';

// ─── Formation Math (ported from server) ─────────────────────────────────────

function computeFormationSlot(formation: FormationType, ltPos: Vec2, index: number, total: number): Vec2 {
  const spacing = SPACING;

  switch (formation) {
    case 'line': {
      const startX = ltPos.x - ((total - 1) * spacing) / 2;
      return { x: startX + index * spacing, y: ltPos.y + 30 };
    }
    case 'column': {
      return { x: ltPos.x, y: ltPos.y + 20 + index * spacing };
    }
    case 'wedge': {
      const row = Math.floor(index / 2);
      const side = index % 2 === 0 ? -1 : 1;
      return { x: ltPos.x + side * row * spacing, y: ltPos.y + 20 + row * spacing };
    }
    case 'defensive_circle': {
      const radius = Math.max(30, (total * spacing) / (2 * Math.PI));
      const angle = (index / total) * 2 * Math.PI;
      return { x: ltPos.x + Math.cos(angle) * radius, y: ltPos.y + Math.sin(angle) * radius };
    }
    case 'scatter': {
      const cols = Math.ceil(Math.sqrt(total));
      const row = Math.floor(index / cols);
      const col = index % cols;
      return {
        x: ltPos.x - (cols * spacing) / 2 + col * spacing * 1.5,
        y: ltPos.y - (Math.ceil(total / cols) * spacing) / 2 + row * spacing * 1.5,
      };
    }
    case 'pincer': {
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

function dist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Scenario Creation ───────────────────────────────────────────────────────

function createScenario(preset: Preset): PlaygroundState {
  const agents: PlaygroundAgent[] = [];
  const pPos = preset.playerPosition || { x: 120, y: MAP_H / 2 };
  const ePos = preset.enemyPosition || { x: MAP_W - 120, y: MAP_H / 2 };

  // Player lieutenant
  agents.push({
    id: 'lt_player',
    type: 'lieutenant',
    team: 'player',
    position: { ...pPos },
    targetPosition: null,
    formationSlot: null,
    health: 150,
    maxHealth: 150,
    morale: 100,
    formation: preset.playerFormation,
    behavior: preset.playerBehavior,
    currentAction: 'holding',
    alive: true,
    lieutenantId: null,
    speed: 1.5,
    combat: 3,
  });

  // Player troops
  for (let i = 0; i < SQUAD_SIZE; i++) {
    const slot = computeFormationSlot(preset.playerFormation, pPos, i, SQUAD_SIZE);
    agents.push({
      id: `p_troop_${i}`,
      type: 'troop',
      team: 'player',
      position: { ...slot },
      targetPosition: null,
      formationSlot: { ...slot },
      health: 100,
      maxHealth: 100,
      morale: 100,
      formation: preset.playerFormation,
      behavior: preset.playerBehavior,
      currentAction: 'holding',
      alive: true,
      lieutenantId: 'lt_player',
      speed: preset.playerStats?.speed ?? 2,
      combat: preset.playerStats?.combat ?? 5,
    });
  }

  // Enemy lieutenant
  agents.push({
    id: 'lt_enemy',
    type: 'lieutenant',
    team: 'enemy',
    position: { ...ePos },
    targetPosition: null,
    formationSlot: null,
    health: 150,
    maxHealth: 150,
    morale: 100,
    formation: preset.enemyFormation,
    behavior: preset.enemyBehavior,
    currentAction: 'holding',
    alive: true,
    lieutenantId: null,
    speed: 1.5,
    combat: 3,
  });

  // Enemy troops
  for (let i = 0; i < SQUAD_SIZE; i++) {
    const slot = computeFormationSlot(preset.enemyFormation, ePos, i, SQUAD_SIZE);
    agents.push({
      id: `e_troop_${i}`,
      type: 'troop',
      team: 'enemy',
      position: { ...slot },
      targetPosition: null,
      formationSlot: { ...slot },
      health: 100,
      maxHealth: 100,
      morale: 100,
      formation: preset.enemyFormation,
      behavior: preset.enemyBehavior,
      currentAction: 'holding',
      alive: true,
      lieutenantId: 'lt_enemy',
      speed: preset.enemyStats?.speed ?? 2,
      combat: preset.enemyStats?.combat ?? 5,
    });
  }

  return { agents, tick: 0, running: false, width: MAP_W, height: MAP_H };
}

// ─── Simulation Step ─────────────────────────────────────────────────────────

function findClosestEnemy(agent: PlaygroundAgent, agents: PlaygroundAgent[]): PlaygroundAgent | null {
  let closest: PlaygroundAgent | null = null;
  let closestDist = Infinity;
  for (const other of agents) {
    if (other.team === agent.team || !other.alive) continue;
    const d = dist(agent.position, other.position);
    if (d < closestDist) {
      closestDist = d;
      closest = other;
    }
  }
  return closest;
}

function getLtForAgent(agent: PlaygroundAgent, agents: PlaygroundAgent[]): PlaygroundAgent | null {
  if (!agent.lieutenantId) return null;
  return agents.find(a => a.id === agent.lieutenantId && a.alive) || null;
}

function recomputeFormationSlots(state: PlaygroundState) {
  const ltMap = new Map<string, PlaygroundAgent>();
  for (const a of state.agents) {
    if (a.type === 'lieutenant' && a.alive) ltMap.set(a.id, a);
  }

  // Group troops by lieutenant
  const troopsByLt = new Map<string, PlaygroundAgent[]>();
  for (const a of state.agents) {
    if (a.type !== 'troop' || !a.alive || !a.lieutenantId) continue;
    const list = troopsByLt.get(a.lieutenantId) || [];
    list.push(a);
    troopsByLt.set(a.lieutenantId, list);
  }

  for (const [ltId, troops] of troopsByLt) {
    const lt = ltMap.get(ltId);
    if (!lt) continue;
    troops.sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < troops.length; i++) {
      troops[i]!.formationSlot = computeFormationSlot(troops[i]!.formation, lt.position, i, troops.length);
    }
  }
}

function stepSimulation(state: PlaygroundState): PlaygroundState {
  const next: PlaygroundState = {
    ...state,
    tick: state.tick + 1,
    agents: state.agents.map(a => ({ ...a, position: { ...a.position } })),
  };

  recomputeFormationSlots(next);

  // Process behaviors
  for (const agent of next.agents) {
    if (!agent.alive || agent.type === 'lieutenant') continue;

    const enemy = findClosestEnemy(agent, next.agents);
    const enemyDist = enemy ? dist(agent.position, enemy.position) : Infinity;
    const lt = getLtForAgent(agent, next.agents);

    switch (agent.behavior) {
      case 'charge':
        if (enemy && enemyDist < 150) {
          agent.targetPosition = { ...enemy.position };
          agent.currentAction = 'engaging';
        } else if (enemy) {
          // Advance toward enemy side
          agent.targetPosition = { x: enemy.position.x, y: agent.position.y };
          agent.currentAction = 'moving';
        } else if (agent.formationSlot) {
          agent.targetPosition = agent.formationSlot;
          agent.currentAction = 'moving';
        }
        break;

      case 'hold':
        if (enemy && enemyDist < COMBAT_RANGE * 1.5) {
          agent.targetPosition = null;
          agent.currentAction = 'engaging';
        } else if (agent.formationSlot) {
          agent.targetPosition = agent.formationSlot;
          agent.currentAction = 'holding';
        }
        break;

      case 'cautious':
        if (enemy && enemyDist < 50) {
          agent.targetPosition = { ...enemy.position };
          agent.currentAction = 'engaging';
        } else if (agent.formationSlot) {
          agent.targetPosition = agent.formationSlot;
          agent.currentAction = 'holding';
        }
        break;

      case 'aggressive':
        if (enemy) {
          agent.targetPosition = { ...enemy.position };
          agent.currentAction = 'engaging';
        } else if (agent.formationSlot) {
          agent.targetPosition = agent.formationSlot;
          agent.currentAction = 'moving';
        }
        break;

      case 'fallback':
        if (enemy && enemyDist < 60) {
          // Retreat away from enemy
          const dx = agent.position.x - enemy.position.x;
          const dy = agent.position.y - enemy.position.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          agent.targetPosition = {
            x: agent.position.x + (dx / d) * 50,
            y: agent.position.y + (dy / d) * 50,
          };
          agent.currentAction = 'falling_back';
        } else if (agent.formationSlot) {
          agent.targetPosition = agent.formationSlot;
          agent.currentAction = 'holding';
        }
        break;

      case 'defensive':
        if (enemy && enemyDist < COMBAT_RANGE * 2) {
          agent.targetPosition = null;
          agent.currentAction = 'engaging';
        } else if (agent.formationSlot) {
          agent.targetPosition = agent.formationSlot;
          agent.currentAction = 'holding';
        }
        break;

      case 'flank_left':
        if (enemy && enemyDist < 60) {
          agent.targetPosition = { ...enemy.position };
          agent.currentAction = 'engaging';
        } else if (lt && enemy) {
          // Move to a position left of the enemy
          agent.targetPosition = { x: enemy.position.x, y: enemy.position.y - 80 };
          agent.currentAction = 'moving';
        } else if (agent.formationSlot) {
          agent.targetPosition = agent.formationSlot;
          agent.currentAction = 'moving';
        }
        break;

      case 'flank_right':
        if (enemy && enemyDist < 60) {
          agent.targetPosition = { ...enemy.position };
          agent.currentAction = 'engaging';
        } else if (lt && enemy) {
          agent.targetPosition = { x: enemy.position.x, y: enemy.position.y + 80 };
          agent.currentAction = 'moving';
        } else if (agent.formationSlot) {
          agent.targetPosition = agent.formationSlot;
          agent.currentAction = 'moving';
        }
        break;

      case 'advance_slow':
        if (enemy && enemyDist < COMBAT_RANGE * 2) {
          agent.targetPosition = { ...enemy.position };
          agent.currentAction = 'engaging';
        } else if (agent.formationSlot) {
          agent.targetPosition = agent.formationSlot;
          agent.currentAction = 'moving';
        }
        break;

      case 'pursue':
        if (enemy) {
          agent.targetPosition = { ...enemy.position };
          agent.currentAction = 'engaging';
        } else if (agent.formationSlot) {
          agent.targetPosition = agent.formationSlot;
          agent.currentAction = 'moving';
        }
        break;
    }
  }

  // Move lieutenants with their squads
  for (const lt of next.agents) {
    if (lt.type !== 'lieutenant' || !lt.alive) continue;
    const troops = next.agents.filter(a => a.lieutenantId === lt.id && a.alive);
    if (troops.length === 0) continue;

    // Lieutenant behavior: follow their troops' general direction
    const avgTroopX = troops.reduce((s, t) => s + t.position.x, 0) / troops.length;
    const avgTroopY = troops.reduce((s, t) => s + t.position.y, 0) / troops.length;

    switch (lt.behavior) {
      case 'charge':
      case 'aggressive':
      case 'pursue': {
        // Advance behind troops
        const advanceDir = lt.team === 'player' ? 1 : -1;
        lt.targetPosition = { x: avgTroopX - advanceDir * 30, y: avgTroopY };
        break;
      }
      case 'flank_left':
      case 'flank_right': {
        const dir = lt.team === 'player' ? 1 : -1;
        lt.targetPosition = { x: avgTroopX - dir * 30, y: avgTroopY };
        break;
      }
      case 'advance_slow': {
        const dir = lt.team === 'player' ? 0.5 : -0.5;
        lt.targetPosition = { x: lt.position.x + dir, y: avgTroopY };
        break;
      }
      case 'fallback': {
        const retreatDir = lt.team === 'player' ? -1 : 1;
        lt.targetPosition = { x: lt.position.x + retreatDir * 2, y: lt.position.y };
        break;
      }
      default:
        lt.targetPosition = null;
        break;
    }
  }

  // Movement
  for (const agent of next.agents) {
    if (!agent.alive || !agent.targetPosition) continue;
    const d = dist(agent.position, agent.targetPosition);
    const spd = agent.speed * (agent.behavior === 'advance_slow' ? 0.5 : 1);
    if (d <= spd) {
      agent.position = { ...agent.targetPosition };
      if (agent.currentAction === 'moving') agent.currentAction = 'holding';
    } else {
      const dx = agent.targetPosition.x - agent.position.x;
      const dy = agent.targetPosition.y - agent.position.y;
      const ratio = spd / d;
      agent.position.x += dx * ratio;
      agent.position.y += dy * ratio;
    }
    // Clamp to map
    agent.position.x = Math.max(5, Math.min(MAP_W - 5, agent.position.x));
    agent.position.y = Math.max(5, Math.min(MAP_H - 5, agent.position.y));
  }

  // Combat
  const alive = next.agents.filter(a => a.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i]!;
      const b = alive[j]!;
      if (a.team === b.team) continue;
      const d = dist(a.position, b.position);
      if (d > COMBAT_RANGE) continue;

      // Both deal damage
      const dmgA = Math.max(1, Math.round(BASE_DAMAGE * (a.combat / b.combat) * (0.9 + Math.random() * 0.2)));
      const dmgB = Math.max(1, Math.round(BASE_DAMAGE * (b.combat / a.combat) * (0.9 + Math.random() * 0.2)));

      b.health -= dmgA;
      a.health -= dmgB;

      if (b.health <= 0) { b.health = 0; b.alive = false; }
      if (a.health <= 0) { a.health = 0; a.alive = false; }
    }
  }

  return next;
}

// ─── Presets ─────────────────────────────────────────────────────────────────

const PRESET_CATEGORIES: PresetCategory[] = [
  {
    name: 'Formation Showcase',
    presets: FORMATIONS.map(f => ({
      id: `showcase_${f}`,
      name: `${FORMATION_LABELS[f]} Formation`,
      description: `Display the ${f} formation shape with 10 troops.`,
      command: `"Form up in ${f} formation"`,
      playerFormation: f,
      playerBehavior: 'hold' as BehaviorType,
      enemyFormation: f,
      enemyBehavior: 'hold' as BehaviorType,
    })),
  },
  {
    name: 'Mirror Matches',
    presets: FORMATIONS.map(f => ({
      id: `mirror_${f}`,
      name: `${FORMATION_LABELS[f]} vs ${FORMATION_LABELS[f]}`,
      description: `Both squads in ${f} formation charge each other.`,
      command: `"All troops, ${f} formation, charge!"`,
      playerFormation: f,
      playerBehavior: 'charge' as BehaviorType,
      enemyFormation: f,
      enemyBehavior: 'charge' as BehaviorType,
    })),
  },
  {
    name: 'Formation Clashes',
    presets: [
      { id: 'clash_line_wedge', name: 'Line vs Wedge', description: 'Broad line meets a focused V-charge.', command: '"Hold the line!" vs "Wedge charge!"', playerFormation: 'line' as FormationType, playerBehavior: 'hold' as BehaviorType, enemyFormation: 'wedge' as FormationType, enemyBehavior: 'charge' as BehaviorType },
      { id: 'clash_line_scatter', name: 'Line vs Scatter', description: 'Disciplined line vs loose formation.', command: '"Line formation, hold!" vs "Scatter and engage"', playerFormation: 'line' as FormationType, playerBehavior: 'defensive' as BehaviorType, enemyFormation: 'scatter' as FormationType, enemyBehavior: 'charge' as BehaviorType },
      { id: 'clash_line_pincer', name: 'Line vs Pincer', description: 'Line holds while enemy flanks both sides.', command: '"Hold the line!" vs "Pincer formation, surround them!"', playerFormation: 'line' as FormationType, playerBehavior: 'hold' as BehaviorType, enemyFormation: 'pincer' as FormationType, enemyBehavior: 'charge' as BehaviorType },
      { id: 'clash_line_circle', name: 'Line vs Circle', description: 'Line charge vs defensive circle.', command: '"Advance in line!" vs "Defensive circle!"', playerFormation: 'line' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'defensive_circle' as FormationType, enemyBehavior: 'defensive' as BehaviorType },
      { id: 'clash_line_column', name: 'Line vs Column', description: 'Broad front vs single-file charge.', command: '"Spread out in a line!" vs "Column advance!"', playerFormation: 'line' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'column' as FormationType, enemyBehavior: 'charge' as BehaviorType },
      { id: 'clash_wedge_scatter', name: 'Wedge vs Scatter', description: 'Focused charge into a dispersed formation.', command: '"Wedge, punch through!" vs "Spread out!"', playerFormation: 'wedge' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'scatter' as FormationType, enemyBehavior: 'cautious' as BehaviorType },
      { id: 'clash_wedge_pincer', name: 'Wedge vs Pincer', description: 'V-formation charges into flanking pincers.', command: '"Wedge charge!" vs "Pincer, trap them!"', playerFormation: 'wedge' as FormationType, playerBehavior: 'aggressive' as BehaviorType, enemyFormation: 'pincer' as FormationType, enemyBehavior: 'charge' as BehaviorType },
      { id: 'clash_wedge_circle', name: 'Wedge vs Circle', description: 'Penetrating wedge vs all-around defense.', command: '"Wedge, break through!" vs "Circle up, hold!"', playerFormation: 'wedge' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'defensive_circle' as FormationType, enemyBehavior: 'defensive' as BehaviorType },
      { id: 'clash_wedge_column', name: 'Wedge vs Column', description: 'Two narrow formations collide.', command: '"Wedge advance!" vs "Column charge!"', playerFormation: 'wedge' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'column' as FormationType, enemyBehavior: 'charge' as BehaviorType },
      { id: 'clash_scatter_pincer', name: 'Scatter vs Pincer', description: 'Loose guerrilla vs organized flanking.', command: '"Scatter and harass!" vs "Pincer movement!"', playerFormation: 'scatter' as FormationType, playerBehavior: 'cautious' as BehaviorType, enemyFormation: 'pincer' as FormationType, enemyBehavior: 'charge' as BehaviorType },
      { id: 'clash_scatter_circle', name: 'Scatter vs Circle', description: 'Scattered attack vs circular defense.', command: '"Spread out, pick them off!" vs "Circle formation, hold!"', playerFormation: 'scatter' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'defensive_circle' as FormationType, enemyBehavior: 'hold' as BehaviorType },
      { id: 'clash_scatter_column', name: 'Scatter vs Column', description: 'Dispersed troops vs concentrated column.', command: '"Scatter!" vs "Column charge!"', playerFormation: 'scatter' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'column' as FormationType, enemyBehavior: 'aggressive' as BehaviorType },
      { id: 'clash_pincer_circle', name: 'Pincer vs Circle', description: 'Flanking vs all-around defense.', command: '"Surround them!" vs "Circle up!"', playerFormation: 'pincer' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'defensive_circle' as FormationType, enemyBehavior: 'hold' as BehaviorType },
      { id: 'clash_pincer_column', name: 'Pincer vs Column', description: 'Flanking pincers vs single-file column.', command: '"Pincer, cut them off!" vs "Column, push through!"', playerFormation: 'pincer' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'column' as FormationType, enemyBehavior: 'aggressive' as BehaviorType },
      { id: 'clash_column_circle', name: 'Column vs Circle', description: 'Column punch vs circular defense.', command: '"Column charge!" vs "Defensive circle!"', playerFormation: 'column' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'defensive_circle' as FormationType, enemyBehavior: 'defensive' as BehaviorType },
    ],
  },
  {
    name: 'Behavior Tests',
    presets: [
      { id: 'beh_charge_hold', name: 'Charge vs Hold', description: 'Charging line meets a stationary defender.', command: '"Charge!" vs "Hold position!"', playerFormation: 'line' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'line' as FormationType, enemyBehavior: 'hold' as BehaviorType },
      { id: 'beh_hold_charge', name: 'Hold vs Charge', description: 'Holding line meets charging attacker.', command: '"Hold position!" vs "Charge!"', playerFormation: 'line' as FormationType, playerBehavior: 'hold' as BehaviorType, enemyFormation: 'line' as FormationType, enemyBehavior: 'charge' as BehaviorType },
      { id: 'beh_charge_charge', name: 'Charge vs Charge', description: 'Head-on collision, both sides charging.', command: '"All out attack!" vs "All out attack!"', playerFormation: 'line' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'line' as FormationType, enemyBehavior: 'charge' as BehaviorType },
      { id: 'beh_hold_hold', name: 'Hold vs Hold', description: 'Standoff. Neither side advances.', command: '"Hold position!" vs "Hold position!"', playerFormation: 'line' as FormationType, playerBehavior: 'hold' as BehaviorType, enemyFormation: 'line' as FormationType, enemyBehavior: 'hold' as BehaviorType },
      { id: 'beh_charge_fallback', name: 'Charge vs Fallback', description: 'Charging into retreating enemies.', command: '"Charge!" vs "Fall back!"', playerFormation: 'wedge' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'line' as FormationType, enemyBehavior: 'fallback' as BehaviorType },
      { id: 'beh_aggressive_cautious', name: 'Aggressive vs Cautious', description: 'Reckless aggression meets calculated defense.', command: '"Attack everything!" vs "Engage carefully, stay in formation"', playerFormation: 'scatter' as FormationType, playerBehavior: 'aggressive' as BehaviorType, enemyFormation: 'line' as FormationType, enemyBehavior: 'cautious' as BehaviorType },
      { id: 'beh_defensive_aggressive', name: 'Defensive vs Aggressive', description: 'Tight defense vs wild aggression.', command: '"Defensive circle, engage only close!" vs "Rush them!"', playerFormation: 'defensive_circle' as FormationType, playerBehavior: 'defensive' as BehaviorType, enemyFormation: 'scatter' as FormationType, enemyBehavior: 'aggressive' as BehaviorType },
      { id: 'beh_pursue_fallback', name: 'Pursue vs Fallback', description: 'Chase versus retreat.', command: '"Chase them down!" vs "Retreat!"', playerFormation: 'wedge' as FormationType, playerBehavior: 'pursue' as BehaviorType, enemyFormation: 'column' as FormationType, enemyBehavior: 'fallback' as BehaviorType },
      { id: 'beh_slow_advance', name: 'Slow Advance vs Hold', description: 'Disciplined slow advance vs stationary defense.', command: '"Advance slowly, maintain formation" vs "Hold!"', playerFormation: 'line' as FormationType, playerBehavior: 'advance_slow' as BehaviorType, enemyFormation: 'line' as FormationType, enemyBehavior: 'hold' as BehaviorType },
      { id: 'beh_flank_left', name: 'Flank Left vs Hold', description: 'Flanking left against a stationary line.', command: '"Flank left!" vs "Hold position!"', playerFormation: 'column' as FormationType, playerBehavior: 'flank_left' as BehaviorType, enemyFormation: 'line' as FormationType, enemyBehavior: 'hold' as BehaviorType },
      { id: 'beh_flank_right', name: 'Flank Right vs Hold', description: 'Flanking right against a stationary line.', command: '"Flank right!" vs "Hold position!"', playerFormation: 'column' as FormationType, playerBehavior: 'flank_right' as BehaviorType, enemyFormation: 'line' as FormationType, enemyBehavior: 'hold' as BehaviorType },
      { id: 'beh_double_flank', name: 'Pincer Flank vs Hold', description: 'Dual flank from pincer against a defensive line.', command: '"Surround them!" vs "Hold the line!"', playerFormation: 'pincer' as FormationType, playerBehavior: 'charge' as BehaviorType, enemyFormation: 'line' as FormationType, enemyBehavior: 'defensive' as BehaviorType },
    ],
  },
  {
    name: 'Tactical Scenarios',
    presets: [
      {
        id: 'tac_blitz', name: 'Blitz Rush', description: 'Fast wedge charge with high-speed troops against unprepared defenders.',
        command: '"Full speed, wedge formation, break through their center!"',
        playerFormation: 'wedge' as FormationType, playerBehavior: 'aggressive' as BehaviorType,
        enemyFormation: 'scatter' as FormationType, enemyBehavior: 'cautious' as BehaviorType,
        playerStats: { speed: 3.5, combat: 4 }, enemyStats: { speed: 1.5, combat: 5 },
      },
      {
        id: 'tac_last_stand', name: 'Last Stand', description: 'Outnumbered circle defense against a charging line. Player troops are tougher.',
        command: '"Circle formation! Fight to the last!"',
        playerFormation: 'defensive_circle' as FormationType, playerBehavior: 'defensive' as BehaviorType,
        enemyFormation: 'line' as FormationType, enemyBehavior: 'charge' as BehaviorType,
        playerStats: { combat: 8 }, enemyStats: { combat: 4 },
      },
      {
        id: 'tac_ambush', name: 'Ambush', description: 'Scattered troops spring a close-range ambush on a marching column.',
        command: '"Hide in scatter, engage only when very close!"',
        playerFormation: 'scatter' as FormationType, playerBehavior: 'cautious' as BehaviorType,
        enemyFormation: 'column' as FormationType, enemyBehavior: 'advance_slow' as BehaviorType,
        playerPosition: { x: 250, y: MAP_H / 2 },
      },
      {
        id: 'tac_shield_wall', name: 'Shield Wall', description: 'Line formation holds with high-combat troops vs aggressive chargers.',
        command: '"Form a line! No one breaks formation!"',
        playerFormation: 'line' as FormationType, playerBehavior: 'hold' as BehaviorType,
        enemyFormation: 'wedge' as FormationType, enemyBehavior: 'aggressive' as BehaviorType,
        playerStats: { combat: 7, speed: 1 }, enemyStats: { combat: 5 },
      },
      {
        id: 'tac_hammer_anvil', name: 'Hammer & Anvil', description: 'Pincer charges into the flanks of a holding line.',
        command: '"Pincer formation, hit them from both sides!"',
        playerFormation: 'pincer' as FormationType, playerBehavior: 'charge' as BehaviorType,
        enemyFormation: 'line' as FormationType, enemyBehavior: 'hold' as BehaviorType,
      },
      {
        id: 'tac_retreat_regroup', name: 'Fighting Retreat', description: 'Falling back while enemies pursue aggressively.',
        command: '"Fall back! Maintain scatter formation!"',
        playerFormation: 'scatter' as FormationType, playerBehavior: 'fallback' as BehaviorType,
        enemyFormation: 'wedge' as FormationType, enemyBehavior: 'pursue' as BehaviorType,
        playerPosition: { x: 220, y: MAP_H / 2 }, enemyPosition: { x: 320, y: MAP_H / 2 },
      },
      {
        id: 'tac_column_punch', name: 'Column Punch-Through', description: 'Concentrated column charge attempts to break a broad line.',
        command: '"Single file, straight through the center!"',
        playerFormation: 'column' as FormationType, playerBehavior: 'aggressive' as BehaviorType,
        enemyFormation: 'line' as FormationType, enemyBehavior: 'defensive' as BehaviorType,
        playerStats: { combat: 6 },
      },
      {
        id: 'tac_guerrilla', name: 'Guerrilla Tactics', description: 'Scattered cautious troops harassing a disciplined column advance.',
        command: '"Scatter! Hit and run, don\'t commit!"',
        playerFormation: 'scatter' as FormationType, playerBehavior: 'cautious' as BehaviorType,
        enemyFormation: 'column' as FormationType, enemyBehavior: 'charge' as BehaviorType,
      },
      {
        id: 'tac_elite_few', name: 'Elite Few vs Many', description: 'High-combat circle defense vs aggressive low-combat chargers.',
        command: '"Defensive circle, these troops are elite, we can hold!"',
        playerFormation: 'defensive_circle' as FormationType, playerBehavior: 'defensive' as BehaviorType,
        enemyFormation: 'scatter' as FormationType, enemyBehavior: 'aggressive' as BehaviorType,
        playerStats: { combat: 9 }, enemyStats: { combat: 3 },
      },
      {
        id: 'tac_fast_flank', name: 'Speed Flank', description: 'Fast troops flank left in column while enemy holds in line.',
        command: '"Column formation, fast flank around their left!"',
        playerFormation: 'column' as FormationType, playerBehavior: 'flank_left' as BehaviorType,
        enemyFormation: 'line' as FormationType, enemyBehavior: 'defensive' as BehaviorType,
        playerStats: { speed: 3.5 },
      },
      {
        id: 'tac_wedge_counter_wedge', name: 'Wedge vs Wedge Joust', description: 'Two wedges charge head-on like jousting knights.',
        command: '"Wedge formation, full charge into their wedge!"',
        playerFormation: 'wedge' as FormationType, playerBehavior: 'aggressive' as BehaviorType,
        enemyFormation: 'wedge' as FormationType, enemyBehavior: 'aggressive' as BehaviorType,
      },
      {
        id: 'tac_slow_squeeze', name: 'Slow Squeeze', description: 'Both sides advance slowly in line, maintaining formation until contact.',
        command: '"Advance slowly, hold the line tight"',
        playerFormation: 'line' as FormationType, playerBehavior: 'advance_slow' as BehaviorType,
        enemyFormation: 'line' as FormationType, enemyBehavior: 'advance_slow' as BehaviorType,
      },
    ],
  },
];

// ─── Canvas Rendering ────────────────────────────────────────────────────────

function drawPlayground(
  ctx: CanvasRenderingContext2D,
  state: PlaygroundState,
  selectedAgent: string | null,
  showSlots: boolean,
  showLabels: boolean,
) {
  const S = CANVAS_SCALE;
  const w = state.width * S;
  const h = state.height * S;

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 30) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Center line
  ctx.strokeStyle = '#2a2a4e';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // Side labels
  ctx.font = 'bold 12px Inter, sans-serif';
  ctx.fillStyle = '#4a5568';
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(14, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = PLAYER_COLOR;
  ctx.globalAlpha = 0.5;
  ctx.fillText('PLAYER', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(w - 14, h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = ENEMY_COLOR;
  ctx.globalAlpha = 0.5;
  ctx.fillText('ENEMY', 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;

  // Draw formation slots (ghost positions)
  if (showSlots) {
    for (const agent of state.agents) {
      if (!agent.alive || agent.type !== 'troop' || !agent.formationSlot) continue;
      const sx = agent.formationSlot.x * S;
      const sy = agent.formationSlot.y * S;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.strokeStyle = SLOT_COLOR;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Line from agent to slot
      const ax = agent.position.x * S;
      const ay = agent.position.y * S;
      const slotDist = dist(agent.position, agent.formationSlot);
      if (slotDist > 2) {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(sx, sy);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // Draw formation shape outlines for each squad
  for (const team of ['player', 'enemy'] as Team[]) {
    const ltId = team === 'player' ? 'lt_player' : 'lt_enemy';
    const lt = state.agents.find(a => a.id === ltId && a.alive);
    if (!lt) continue;

    const troops = state.agents.filter(a => a.lieutenantId === ltId && a.alive);
    if (troops.length < 2) continue;

    const positions = troops.map(t => ({ x: t.position.x * S, y: t.position.y * S }));
    const color = team === 'player' ? PLAYER_COLOR : ENEMY_COLOR;

    // Convex hull outline
    ctx.beginPath();
    const hull = convexHull(positions);
    if (hull.length > 2) {
      ctx.moveTo(hull[0]!.x, hull[0]!.y);
      for (let i = 1; i < hull.length; i++) {
        ctx.lineTo(hull[i]!.x, hull[i]!.y);
      }
      ctx.closePath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.15;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.03;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Draw combat lines
  const alive = state.agents.filter(a => a.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i]!;
      const b = alive[j]!;
      if (a.team === b.team) continue;
      const d = dist(a.position, b.position);
      if (d > COMBAT_RANGE) continue;
      const ax = a.position.x * S;
      const ay = a.position.y * S;
      const bx = b.position.x * S;
      const by = b.position.y * S;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = '#ff4a4a';
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Draw connection lines from troops to lieutenant
  for (const agent of state.agents) {
    if (!agent.alive || agent.type !== 'troop' || !agent.lieutenantId) continue;
    const lt = state.agents.find(a => a.id === agent.lieutenantId && a.alive);
    if (!lt) continue;
    ctx.beginPath();
    ctx.moveTo(lt.position.x * S, lt.position.y * S);
    ctx.lineTo(agent.position.x * S, agent.position.y * S);
    const color = agent.team === 'player' ? PLAYER_COLOR : ENEMY_COLOR;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.06;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Draw agents
  for (const agent of state.agents) {
    if (!agent.alive) continue;
    const x = agent.position.x * S;
    const y = agent.position.y * S;

    const isLt = agent.type === 'lieutenant';
    const isPlayer = agent.team === 'player';
    const isSelected = agent.id === selectedAgent;
    const radius = isLt ? 8 : 5;

    const baseColor = isPlayer
      ? (isLt ? PLAYER_COLOR : PLAYER_TROOP_COLOR)
      : (isLt ? ENEMY_COLOR : ENEMY_TROOP_COLOR);

    const healthRatio = agent.health / agent.maxHealth;
    ctx.globalAlpha = 0.3 + healthRatio * 0.7;

    // Selection highlight
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 0.3 + healthRatio * 0.7;
    }

    // Formation shape indicator
    drawFormationIndicator(ctx, x, y, agent.formation, baseColor, radius);

    // Draw agent body
    if (isLt) {
      // Diamond for lieutenant
      ctx.beginPath();
      ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
      ctx.fillStyle = baseColor;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = baseColor;
      ctx.fill();

      // Action border
      if (agent.currentAction === 'engaging') {
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (agent.currentAction === 'moving' || agent.currentAction === 'falling_back') {
        ctx.strokeStyle = '#ffaa4a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;

    // Health bar
    if (healthRatio < 1) {
      const barW = radius * 2.5;
      const barH = 2;
      const barX = x - barW / 2;
      const barY = y - radius - (isLt ? 16 : 6);
      ctx.fillStyle = '#333';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = healthRatio > 0.5 ? '#4aff6a' : healthRatio > 0.25 ? '#ffaa4a' : '#ff4a4a';
      ctx.fillRect(barX, barY, barW * healthRatio, barH);
    }

    // Labels
    if (showLabels) {
      if (isLt) {
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = baseColor;
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.8;
        ctx.fillText(isPlayer ? 'Lt. Player' : 'Lt. Enemy', x, y - radius - 10);
        ctx.globalAlpha = 1;
      }
    }
  }

  // Dead markers
  for (const agent of state.agents) {
    if (agent.alive) continue;
    const x = agent.position.x * S;
    const y = agent.position.y * S;
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = agent.team === 'player' ? PLAYER_TROOP_COLOR : ENEMY_TROOP_COLOR;
    ctx.lineWidth = 1;
    const s = 3;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Tick + status
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.fillStyle = '#808090';
  ctx.textAlign = 'right';
  ctx.fillText(`Tick ${state.tick}`, w - 10, h - 10);

  // Count alive
  const pAlive = state.agents.filter(a => a.team === 'player' && a.type === 'troop' && a.alive).length;
  const eAlive = state.agents.filter(a => a.team === 'enemy' && a.type === 'troop' && a.alive).length;
  ctx.textAlign = 'left';
  ctx.fillStyle = PLAYER_COLOR;
  ctx.fillText(`Player: ${pAlive}/${SQUAD_SIZE}`, 10, h - 10);
  ctx.fillStyle = ENEMY_COLOR;
  ctx.fillText(`Enemy: ${eAlive}/${SQUAD_SIZE}`, 10, h - 24);
}

function drawFormationIndicator(ctx: CanvasRenderingContext2D, x: number, y: number, formation: string, color: string, radius: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.15;
  ctx.lineWidth = 1;

  switch (formation) {
    case 'wedge':
      ctx.beginPath();
      ctx.moveTo(x, y - radius * 2);
      ctx.lineTo(x - radius * 1.5, y + radius);
      ctx.lineTo(x + radius * 1.5, y + radius);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'defensive_circle':
      ctx.beginPath();
      ctx.arc(x, y, radius * 2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'scatter':
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * radius * 2, y + Math.sin(angle) * radius * 2, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'column':
      ctx.beginPath();
      ctx.moveTo(x, y - radius * 2);
      ctx.lineTo(x, y + radius * 2);
      ctx.stroke();
      break;
    case 'pincer':
      ctx.beginPath();
      ctx.arc(x, y, radius * 2, -Math.PI * 0.7, -Math.PI * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, radius * 2, Math.PI * 0.3, Math.PI * 0.7);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

// Simple convex hull (Graham scan) for formation outlines
function convexHull(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  function cross(o: Vec2, a: Vec2, b: Vec2) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }

  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// ─── Playground Component ────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

export function FormationPlayground({ onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [selectedPresetId, setSelectedPresetId] = useState<string>(PRESET_CATEGORIES[0]!.presets[0]!.id);
  const [simState, setSimState] = useState<PlaygroundState | null>(null);
  const [initialState, setInitialState] = useState<PlaygroundState | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showSlots, setShowSlots] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');

  // Override controls
  const [playerFormationOverride, setPlayerFormationOverride] = useState<FormationType | ''>('');
  const [enemyFormationOverride, setEnemyFormationOverride] = useState<FormationType | ''>('');

  const allPresets = useMemo(() => PRESET_CATEGORIES.flatMap(c => c.presets), []);

  const selectedPreset = useMemo(
    () => allPresets.find(p => p.id === selectedPresetId) || allPresets[0]!,
    [selectedPresetId, allPresets]
  );

  // Load preset
  const loadPreset = useCallback((preset: Preset) => {
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    setIsRunning(false);

    const modified = { ...preset };
    if (playerFormationOverride) modified.playerFormation = playerFormationOverride;
    if (enemyFormationOverride) modified.enemyFormation = enemyFormationOverride;

    const state = createScenario(modified);
    setSimState(state);
    setInitialState(JSON.parse(JSON.stringify(state)));
    setSelectedAgent(null);
  }, [playerFormationOverride, enemyFormationOverride]);

  // Load initial preset on mount
  useEffect(() => {
    loadPreset(selectedPreset);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load on preset change
  useEffect(() => {
    loadPreset(selectedPreset);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPresetId, playerFormationOverride, enemyFormationOverride]);

  // Simulation loop
  useEffect(() => {
    if (isRunning && simState) {
      const tickMs = 100 / speed;
      simIntervalRef.current = setInterval(() => {
        setSimState(prev => {
          if (!prev || !prev.running) return prev;
          const next = stepSimulation(prev);
          // Auto-stop if one side is wiped
          const pAlive = next.agents.filter(a => a.team === 'player' && a.type === 'troop' && a.alive).length;
          const eAlive = next.agents.filter(a => a.team === 'enemy' && a.type === 'troop' && a.alive).length;
          if (pAlive === 0 || eAlive === 0) {
            next.running = false;
            setIsRunning(false);
            if (simIntervalRef.current) clearInterval(simIntervalRef.current);
          }
          return next;
        });
      }, tickMs);

      return () => {
        if (simIntervalRef.current) clearInterval(simIntervalRef.current);
      };
    }
  }, [isRunning, speed, simState?.running]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !simState) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    cancelAnimationFrame(animRef.current);

    function render() {
      if (!ctx || !simState) return;
      drawPlayground(ctx, simState, selectedAgent, showSlots, showLabels);
      animRef.current = requestAnimationFrame(render);
    }
    render();

    return () => cancelAnimationFrame(animRef.current);
  }, [simState, selectedAgent, showSlots, showLabels]);

  // Click to select agent
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!simState) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX / CANVAS_SCALE;
    const my = (e.clientY - rect.top) * scaleY / CANVAS_SCALE;

    let closest: PlaygroundAgent | null = null;
    let closestDist = 20; // click radius in sim units
    for (const agent of simState.agents) {
      if (!agent.alive) continue;
      const d = dist({ x: mx, y: my }, agent.position);
      if (d < closestDist) {
        closestDist = d;
        closest = agent;
      }
    }
    setSelectedAgent(closest?.id || null);
  }, [simState]);

  // Controls
  const handlePlay = () => {
    if (!simState) return;
    setSimState(prev => prev ? { ...prev, running: true } : prev);
    setIsRunning(true);
  };

  const handlePause = () => {
    setIsRunning(false);
    setSimState(prev => prev ? { ...prev, running: false } : prev);
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
  };

  const handleStep = () => {
    if (isRunning) handlePause();
    setSimState(prev => prev ? stepSimulation({ ...prev, running: true }) : prev);
  };

  const handleReset = () => {
    handlePause();
    if (initialState) {
      setSimState(JSON.parse(JSON.stringify(initialState)));
      setSelectedAgent(null);
    }
  };

  // Filter presets
  const filteredCategories = useMemo(() => {
    if (!searchFilter) return PRESET_CATEGORIES;
    const lower = searchFilter.toLowerCase();
    return PRESET_CATEGORIES.map(cat => ({
      ...cat,
      presets: cat.presets.filter(p =>
        p.name.toLowerCase().includes(lower) ||
        p.description.toLowerCase().includes(lower) ||
        (p.command && p.command.toLowerCase().includes(lower))
      ),
    })).filter(cat => cat.presets.length > 0);
  }, [searchFilter]);

  // Inspector data
  const inspectedAgent = simState?.agents.find(a => a.id === selectedAgent) || null;

  const squadStats = useMemo(() => {
    if (!simState) return null;
    const pTroops = simState.agents.filter(a => a.team === 'player' && a.type === 'troop');
    const eTroops = simState.agents.filter(a => a.team === 'enemy' && a.type === 'troop');
    const pAlive = pTroops.filter(a => a.alive);
    const eAlive = eTroops.filter(a => a.alive);

    const avgSlotDist = (troops: PlaygroundAgent[]) => {
      const aliveTroops = troops.filter(t => t.alive && t.formationSlot);
      if (aliveTroops.length === 0) return 0;
      return aliveTroops.reduce((s, t) => s + dist(t.position, t.formationSlot!), 0) / aliveTroops.length;
    };

    return {
      player: { alive: pAlive.length, total: pTroops.length, avgSlotDist: avgSlotDist(pTroops) },
      enemy: { alive: eAlive.length, total: eTroops.length, avgSlotDist: avgSlotDist(eTroops) },
    };
  }, [simState]);

  return (
    <div className="pg-container">
      {/* Left: Preset selector */}
      <div className="pg-sidebar">
        <div className="pg-sidebar-header">
          <button className="pg-back-btn" onClick={onBack}>&larr; Back</button>
          <h2>Formation Playground</h2>
        </div>

        <input
          className="pg-search"
          type="text"
          placeholder="Search presets..."
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
        />

        <div className="pg-overrides">
          <div className="pg-override-row">
            <label>Player Formation:</label>
            <select
              value={playerFormationOverride}
              onChange={e => setPlayerFormationOverride(e.target.value as FormationType | '')}
            >
              <option value="">From Preset</option>
              {FORMATIONS.map(f => <option key={f} value={f}>{FORMATION_LABELS[f]}</option>)}
            </select>
          </div>
          <div className="pg-override-row">
            <label>Enemy Formation:</label>
            <select
              value={enemyFormationOverride}
              onChange={e => setEnemyFormationOverride(e.target.value as FormationType | '')}
            >
              <option value="">From Preset</option>
              {FORMATIONS.map(f => <option key={f} value={f}>{FORMATION_LABELS[f]}</option>)}
            </select>
          </div>
        </div>

        <div className="pg-preset-list">
          {filteredCategories.map(cat => (
            <div key={cat.name} className="pg-preset-category">
              <h3 className="pg-category-header">{cat.name}</h3>
              {cat.presets.map(p => (
                <button
                  key={p.id}
                  className={`pg-preset-btn ${p.id === selectedPresetId ? 'active' : ''}`}
                  onClick={() => setSelectedPresetId(p.id)}
                >
                  <span className="pg-preset-name">{p.name}</span>
                  <span className="pg-preset-desc">{p.description}</span>
                  {p.command && <span className="pg-preset-cmd">{p.command}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Center: Canvas */}
      <div className="pg-main">
        <div className="pg-controls">
          <div className="pg-controls-left">
            {!isRunning ? (
              <button className="pg-ctrl-btn pg-play" onClick={handlePlay}>Play</button>
            ) : (
              <button className="pg-ctrl-btn pg-pause" onClick={handlePause}>Pause</button>
            )}
            <button className="pg-ctrl-btn" onClick={handleStep}>Step</button>
            <button className="pg-ctrl-btn pg-reset" onClick={handleReset}>Reset</button>

            <div className="pg-speed">
              {[0.5, 1, 2, 5].map(s => (
                <button
                  key={s}
                  className={`pg-speed-btn ${speed === s ? 'active' : ''}`}
                  onClick={() => setSpeed(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          <div className="pg-controls-right">
            <label className="pg-toggle">
              <input type="checkbox" checked={showSlots} onChange={e => setShowSlots(e.target.checked)} />
              Slots
            </label>
            <label className="pg-toggle">
              <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
              Labels
            </label>
          </div>
        </div>

        <div className="pg-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={MAP_W * CANVAS_SCALE}
            height={MAP_H * CANVAS_SCALE}
            className="pg-canvas"
            onClick={handleCanvasClick}
          />
        </div>

        {/* Preset info bar */}
        <div className="pg-info-bar">
          <div className="pg-info-side pg-info-player">
            <span className="pg-info-label">Player</span>
            <span className="pg-info-formation">{FORMATION_LABELS[selectedPreset.playerFormation]}</span>
            <span className="pg-info-behavior">{selectedPreset.playerBehavior}</span>
            {squadStats && (
              <span className="pg-info-stats">
                {squadStats.player.alive}/{squadStats.player.total} alive | Drift: {squadStats.player.avgSlotDist.toFixed(1)}
              </span>
            )}
          </div>
          <div className="pg-info-vs">VS</div>
          <div className="pg-info-side pg-info-enemy">
            <span className="pg-info-label">Enemy</span>
            <span className="pg-info-formation">{FORMATION_LABELS[selectedPreset.enemyFormation]}</span>
            <span className="pg-info-behavior">{selectedPreset.enemyBehavior}</span>
            {squadStats && (
              <span className="pg-info-stats">
                {squadStats.enemy.alive}/{squadStats.enemy.total} alive | Drift: {squadStats.enemy.avgSlotDist.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: Inspector */}
      <div className="pg-inspector">
        <h3>Inspector</h3>
        {inspectedAgent ? (
          <div className="pg-agent-info">
            <div className="pg-agent-header">
              <span
                className="pg-agent-dot"
                style={{ background: inspectedAgent.team === 'player' ? PLAYER_COLOR : ENEMY_COLOR }}
              />
              <span className="pg-agent-id">{inspectedAgent.id}</span>
            </div>

            <div className="pg-field">
              <span className="pg-field-label">Type</span>
              <span className="pg-field-value">{inspectedAgent.type}</span>
            </div>
            <div className="pg-field">
              <span className="pg-field-label">Team</span>
              <span className="pg-field-value">{inspectedAgent.team}</span>
            </div>
            <div className="pg-field">
              <span className="pg-field-label">Position</span>
              <span className="pg-field-value">({inspectedAgent.position.x.toFixed(1)}, {inspectedAgent.position.y.toFixed(1)})</span>
            </div>
            {inspectedAgent.formationSlot && (
              <>
                <div className="pg-field">
                  <span className="pg-field-label">Slot Target</span>
                  <span className="pg-field-value">({inspectedAgent.formationSlot.x.toFixed(1)}, {inspectedAgent.formationSlot.y.toFixed(1)})</span>
                </div>
                <div className="pg-field">
                  <span className="pg-field-label">Slot Distance</span>
                  <span className="pg-field-value pg-drift">{dist(inspectedAgent.position, inspectedAgent.formationSlot).toFixed(1)}</span>
                </div>
              </>
            )}
            <div className="pg-field">
              <span className="pg-field-label">Health</span>
              <span className="pg-field-value">{inspectedAgent.health}/{inspectedAgent.maxHealth}</span>
            </div>
            <div className="pg-field">
              <span className="pg-field-label">Formation</span>
              <span className="pg-field-value">{FORMATION_LABELS[inspectedAgent.formation]}</span>
            </div>
            <div className="pg-field">
              <span className="pg-field-label">Behavior</span>
              <span className="pg-field-value">{inspectedAgent.behavior}</span>
            </div>
            <div className="pg-field">
              <span className="pg-field-label">Action</span>
              <span className="pg-field-value">{inspectedAgent.currentAction}</span>
            </div>
            <div className="pg-field">
              <span className="pg-field-label">Combat</span>
              <span className="pg-field-value">{inspectedAgent.combat}</span>
            </div>
            <div className="pg-field">
              <span className="pg-field-label">Speed</span>
              <span className="pg-field-value">{inspectedAgent.speed}</span>
            </div>
            <div className="pg-field">
              <span className="pg-field-label">Alive</span>
              <span className="pg-field-value">{inspectedAgent.alive ? 'Yes' : 'Dead'}</span>
            </div>
          </div>
        ) : (
          <div className="pg-no-selection">
            <p>Click a unit on the canvas to inspect it.</p>
            <p className="pg-hint">Formation slots shown as hollow circles. Lines show distance from ideal position (drift).</p>
          </div>
        )}

        {/* Quick squad overview */}
        {simState && (
          <div className="pg-squad-overview">
            <h4>Squad Overview</h4>
            {(['player', 'enemy'] as Team[]).map(team => {
              const troops = simState.agents.filter(a => a.team === team && a.type === 'troop');
              const aliveTroops = troops.filter(a => a.alive);
              const avgHealth = aliveTroops.length > 0
                ? aliveTroops.reduce((s, t) => s + t.health, 0) / aliveTroops.length
                : 0;
              return (
                <div key={team} className="pg-squad-row">
                  <span
                    className="pg-squad-dot"
                    style={{ background: team === 'player' ? PLAYER_COLOR : ENEMY_COLOR }}
                  />
                  <span className="pg-squad-team">{team}</span>
                  <span className="pg-squad-stat">{aliveTroops.length}/{troops.length}</span>
                  <div className="pg-squad-bar-wrap">
                    <div
                      className="pg-squad-bar"
                      style={{
                        width: `${(aliveTroops.length / Math.max(troops.length, 1)) * 100}%`,
                        background: team === 'player' ? PLAYER_COLOR : ENEMY_COLOR,
                      }}
                    />
                  </div>
                  <span className="pg-squad-hp">HP: {avgHealth.toFixed(0)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
