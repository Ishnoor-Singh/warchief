// Lieutenant data types and helpers (no LLM client - that's in convex actions)

import { LieutenantStats } from './types';
import { RecentMessage } from './inputBuilder';
import { LieutenantOutput } from './validation';

export interface LieutenantConfig {
  id: string;
  name: string;
  personality: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
  stats: LieutenantStats;
  troopIds: string[];
  authorizedPeers: string[];
}

export interface Lieutenant {
  id: string;
  name: string;
  personality: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
  stats: LieutenantStats;
  troopIds: string[];
  authorizedPeers: string[];
  messageHistory: RecentMessage[];
  busy: boolean;
  lastOutput: LieutenantOutput | null;
}

export interface OrderContext {
  currentOrders: string;
  visibleUnits: Array<{ id: string; position: { x: number; y: number }; health: number; morale: number }>;
  visibleEnemies?: Array<{ id: string; position: { x: number; y: number }; distance: number }>;
  terrain: string;
}

export function createLieutenant(config: LieutenantConfig): Lieutenant {
  return {
    id: config.id,
    name: config.name,
    personality: config.personality,
    stats: config.stats,
    troopIds: config.troopIds,
    authorizedPeers: config.authorizedPeers,
    messageHistory: [],
    busy: false,
    lastOutput: null,
  };
}
