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
    const action = processEvent(runtime, event);
    if (action) {
      actions.push(action);
    }
  }
  
  return actions;
}

// Process a single event through the flowchart
function processEvent(runtime: FlowchartRuntime, event: GameEvent): GameAction | null {
  const { flowchart } = runtime;
  
  // Find all nodes that match this event type, sorted by priority
  const matchingNodes = flowchart.nodes
    .filter(node => node.on === event.type)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  
  // Try each node until one matches
  for (const node of matchingNodes) {
    if (evaluateCondition(node.condition || '', event)) {
      runtime.currentNodeId = node.id;
      
      // Execute the action
      const action = node.action;
      
      // If there's a chained node, queue a synthetic event to trigger it
      // (This is simplified - real impl might need more sophistication)
      
      return action;
    }
  }
  
  // No matching node - use default action for certain events
  if (event.type === 'under_attack' || event.type === 'enemy_spotted') {
    return flowchart.defaultAction;
  }
  
  return null;
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
