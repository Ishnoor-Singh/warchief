// Shared types between client and server (duplicated for now, will share later)

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
}

export interface BattleState {
  tick: number;
  agents: AgentState[];
  width: number;
  height: number;
  running: boolean;
  winner: Team | null;
}

export interface Lieutenant {
  id: string;
  name: string;
  personality: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
  troopIds: string[];
  busy: boolean;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
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

// WebSocket message types
export type WSMessage = 
  | { type: 'state'; data: BattleState }
  | { type: 'message'; data: Message }
  | { type: 'flowchart'; data: { lieutenantId: string; flowcharts: Record<string, Flowchart> } }
  | { type: 'connected'; data: { lieutenants: Lieutenant[] } };

export type WSCommand =
  | { type: 'order'; lieutenantId: string; order: string }
  | { type: 'start_battle' }
  | { type: 'pause_battle' };
