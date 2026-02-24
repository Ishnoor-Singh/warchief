// Flowchart compiler: converts validated LieutenantOutput into runtime flowcharts

import { Flowchart, FlowchartNode } from '../runtime/flowchart.js';
import { LieutenantOutput, FlowchartDirective, FlowchartNodeInput } from './schema.js';
import { GameAction } from '../../shared/events/index.js';
import { EventType } from '../../shared/events/index.js';

export interface CompiledFlowcharts {
  flowcharts: Record<string, Flowchart>;
  errors: string[];
}

// Resolve unit pattern to actual unit ids
export function resolveUnitPattern(pattern: string, availableUnits: string[]): string[] {
  if (pattern === 'all') {
    return [...availableUnits];
  }
  
  if (pattern.includes('*')) {
    // Wildcard pattern like "p_s1_*"
    const prefix = pattern.replace('*', '');
    return availableUnits.filter(u => u.startsWith(prefix));
  }
  
  // Specific unit id
  if (availableUnits.includes(pattern)) {
    return [pattern];
  }
  
  return [];
}

// Convert schema node to runtime node
function convertNode(input: FlowchartNodeInput): FlowchartNode {
  return {
    id: input.id,
    on: input.on as EventType,
    condition: input.condition,
    action: input.action as GameAction,
    next: input.next,
    else: input.else,
    priority: input.priority,
  };
}

// Compile a single directive for a specific unit
function compileDirectiveForUnit(
  directive: FlowchartDirective,
  unitId: string,
  existing: Flowchart | undefined
): Flowchart {
  const nodes = directive.nodes.map(convertNode);
  
  if (existing) {
    // Merge nodes into existing flowchart
    return {
      ...existing,
      nodes: [...existing.nodes, ...nodes],
    };
  }
  
  // Create new flowchart
  return {
    agentId: unitId,
    nodes,
    defaultAction: { type: 'hold' },
  };
}

// Compile all directives from lieutenant output
export function compileDirectives(
  output: LieutenantOutput,
  availableUnits: string[]
): CompiledFlowcharts {
  const flowcharts: Record<string, Flowchart> = {};
  const errors: string[] = [];
  
  for (const directive of output.directives) {
    const targetUnits = resolveUnitPattern(directive.unit, availableUnits);
    
    if (targetUnits.length === 0) {
      errors.push(`No units matched pattern: ${directive.unit}`);
      continue;
    }
    
    for (const unitId of targetUnits) {
      flowcharts[unitId] = compileDirectiveForUnit(
        directive,
        unitId,
        flowcharts[unitId]
      );
    }
  }
  
  return { flowcharts, errors };
}

// Apply compiled flowcharts to simulation runtime
export function applyFlowcharts(
  compiled: CompiledFlowcharts,
  runtimes: Map<string, { flowchart: Flowchart }>
): void {
  for (const [unitId, flowchart] of Object.entries(compiled.flowcharts)) {
    const runtime = runtimes.get(unitId);
    if (runtime) {
      // Replace the flowchart (could merge if we wanted incremental updates)
      runtime.flowchart = flowchart;
    }
  }
}
