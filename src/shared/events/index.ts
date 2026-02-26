// Event system - the core primitive for agent behavior
// Lieutenants write in this vocabulary, troops execute it

import { Vec2, FormationType } from '../types/index.js';

// Events that can be received by an agent
export type EventType =
  | 'enemy_spotted'
  | 'under_attack'
  | 'flanked'
  | 'message'
  | 'ally_down'
  | 'casualty_threshold'
  | 'order_received'
  | 'tick'  // internal, fires every sim tick
  | 'arrived'  // reached target position
  | 'no_enemies_visible'  // all visible enemies gone
  | 'formation_broken'  // formation disrupted by casualties or engagement
  | 'morale_low'  // squad morale dropped below threshold
  | 'enemy_retreating'  // visible enemy is routing
  | 'terrain_entered'  // unit moved into a terrain feature
  | 'terrain_exited';  // unit left a terrain feature

export interface EnemySpottedEvent {
  type: 'enemy_spotted';
  enemyId: string;
  position: Vec2;
  distance: number;
}

export interface UnderAttackEvent {
  type: 'under_attack';
  attackerId: string;
  damage: number;
}

export interface FlankedEvent {
  type: 'flanked';
  direction: 'left' | 'right' | 'rear';
}

export interface MessageEvent {
  type: 'message';
  from: string;
  content: string;
}

export interface AllyDownEvent {
  type: 'ally_down';
  unitId: string;
  position: Vec2;
}

export interface CasualtyThresholdEvent {
  type: 'casualty_threshold';
  lossPercent: number;
}

export interface OrderReceivedEvent {
  type: 'order_received';
  order: string;
  from: string;
}

export interface TickEvent {
  type: 'tick';
  tick: number;
}

export interface ArrivedEvent {
  type: 'arrived';
  position: Vec2;
}

export interface NoEnemiesVisibleEvent {
  type: 'no_enemies_visible';
}

export interface FormationBrokenEvent {
  type: 'formation_broken';
  reason: 'casualties' | 'engagement' | 'routing';
  intactPercent: number;  // 0-100, how much of the formation is still intact
}

export interface MoraleLowEvent {
  type: 'morale_low';
  averageMorale: number;  // squad average morale 0-100
  lowestMorale: number;   // worst individual morale in the squad
}

export interface EnemyRetreatingEvent {
  type: 'enemy_retreating';
  enemyId: string;
  position: Vec2;
  distance: number;
}

export interface TerrainEnteredEvent {
  type: 'terrain_entered';
  terrainType: 'hill' | 'forest' | 'river';
  position: Vec2;
}

export interface TerrainExitedEvent {
  type: 'terrain_exited';
  terrainType: 'hill' | 'forest' | 'river';
  position: Vec2;
}

export type GameEvent =
  | EnemySpottedEvent
  | UnderAttackEvent
  | FlankedEvent
  | MessageEvent
  | AllyDownEvent
  | CasualtyThresholdEvent
  | OrderReceivedEvent
  | TickEvent
  | ArrivedEvent
  | NoEnemiesVisibleEvent
  | FormationBrokenEvent
  | MoraleLowEvent
  | EnemyRetreatingEvent
  | TerrainEnteredEvent
  | TerrainExitedEvent;

// Actions an agent can take
export type ActionType = 
  | 'moveTo'
  | 'setFormation'
  | 'engage'
  | 'fallback'
  | 'hold'
  | 'requestSupport'
  | 'emit';

export interface MoveToAction {
  type: 'moveTo';
  position: Vec2;
}

export interface SetFormationAction {
  type: 'setFormation';
  formation: FormationType;
}

export interface EngageAction {
  type: 'engage';
  targetId: string;
}

export interface FallbackAction {
  type: 'fallback';
  position: Vec2;
}

export interface HoldAction {
  type: 'hold';
}

export interface RequestSupportAction {
  type: 'requestSupport';
  message: string;
}

export interface EmitAction {
  type: 'emit';
  eventType: 'report' | 'alert';
  message: string;
}

export type GameAction = 
  | MoveToAction
  | SetFormationAction
  | EngageAction
  | FallbackAction
  | HoldAction
  | RequestSupportAction
  | EmitAction;
