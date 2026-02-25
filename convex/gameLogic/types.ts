// Core types for Warchief simulation (Convex-compatible, no Maps)

export interface Vec2 {
  x: number;
  y: number;
}

export type FormationType = 'line' | 'wedge' | 'scatter' | 'pincer' | 'defensive_circle' | 'column';

export type Team = 'player' | 'enemy';

export interface TroopStats {
  combat: number;
  speed: number;
  courage: number;
  discipline: number;
}

export interface LieutenantStats {
  initiative: number;
  discipline: number;
  communication: number;
}

export type AgentType = 'troop' | 'lieutenant';

export interface AgentState {
  id: string;
  type: AgentType;
  team: Team;
  position: Vec2;
  health: number;
  maxHealth: number;
  morale: number;
  currentAction: string | null;
  targetPosition: Vec2 | null;
  targetId: string | null;
  formation: FormationType;
  visibilityRadius: number;
  stats: TroopStats | LieutenantStats;
  lieutenantId: string | null;
  squadId: string | null;
  alive: boolean;
}

export interface TroopAgent extends AgentState {
  type: 'troop';
  stats: TroopStats;
  lieutenantId: string;
  squadId: string;
}

export interface LieutenantAgent extends AgentState {
  type: 'lieutenant';
  stats: LieutenantStats;
  personality: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
  name: string;
  troopIds: string[];
}

export interface BattleState {
  tick: number;
  agents: Record<string, AgentState>;
  width: number;
  height: number;
  running: boolean;
  winner: Team | null;
}

export interface CombatResult {
  attackerId: string;
  defenderId: string;
  damage: number;
  defenderDied: boolean;
}

export interface VisibleEnemy {
  enemyId: string;
  position: Vec2;
  distance: number;
}
