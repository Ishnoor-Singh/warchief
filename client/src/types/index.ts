// Shared types between client and server

export interface Vec2 {
  x: number;
  y: number;
}

export type Team = 'player' | 'enemy';
export type FormationType = 'line' | 'wedge' | 'scatter' | 'pincer' | 'defensive_circle' | 'column';

export interface AgentState {
  id: string;
  type: 'troop' | 'lieutenant';
  team: Team;
  position: Vec2;
  health: number;
  maxHealth: number;
  morale: number;
  currentAction: string | null;
  formation: FormationType;
  alive: boolean;
  lieutenantId: string | null;
}

export interface VisibilityZone {
  position: Vec2;
  radius: number;
}

export interface BattleState {
  tick: number;
  agents: AgentState[];
  width: number;
  height: number;
  running: boolean;
  winner: Team | null;
  visibilityZones?: VisibilityZone[];
  activeNodes?: Record<string, string | null>;
}

export interface LieutenantStats {
  initiative: number;
  discipline: number;
  communication: number;
}

export interface Lieutenant {
  id: string;
  name: string;
  personality: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
  troopIds: string[];
  busy: boolean;
  stats?: LieutenantStats;
}

export interface Model {
  id: string;
  name: string;
  default?: boolean;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  tick?: number;
  type: 'order' | 'report' | 'alert';
}

export interface FlowchartNode {
  id: string;
  on: string;
  condition?: string;
  action: { type: string; [key: string]: unknown };
  priority?: number;
}

export interface Flowchart {
  agentId: string;
  nodes: FlowchartNode[];
}

export interface DetailedBattleSummary {
  tick: number;
  durationSeconds: number;
  winner: Team | null;
  player: { alive: number; dead: number; total: number };
  enemy: { alive: number; dead: number; total: number };
}

export type GameMode = 'human_vs_ai' | 'ai_vs_ai';

// Battle events for the event ticker
export interface BattleEvent {
  type: 'kill' | 'engagement' | 'retreat' | 'squad_wiped' | 'casualty_milestone';
  tick: number;
  team: Team;
  message: string;
  position?: Vec2;
}
