/**
 * Message routing integration tests — TDD red phase.
 *
 * Tests that the simulation properly routes messages through the bus:
 * - requestSupport → lieutenant's bus queue
 * - peer messages between lieutenants
 * - stalemate warnings broadcast to all lieutenants
 */

import { describe, it, expect } from 'vitest';
import {
  createSimulation,
  simulationTick,
  type SimulationState,
} from './simulation.js';
import { createBasicScenario } from './scenario.js';
import { drainFor, send, type BusMessage } from '../comms/message-bus.js';

function tickN(sim: SimulationState, n: number): void {
  for (let i = 0; i < n; i++) simulationTick(sim);
}

describe('Message routing in simulation', () => {
  it('simulation state should have a message bus', () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
    expect(sim.messageBus).toBeDefined();
    expect(sim.messageBus.queue).toEqual([]);
  });

  it('requestSupport action should enqueue a message to the lieutenant', () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

    // Find a player troop and its lieutenant
    const troop = Array.from(sim.battle.agents.values()).find(
      a => a.team === 'player' && a.type === 'troop' && a.alive
    )!;
    const ltId = troop.lieutenantId!;

    // Override the troop's flowchart to always request support on tick
    const runtime = sim.runtimes.get(troop.id)!;
    runtime.flowchart = {
      agentId: troop.id,
      nodes: [{
        id: 'request_help',
        on: 'tick',
        action: { type: 'requestSupport', message: 'Need reinforcements!' },
        priority: 10,
      }],
      defaultAction: { type: 'hold' },
    };

    sim.battle.running = true;
    simulationTick(sim);

    // Check that a message was enqueued for the lieutenant
    const messages = drainFor(sim.messageBus, ltId);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some(m =>
      m.type === 'support_request' && m.from === troop.id
    )).toBe(true);
  });

  it('emit report should enqueue a message to the lieutenant', () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

    const troop = Array.from(sim.battle.agents.values()).find(
      a => a.team === 'player' && a.type === 'troop' && a.alive
    )!;
    const ltId = troop.lieutenantId!;

    const runtime = sim.runtimes.get(troop.id)!;
    runtime.flowchart = {
      agentId: troop.id,
      nodes: [{
        id: 'report',
        on: 'tick',
        action: { type: 'emit', eventType: 'report', message: 'Enemy spotted east' },
        priority: 10,
      }],
      defaultAction: { type: 'hold' },
    };

    sim.battle.running = true;
    simulationTick(sim);

    const messages = drainFor(sim.messageBus, ltId);
    expect(messages.some(m =>
      m.type === 'troop_report' && m.from === troop.id
    )).toBe(true);
  });

  it('stalemate warning should broadcast to all lieutenants', () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
    sim.battle.running = true;

    // Tick to stalemate warning (100 ticks)
    tickN(sim, 100);

    // Find a player lieutenant
    const lt = Array.from(sim.battle.agents.values()).find(
      a => a.team === 'player' && a.type === 'lieutenant' && a.alive
    )!;

    const messages = drainFor(sim.messageBus, lt.id);
    expect(messages.some(m => m.type === 'stalemate_warning')).toBe(true);
  });

  it('should still call legacy onTroopMessage callback alongside bus', () => {
    const legacyMessages: Array<{ agentId: string; type: string }> = [];
    const scenario = createBasicScenario();
    const sim = createSimulation(
      scenario.width, scenario.height, scenario.agents, scenario.flowcharts,
      { onTroopMessage: (agentId, type) => legacyMessages.push({ agentId, type }) }
    );

    const troop = Array.from(sim.battle.agents.values()).find(
      a => a.team === 'player' && a.type === 'troop' && a.alive
    )!;

    const runtime = sim.runtimes.get(troop.id)!;
    runtime.flowchart = {
      agentId: troop.id,
      nodes: [{
        id: 'alert',
        on: 'tick',
        action: { type: 'requestSupport', message: 'Help!' },
        priority: 10,
      }],
      defaultAction: { type: 'hold' },
    };

    sim.battle.running = true;
    simulationTick(sim);

    // Legacy callback should still fire
    expect(legacyMessages.some(m => m.type === 'requestSupport')).toBe(true);
  });
});
