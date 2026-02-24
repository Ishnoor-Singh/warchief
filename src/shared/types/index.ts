// Core types for Warchief simulation

export interface Vec2 {
  x: number;
  y: number;
}

export type FormationType = 'line' | 'wedge' | 'scatter' | 'pincer' | 'defensive_circle' | 'column';

export type Team = 'player' | 'enemy';

// Stats for troops
export interface TroopStats {
  combat: number;      // attack/defense effectiveness (1-10)
  speed: number;       // movement rate (units per tick)
  courage: number;     // threshold before breaking formation (1-10)
  discipline: number;  // how precisely they execute flowchart logic (1-10)
}

// Stats for lieutenants
export interface LieutenantStats {
  initiative: number;     // likelihood of acting without explicit orders (1-10)
  discipline: number;     // how literally they interpret orders (1-10)
  communication: number;  // quality/frequency of reports upward (1-10)
}

export type AgentType = 'troop' | 'lieutenant';

export interface AgentState {
  id: string;
  type: AgentType;
  team: Team;
  position: Vec2;
  health: number;        // 0-100
  maxHealth: number;
  morale: number;        // 0-100, affects courage checks
  currentAction: string | null;
  targetPosition: Vec2 | null;
  targetId: string | null;
  formation: FormationType;
  visibilityRadius: number;
  stats: TroopStats | LieutenantStats;
  lieutenantId: string | null;  // for troops, who commands them
  squadId: string | null;       // grouping within a lieutenant's command
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
  agents: Map<string, AgentState>;
  width: number;
  height: number;
  running: boolean;
  winner: Team | null;
}

// Combat result
export interface CombatResult {
  attackerId: string;
  defenderId: string;
  damage: number;
  defenderDied: boolean;
}

// Visibility info for an agent
export interface VisibleEnemy {
  enemyId: string;
  position: Vec2;
  distance: number;
}
