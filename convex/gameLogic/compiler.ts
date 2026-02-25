// Flowchart compiler: converts validated LieutenantOutput into runtime flowcharts

import { Flowchart, FlowchartNode } from './flowchart';
import { LieutenantOutput, FlowchartDirective, FlowchartNodeInput } from './validation';
import { GameAction, EventType } from './events';

export interface CompiledFlowcharts {
  flowcharts: Record<string, Flowchart>;
  errors: string[];
}

export function resolveUnitPattern(pattern: string, availableUnits: string[]): string[] {
  if (pattern === 'all') {
    return [...availableUnits];
  }

  if (pattern.includes('*')) {
    const prefix = pattern.replace('*', '');
    return availableUnits.filter(u => u.startsWith(prefix));
  }

  if (availableUnits.includes(pattern)) {
    return [pattern];
  }

  return [];
}

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

function compileDirectiveForUnit(
  directive: FlowchartDirective,
  unitId: string,
  existing: Flowchart | undefined
): Flowchart {
  const nodes = directive.nodes.map(convertNode);

  if (existing) {
    return {
      ...existing,
      nodes: [...existing.nodes, ...nodes],
    };
  }

  return {
    agentId: unitId,
    nodes,
    defaultAction: { type: 'hold' },
  };
}

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

export function applyFlowcharts(
  compiled: CompiledFlowcharts,
  runtimes: Record<string, { flowchart: Flowchart }>
): void {
  for (const [unitId, flowchart] of Object.entries(compiled.flowcharts)) {
    const runtime = runtimes[unitId];
    if (runtime) {
      runtime.flowchart = flowchart;
    }
  }
}
