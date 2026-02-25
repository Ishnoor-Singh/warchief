// Flowchart runtime - executes the logic that lieutenants compile for troops
// Troops are flowchart agents: fast, deterministic, dumb

import { GameEvent, GameAction, EventType } from '../../shared/events/index.js';
import { Vec2 } from '../../shared/types/index.js';

// A node in the flowchart - the basic unit of logic
export interface FlowchartNode {
  id: string;
  on: EventType;              // which event triggers this node
  condition?: string;         // simple expression, e.g. "distance < 50"
  action: GameAction;         // what to do when triggered
  next?: string;              // node id to chain to after action
  else?: string;              // node id if condition fails
  priority?: number;          // higher priority nodes checked first (default 0)
}

// A complete flowchart for an agent
export interface Flowchart {
  agentId: string;
  nodes: FlowchartNode[];
  defaultAction: GameAction;  // fallback when no node matches
}

// Runtime state for an executing flowchart
export interface FlowchartRuntime {
  flowchart: Flowchart;
  currentNodeId: string | null;
  eventQueue: GameEvent[];
  pendingActions: GameAction[];
}

// Simple expression evaluator for conditions
// Supports: <, >, <=, >=, ==, !=, &&, ||
// Variables come from event data
export function evaluateCondition(condition: string, event: GameEvent): boolean {
  if (!condition) return true;
  
  // Build context from event
  const context: Record<string, unknown> = { ...event };
  
  // Very simple expression parser
  // In production, use a proper parser or sandbox
  try {
    // Replace variable names with values
    let expr = condition;
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'number') {
        expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), String(value));
      } else if (typeof value === 'string') {
        expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), `"${value}"`);
      }
    }
    
    // Safe eval for simple numeric/boolean expressions
    // Only allow: numbers, comparison operators, logical operators, parens
    if (!/^[\d\s.<>=!&|()"\w-]+$/.test(expr)) {
      console.warn(`Unsafe condition rejected: ${condition}`);
      return false;
    }
    
    // eslint-disable-next-line no-eval
    return Boolean(eval(expr));
  } catch (e) {
    console.warn(`Failed to evaluate condition "${condition}":`, e);
    return false;
  }
}

// Create a new flowchart runtime
export function createFlowchartRuntime(flowchart: Flowchart): FlowchartRuntime {
  return {
    flowchart,
    currentNodeId: null,
    eventQueue: [],
    pendingActions: [],
  };
}

// Queue an event for processing
export function queueEvent(runtime: FlowchartRuntime, event: GameEvent): void {
  runtime.eventQueue.push(event);
}

// Process all queued events and return resulting actions
export function processEvents(runtime: FlowchartRuntime): GameAction[] {
  const actions: GameAction[] = [];

  while (runtime.eventQueue.length > 0) {
    const event = runtime.eventQueue.shift()!;
    const result = processEvent(runtime, event);
    actions.push(...result);
  }

  return actions;
}

// Process a single event through the flowchart
function processEvent(runtime: FlowchartRuntime, event: GameEvent): GameAction[] {
  const { flowchart } = runtime;

  // Find all nodes that match this event type, sorted by priority
  const matchingNodes = flowchart.nodes
    .filter(node => node.on === event.type)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // Try each node until one matches
  for (const node of matchingNodes) {
    if (evaluateCondition(node.condition || '', event)) {
      runtime.currentNodeId = node.id;
      const actions: GameAction[] = [node.action];

      // Follow next chain (with depth limit to prevent infinite loops)
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
      // Condition failed — follow else branch
      const elseNode = flowchart.nodes.find(n => n.id === node.else);
      if (elseNode) {
        runtime.currentNodeId = elseNode.id;
        return [elseNode.action];
      }
    }
  }

  // No matching node - use default action for certain events
  if (event.type === 'under_attack' || event.type === 'enemy_spotted') {
    return [flowchart.defaultAction];
  }

  return [];
}

// Helper to create common flowcharts for testing

export function createEngageOnSightFlowchart(agentId: string, advanceTarget?: Vec2): Flowchart {
  return {
    agentId,
    nodes: [
      {
        id: 'engage_spotted',
        on: 'enemy_spotted',
        condition: 'distance < 100',
        action: { type: 'engage', targetId: '' },  // targetId filled at runtime
        priority: 10,
      },
      {
        id: 'move_to_spotted',
        on: 'enemy_spotted',
        condition: 'distance >= 100',
        action: { type: 'moveTo', position: { x: 0, y: 0 } },  // position filled at runtime
        priority: 5,
      },
      {
        id: 'hold_on_attack',
        on: 'under_attack',
        action: { type: 'engage', targetId: '' },
        priority: 10,
      },
      // Advance toward center when no enemies visible
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

// Create a personality-appropriate default flowchart for a lieutenant's troops.
// Used when no briefing is provided, so troops always have meaningful behavior
// that reflects their lieutenant's personality.
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

// Default flowchart for a lieutenant agent — keeps them alive in the sim
// with no troop-style behavior; self_directives from LLM output replace this
export function createLieutenantDefaultFlowchart(agentId: string): Flowchart {
  return {
    agentId,
    nodes: [],
    defaultAction: { type: 'hold' },
  };
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
