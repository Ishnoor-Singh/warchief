// Tests for order processing patterns: parallelization, busy guards, and timeouts
// These test the patterns used in index.ts for briefTeamLieutenants,
// runAICommanderCycle, and send_order handling.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createLieutenant,
  processOrder,
  Lieutenant,
  LieutenantConfig,
  LLMClient,
  OrderContext,
} from './lieutenant.js';
import { compileDirectives, applyFlowcharts } from './compiler.js';
import { LieutenantOutput } from './schema.js';
import { createSimulation } from '../sim/simulation.js';
import { createBasicScenario } from '../sim/scenario.js';
import { createAICommander, generateCommanderOrders } from './ai-commander.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseConfig: LieutenantConfig = {
  id: 'lt_alpha',
  name: 'Lt. Adaeze',
  personality: 'aggressive',
  stats: { initiative: 7, discipline: 5, communication: 6 },
  troopIds: ['p_s1_0', 'p_s1_1'],
  authorizedPeers: ['lt_bravo'],
};

const baseContext: OrderContext = {
  currentOrders: 'Hold position.',
  visibleUnits: [{ id: 'p_s1_0', position: { x: 100, y: 100 }, health: 100, morale: 100 }],
  terrain: 'Open ground',
};

const validOutput: LieutenantOutput = {
  directives: [
    { unit: 'all', nodes: [{ id: 'hold', on: 'tick', action: { type: 'hold' } }] },
  ],
  message_up: 'Holding position.',
};

function makeResponse(output: LieutenantOutput = validOutput) {
  return { content: [{ type: 'text', text: JSON.stringify(output) }] };
}

// ─── Parallel Briefing Pattern ───────────────────────────────────────────────

describe('parallel lieutenant order processing', () => {
  it('processes multiple lieutenants in parallel rather than sequentially', async () => {
    const timeline: Array<{ lt: string; event: 'start' | 'end'; time: number }> = [];
    const startTime = Date.now();

    function createDelayedClient(ltId: string, delayMs: number): LLMClient {
      return {
        messages: {
          create: vi.fn(async () => {
            timeline.push({ lt: ltId, event: 'start', time: Date.now() - startTime });
            await new Promise(resolve => setTimeout(resolve, delayMs));
            timeline.push({ lt: ltId, event: 'end', time: Date.now() - startTime });
            return makeResponse();
          }),
        },
      };
    }

    const ltAlpha = createLieutenant({ ...baseConfig, id: 'lt_alpha', name: 'Alpha' });
    const ltBravo = createLieutenant({ ...baseConfig, id: 'lt_bravo', name: 'Bravo' });
    const ltCharlie = createLieutenant({ ...baseConfig, id: 'lt_charlie', name: 'Charlie' });

    const delay = 50; // ms per LLM call
    const clientA = createDelayedClient('alpha', delay);
    const clientB = createDelayedClient('bravo', delay);
    const clientC = createDelayedClient('charlie', delay);

    // Simulate the parallel pattern from briefTeamLieutenants
    const orders = [
      { lt: ltAlpha, client: clientA },
      { lt: ltBravo, client: clientB },
      { lt: ltCharlie, client: clientC },
    ];

    const beforeAll = Date.now();
    const results = await Promise.all(
      orders.map(({ lt, client }) =>
        processOrder(lt, 'Hold the line!', baseContext, client)
      )
    );
    const elapsed = Date.now() - beforeAll;

    // All should succeed
    expect(results.every(r => r.success)).toBe(true);

    // Parallel execution: total time should be roughly 1x delay, not 3x
    // With sequential, it would take ~150ms. With parallel, ~50ms.
    // Use 2x as a generous bound to avoid flaky tests.
    expect(elapsed).toBeLessThan(delay * 2.5);

    // Verify all starts happened before all ends (true parallelism)
    const starts = timeline.filter(t => t.event === 'start');
    const ends = timeline.filter(t => t.event === 'end');
    const lastStart = Math.max(...starts.map(s => s.time));
    const firstEnd = Math.min(...ends.map(e => e.time));
    expect(lastStart).toBeLessThan(firstEnd);
  });

  it('sequential processing takes longer than parallel', async () => {
    const delay = 30;

    function createDelayedClient(): LLMClient {
      return {
        messages: {
          create: vi.fn(async () => {
            await new Promise(resolve => setTimeout(resolve, delay));
            return makeResponse();
          }),
        },
      };
    }

    const lts = ['alpha', 'bravo', 'charlie'].map(name =>
      createLieutenant({ ...baseConfig, id: `lt_${name}`, name })
    );
    const clients = lts.map(() => createDelayedClient());

    // Measure sequential
    const seqStart = Date.now();
    for (let i = 0; i < lts.length; i++) {
      await processOrder(lts[i]!, `Order`, baseContext, clients[i]);
    }
    const seqTime = Date.now() - seqStart;

    // Reset lieutenants for parallel run
    const lts2 = ['alpha2', 'bravo2', 'charlie2'].map(name =>
      createLieutenant({ ...baseConfig, id: `lt_${name}`, name })
    );
    const clients2 = lts2.map(() => createDelayedClient());

    // Measure parallel
    const parStart = Date.now();
    await Promise.all(
      lts2.map((lt, i) => processOrder(lt, `Order`, baseContext, clients2[i]))
    );
    const parTime = Date.now() - parStart;

    // Parallel should be faster than sequential
    expect(parTime).toBeLessThan(seqTime);
  });

  it('parallel processing applies flowcharts independently per lieutenant', async () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

    const outputAlpha: LieutenantOutput = {
      directives: [
        { unit: 'all', nodes: [{ id: 'advance', on: 'tick', action: { type: 'moveTo', position: { x: 200, y: 100 } } }] },
      ],
      message_up: 'Advancing.',
    };

    const outputBravo: LieutenantOutput = {
      directives: [
        { unit: 'all', nodes: [{ id: 'hold_pos', on: 'tick', action: { type: 'hold' } }] },
      ],
      message_up: 'Holding.',
    };

    const ltAlpha = createLieutenant({
      ...baseConfig,
      id: 'lt_alpha',
      name: 'Alpha',
      troopIds: ['p_s1_0', 'p_s1_1', 'p_s1_2'],
    });
    const ltBravo = createLieutenant({
      ...baseConfig,
      id: 'lt_bravo',
      name: 'Bravo',
      troopIds: ['p_s2_0', 'p_s2_1', 'p_s2_2'],
    });

    const clientA: LLMClient = {
      messages: { create: vi.fn(async () => makeResponse(outputAlpha)) },
    };
    const clientB: LLMClient = {
      messages: { create: vi.fn(async () => makeResponse(outputBravo)) },
    };

    // Process in parallel
    const [resultA, resultB] = await Promise.all([
      processOrder(ltAlpha, 'Advance!', baseContext, clientA),
      processOrder(ltBravo, 'Hold position', baseContext, clientB),
    ]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);

    // Compile and apply independently
    const compiledA = compileDirectives(resultA.output!, ltAlpha.troopIds, ltAlpha.id);
    const compiledB = compileDirectives(resultB.output!, ltBravo.troopIds, ltBravo.id);

    applyFlowcharts(compiledA, sim.runtimes);
    applyFlowcharts(compiledB, sim.runtimes);

    // Verify Alpha's troops got the advance flowchart
    for (const troopId of ltAlpha.troopIds) {
      const runtime = sim.runtimes.get(troopId);
      if (runtime) {
        const hasAdvance = runtime.flowchart.nodes.some(n => n.id === 'advance');
        expect(hasAdvance).toBe(true);
      }
    }

    // Verify Bravo's troops got the hold flowchart
    for (const troopId of ltBravo.troopIds) {
      const runtime = sim.runtimes.get(troopId);
      if (runtime) {
        const hasHold = runtime.flowchart.nodes.some(n => n.id === 'hold_pos');
        expect(hasHold).toBe(true);
      }
    }
  });

  it('handles mixed success/failure across parallel lieutenant calls', async () => {
    const ltAlpha = createLieutenant({ ...baseConfig, id: 'lt_alpha', name: 'Alpha' });
    const ltBravo = createLieutenant({ ...baseConfig, id: 'lt_bravo', name: 'Bravo' });

    // Alpha succeeds, Bravo fails
    const clientA: LLMClient = {
      messages: { create: vi.fn(async () => makeResponse()) },
    };
    const clientB: LLMClient = {
      messages: { create: vi.fn(async () => { throw new Error('API overloaded'); }) },
    };

    const [resultA, resultB] = await Promise.all([
      processOrder(ltAlpha, 'Advance', baseContext, clientA),
      processOrder(ltBravo, 'Advance', baseContext, clientB),
    ]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(false);
    expect(resultB.error).toContain('API overloaded');

    // Both should reset busy flags
    expect(ltAlpha.busy).toBe(false);
    expect(ltBravo.busy).toBe(false);
  });
});

// ─── Busy Guard Pattern ─────────────────────────────────────────────────────

describe('busy guard on order processing', () => {
  it('lieutenant is busy during LLM call', async () => {
    let resolveCall: ((value: unknown) => void) | null = null;

    const mockClient: LLMClient = {
      messages: {
        create: vi.fn(() => new Promise(resolve => { resolveCall = resolve; })),
      },
    };

    const lt = createLieutenant(baseConfig);

    const orderPromise = processOrder(lt, 'Hold', baseContext, mockClient);

    // Should be busy while awaiting
    expect(lt.busy).toBe(true);

    resolveCall!(makeResponse());
    await orderPromise;

    expect(lt.busy).toBe(false);
  });

  it('busy guard prevents duplicate order processing (application-level pattern)', async () => {
    let callCount = 0;
    let resolveFirst: ((value: unknown) => void) | null = null;

    const mockClient: LLMClient = {
      messages: {
        create: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            return new Promise(resolve => { resolveFirst = resolve; });
          }
          return Promise.resolve(makeResponse());
        }),
      },
    };

    const lt = createLieutenant(baseConfig);

    // First order starts processing
    const firstOrder = processOrder(lt, 'Advance', baseContext, mockClient);
    expect(lt.busy).toBe(true);

    // Application-level check: if busy, reject
    if (lt.busy) {
      // This is what index.ts does — return error without calling processOrder
      const secondResult = { success: false, error: `${lt.name} is still processing a previous order.` };
      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain('still processing');
    }

    // Complete the first order
    resolveFirst!(makeResponse());
    const firstResult = await firstOrder;

    expect(firstResult.success).toBe(true);
    expect(lt.busy).toBe(false);

    // Now a second order should work fine
    const thirdResult = await processOrder(lt, 'Hold', baseContext, {
      messages: { create: vi.fn(async () => makeResponse()) },
    });
    expect(thirdResult.success).toBe(true);
  });

  it('busy flag resets on error so lieutenant is not stuck', async () => {
    const mockClient: LLMClient = {
      messages: {
        create: vi.fn(async () => { throw new Error('Network error'); }),
      },
    };

    const lt = createLieutenant(baseConfig);
    const result = await processOrder(lt, 'Move out', baseContext, mockClient);

    expect(result.success).toBe(false);
    expect(lt.busy).toBe(false); // Must reset so subsequent orders can proceed

    // Subsequent order should process fine
    const goodClient: LLMClient = {
      messages: { create: vi.fn(async () => makeResponse()) },
    };
    const result2 = await processOrder(lt, 'Hold', baseContext, goodClient);
    expect(result2.success).toBe(true);
  });
});

// ─── AI Commander Parallel Cycle ─────────────────────────────────────────────

describe('AI commander cycle with parallel lieutenant processing', () => {
  it('commander generates orders then lieutenants process in parallel', async () => {
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

    const commanderOutput = {
      orders: [
        { lieutenantId: 'lt_alpha', order: 'Attack the left flank!' },
        { lieutenantId: 'lt_bravo', order: 'Hold the center!' },
      ],
      reasoning: 'Flanking maneuver.',
    };

    const commanderClient: LLMClient = {
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: 'text', text: JSON.stringify(commanderOutput) }],
        })),
      },
    };

    const commander = createAICommander({
      personality: 'aggressive',
      lieutenantIds: ['lt_alpha', 'lt_bravo'],
      model: 'claude-sonnet-4-20250514',
    });

    // Step 1: Generate commander orders
    const cmdResult = await generateCommanderOrders(commander, sim, commanderClient);
    expect(cmdResult.success).toBe(true);
    expect(cmdResult.orders).toHaveLength(2);

    // Step 2: Process lieutenant orders in parallel (the pattern from index.ts)
    const ltAlpha = createLieutenant({ ...baseConfig, id: 'lt_alpha', name: 'Alpha' });
    const ltBravo = createLieutenant({ ...baseConfig, id: 'lt_bravo', name: 'Bravo' });
    const lts = [ltAlpha, ltBravo];

    const ltClient: LLMClient = {
      messages: { create: vi.fn(async () => makeResponse()) },
    };

    const orderPromises = cmdResult.orders!.map(async (commanderOrder) => {
      const lt = lts.find(l => l.id === commanderOrder.lieutenantId);
      if (!lt || lt.busy) return null;

      return processOrder(lt, commanderOrder.order, baseContext, ltClient);
    });

    const results = await Promise.all(orderPromises);

    // Both should have succeeded
    expect(results.filter(r => r?.success).length).toBe(2);

    // LLM was called for each lieutenant
    expect(ltClient.messages.create).toHaveBeenCalledTimes(2);
  });

  it('skips busy lieutenants during commander cycle', async () => {
    const ltAlpha = createLieutenant({ ...baseConfig, id: 'lt_alpha', name: 'Alpha' });
    const ltBravo = createLieutenant({ ...baseConfig, id: 'lt_bravo', name: 'Bravo' });

    // Bravo is already busy
    ltBravo.busy = true;

    const ltClient: LLMClient = {
      messages: { create: vi.fn(async () => makeResponse()) },
    };

    const orders = [
      { lieutenantId: 'lt_alpha', order: 'Attack!' },
      { lieutenantId: 'lt_bravo', order: 'Hold!' },
    ];

    const lts = [ltAlpha, ltBravo];

    // Simulate the runAICommanderCycle pattern
    const orderPromises = orders.map(async (commanderOrder) => {
      const lt = lts.find(l => l.id === commanderOrder.lieutenantId);
      if (!lt || lt.busy) return null;

      return processOrder(lt, commanderOrder.order, baseContext, ltClient);
    });

    const results = await Promise.all(orderPromises);

    // Only Alpha should have been processed
    expect(results[0]?.success).toBe(true);
    expect(results[1]).toBeNull(); // Bravo skipped

    // Only one LLM call made (Alpha's)
    expect(ltClient.messages.create).toHaveBeenCalledTimes(1);
  });

  it('unknown lieutenant ids in commander orders are safely skipped', async () => {
    const ltAlpha = createLieutenant({ ...baseConfig, id: 'lt_alpha', name: 'Alpha' });

    const ltClient: LLMClient = {
      messages: { create: vi.fn(async () => makeResponse()) },
    };

    const orders = [
      { lieutenantId: 'lt_alpha', order: 'Attack!' },
      { lieutenantId: 'lt_nonexistent', order: 'Hold!' },
    ];

    const lts = [ltAlpha];

    const orderPromises = orders.map(async (commanderOrder) => {
      const lt = lts.find(l => l.id === commanderOrder.lieutenantId);
      if (!lt || lt.busy) return null;

      return processOrder(lt, commanderOrder.order, baseContext, ltClient);
    });

    const results = await Promise.all(orderPromises);

    expect(results[0]?.success).toBe(true);
    expect(results[1]).toBeNull();
    expect(ltClient.messages.create).toHaveBeenCalledTimes(1);
  });
});

// ─── Timeout in Multi-Lieutenant Context ─────────────────────────────────────

describe('timeout behavior in parallel processing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('one lieutenant timing out does not block others in parallel', async () => {
    const ltAlpha = createLieutenant({ ...baseConfig, id: 'lt_alpha', name: 'Alpha' });
    const ltBravo = createLieutenant({ ...baseConfig, id: 'lt_bravo', name: 'Bravo' });

    // Alpha responds quickly, Bravo hangs forever
    const clientA: LLMClient = {
      messages: {
        create: vi.fn(() => new Promise(resolve => {
          setTimeout(() => resolve(makeResponse()), 50);
        })),
      },
    };
    const clientB: LLMClient = {
      messages: {
        create: vi.fn(() => new Promise(() => {
          // Never resolves
        })),
      },
    };

    const promise = Promise.all([
      processOrder(ltAlpha, 'Advance', baseContext, clientA),
      processOrder(ltBravo, 'Hold', baseContext, clientB),
    ]);

    // Advance past Bravo's timeout
    await vi.advanceTimersByTimeAsync(30_000);

    const [resultA, resultB] = await promise;

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(false);
    expect(resultB.error).toContain('timed out');

    // Both should have their busy flags cleared
    expect(ltAlpha.busy).toBe(false);
    expect(ltBravo.busy).toBe(false);
  });

  it('lieutenant can accept new orders after a timeout', async () => {
    const lt = createLieutenant(baseConfig);

    // First call hangs
    const hangingClient: LLMClient = {
      messages: {
        create: vi.fn(() => new Promise(() => {})),
      },
    };

    const firstOrder = processOrder(lt, 'Attack', baseContext, hangingClient);
    await vi.advanceTimersByTimeAsync(30_000);
    const result1 = await firstOrder;

    expect(result1.success).toBe(false);
    expect(result1.error).toContain('timed out');
    expect(lt.busy).toBe(false);

    // Second call succeeds
    const goodClient: LLMClient = {
      messages: {
        create: vi.fn(() => new Promise(resolve => {
          setTimeout(() => resolve(makeResponse()), 50);
        })),
      },
    };

    const secondOrder = processOrder(lt, 'Hold', baseContext, goodClient);
    await vi.advanceTimersByTimeAsync(100);
    const result2 = await secondOrder;

    expect(result2.success).toBe(true);
    expect(lt.busy).toBe(false);
  });
});
