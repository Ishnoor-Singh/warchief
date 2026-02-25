// Flowchart runtime - executes the logic that lieutenants compile for troops

import { GameEvent, GameAction, EventType } from './events';
import { Vec2 } from './types';

export interface FlowchartNode {
  id: string;
  on: EventType;
  condition?: string;
  action: GameAction;
  next?: string;
  else?: string;
  priority?: number;
}

export interface Flowchart {
  agentId: string;
  nodes: FlowchartNode[];
  defaultAction: GameAction;
}

export interface FlowchartRuntime {
  flowchart: Flowchart;
  currentNodeId: string | null;
  eventQueue: GameEvent[];
  pendingActions: GameAction[];
}

// Simple expression evaluator for conditions
export function evaluateCondition(condition: string, event: GameEvent): boolean {
  if (!condition) return true;

  const context: Record<string, unknown> = { ...event };

  try {
    let expr = condition;
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'number') {
        expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), String(value));
      } else if (typeof value === 'string') {
        expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), `"${value}"`);
      }
    }

    if (!/^[\d\s.<>=!&|()"\w-]+$/.test(expr)) {
      return false;
    }

    // eslint-disable-next-line no-eval
    return Boolean(eval(expr));
  } catch {
    return false;
  }
}

export function createFlowchartRuntime(flowchart: Flowchart): FlowchartRuntime {
  return {
    flowchart,
    currentNodeId: null,
    eventQueue: [],
    pendingActions: [],
  };
}

export function queueEvent(runtime: FlowchartRuntime, event: GameEvent): void {
  runtime.eventQueue.push(event);
}

export function processEvents(runtime: FlowchartRuntime): GameAction[] {
  const actions: GameAction[] = [];

  while (runtime.eventQueue.length > 0) {
    const event = runtime.eventQueue.shift()!;
    const result = processEvent(runtime, event);
    actions.push(...result);
  }

  return actions;
}

function processEvent(runtime: FlowchartRuntime, event: GameEvent): GameAction[] {
  const { flowchart } = runtime;

  const matchingNodes = flowchart.nodes
    .filter(node => node.on === event.type)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const node of matchingNodes) {
    if (evaluateCondition(node.condition || '', event)) {
      runtime.currentNodeId = node.id;
      const actions: GameAction[] = [node.action];

      let nextId = node.next;
      let depth = 0;
      while (nextId && depth < 10) {
        const nextNode = flowchart.nodes.find(n => n.id === nextId);
        if (!nextNode) break;

        runtime.currentNodeId = nextNode.id;
        if (!nextNode.condition || evaluateCondition(nextNode.condition, event)) {
          actions.push(nextNode.action);
          nextId = nextNode.next;
        } else {
          nextId = nextNode.else;
        }
        depth++;
      }

      return actions;
    } else if (node.else) {
      const elseNode = flowchart.nodes.find(n => n.id === node.else);
      if (elseNode) {
        runtime.currentNodeId = elseNode.id;
        return [elseNode.action];
      }
    }
  }

  if (event.type === 'under_attack' || event.type === 'enemy_spotted') {
    return [flowchart.defaultAction];
  }

  return [];
}

// Common flowchart templates

export function createEngageOnSightFlowchart(agentId: string, advanceTarget?: Vec2): Flowchart {
  return {
    agentId,
    nodes: [
      {
        id: 'engage_spotted',
        on: 'enemy_spotted',
        condition: 'distance < 100',
        action: { type: 'engage', targetId: '' },
        priority: 10,
      },
      {
        id: 'move_to_spotted',
        on: 'enemy_spotted',
        condition: 'distance >= 100',
        action: { type: 'moveTo', position: { x: 0, y: 0 } },
        priority: 5,
      },
      {
        id: 'hold_on_attack',
        on: 'under_attack',
        action: { type: 'engage', targetId: '' },
        priority: 10,
      },
      {
        id: 'advance_default',
        on: 'no_enemies_visible',
        action: { type: 'moveTo', position: advanceTarget || { x: 200, y: 150 } },
        priority: 1,
      },
    ],
    defaultAction: { type: 'hold' },
  };
}

export function createHoldPositionFlowchart(agentId: string): Flowchart {
  return {
    agentId,
    nodes: [
      {
        id: 'engage_close_enemy',
        on: 'enemy_spotted',
        condition: 'distance < 30',
        action: { type: 'engage', targetId: '' },
        priority: 1,
      },
      {
        id: 'defend_on_attack',
        on: 'under_attack',
        action: { type: 'engage', targetId: '' },
        priority: 1,
      },
    ],
    defaultAction: { type: 'hold' },
  };
}

export function createPersonalityFlowchart(
  agentId: string,
  personality: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive',
  advanceTarget?: Vec2
): Flowchart {
  const target = advanceTarget || { x: 200, y: 150 };

  switch (personality) {
    case 'aggressive':
      return {
        agentId,
        nodes: [
          { id: 'engage_spotted', on: 'enemy_spotted', action: { type: 'engage', targetId: '' }, priority: 10 },
          { id: 'counter_attack', on: 'under_attack', action: { type: 'engage', targetId: '' }, priority: 10 },
          { id: 'advance', on: 'no_enemies_visible', action: { type: 'moveTo', position: target }, priority: 5 },
          { id: 'push_on_ally_down', on: 'ally_down', action: { type: 'engage', targetId: '' }, priority: 3 },
        ],
        defaultAction: { type: 'hold' },
      };

    case 'cautious':
      return {
        agentId,
        nodes: [
          { id: 'engage_close', on: 'enemy_spotted', condition: 'distance < 40', action: { type: 'engage', targetId: '' }, priority: 10 },
          { id: 'hold_far', on: 'enemy_spotted', condition: 'distance >= 40', action: { type: 'hold' }, priority: 5 },
          { id: 'defend', on: 'under_attack', action: { type: 'engage', targetId: '' }, priority: 8 },
          { id: 'report_losses', on: 'casualty_threshold', condition: 'lossPercent > 20', action: { type: 'requestSupport', message: 'Taking casualties, requesting support' }, priority: 7 },
          { id: 'slow_advance', on: 'no_enemies_visible', action: { type: 'moveTo', position: target }, priority: 1 },
        ],
        defaultAction: { type: 'hold' },
      };

    case 'disciplined':
      return {
        agentId,
        nodes: [
          { id: 'engage_medium', on: 'enemy_spotted', condition: 'distance < 60', action: { type: 'engage', targetId: '' }, priority: 10 },
          { id: 'hold_position', on: 'enemy_spotted', condition: 'distance >= 60', action: { type: 'hold' }, priority: 5 },
          { id: 'defend_formation', on: 'under_attack', action: { type: 'engage', targetId: '' }, priority: 8 },
          { id: 'maintain_line', on: 'no_enemies_visible', action: { type: 'setFormation', formation: 'line' }, priority: 2 },
          { id: 'advance_ordered', on: 'no_enemies_visible', action: { type: 'moveTo', position: target }, priority: 1 },
        ],
        defaultAction: { type: 'hold' },
      };

    case 'impulsive':
      return {
        agentId,
        nodes: [
          { id: 'charge', on: 'enemy_spotted', action: { type: 'engage', targetId: '' }, priority: 10 },
          { id: 'fight_back', on: 'under_attack', action: { type: 'engage', targetId: '' }, priority: 10 },
          { id: 'rush_forward', on: 'no_enemies_visible', action: { type: 'moveTo', position: target }, priority: 5 },
          { id: 'scatter_on_flank', on: 'flanked', action: { type: 'setFormation', formation: 'scatter' }, priority: 8 },
        ],
        defaultAction: { type: 'hold' },
      };
  }
}

export function createFallbackFlowchart(agentId: string, fallbackPosition: Vec2): Flowchart {
  return {
    agentId,
    nodes: [
      {
        id: 'fallback_on_attack',
        on: 'under_attack',
        action: { type: 'fallback', position: fallbackPosition },
        priority: 2,
      },
      {
        id: 'fallback_on_casualty',
        on: 'casualty_threshold',
        condition: 'lossPercent > 30',
        action: { type: 'fallback', position: fallbackPosition },
        priority: 1,
      },
    ],
    defaultAction: { type: 'hold' },
  };
}
