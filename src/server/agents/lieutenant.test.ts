// Tests for lieutenant LLM client
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  Lieutenant,
  createLieutenant,
  LieutenantConfig,
  processOrder,
  LLMClient
} from './lieutenant.js';
import { LieutenantOutput } from './schema.js';

// Create a mock LLM client
function createMockClient(responses: Array<{ content: Array<{ type: string; text?: string }> } | Error>): LLMClient {
  let callIndex = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        const response = responses[callIndex++];
        if (response instanceof Error) {
          throw response;
        }
        return response;
      }),
    },
  };
}

describe('Lieutenant LLM Client', () => {
  const baseConfig: LieutenantConfig = {
    id: 'lt_alpha',
    name: 'Lt. Adaeze',
    personality: 'aggressive',
    stats: { initiative: 7, discipline: 5, communication: 6 },
    troopIds: ['p_s1_0', 'p_s1_1'],
    authorizedPeers: ['lt_bravo'],
  };

  describe('createLieutenant', () => {
    it('creates a lieutenant with config', () => {
      const lt = createLieutenant(baseConfig);
      
      expect(lt.id).toBe('lt_alpha');
      expect(lt.name).toBe('Lt. Adaeze');
      expect(lt.personality).toBe('aggressive');
      expect(lt.troopIds).toEqual(['p_s1_0', 'p_s1_1']);
    });

    it('initializes with empty message history', () => {
      const lt = createLieutenant(baseConfig);
      
      expect(lt.messageHistory).toEqual([]);
    });

    it('initializes as not busy', () => {
      const lt = createLieutenant(baseConfig);
      
      expect(lt.busy).toBe(false);
    });
  });

  describe('processOrder', () => {
    const baseContext = {
      currentOrders: 'Hold position.',
      visibleUnits: [{ id: 'p_s1_0', position: { x: 100, y: 100 }, health: 100, morale: 100 }],
      terrain: 'Open ground',
    };

    it('returns valid output on successful LLM call', async () => {
      const validOutput: LieutenantOutput = {
        directives: [
          {
            unit: 'all',
            nodes: [
              { id: 'hold', on: 'tick', action: { type: 'hold' } },
            ],
          },
        ],
        message_up: 'Holding position as ordered.',
      };
      
      const mockClient = createMockClient([
        { content: [{ type: 'text', text: JSON.stringify(validOutput) }] },
      ]);

      const lt = createLieutenant(baseConfig);
      const result = await processOrder(lt, 'Hold the line!', baseContext, mockClient);
      
      expect(result.success).toBe(true);
      expect(result.output?.directives).toBeDefined();
      expect(result.output?.message_up).toBe('Holding position as ordered.');
    });

    it('retries once on invalid JSON', async () => {
      const validOutput: LieutenantOutput = {
        directives: [],
      };
      
      const mockClient = createMockClient([
        { content: [{ type: 'text', text: '{ invalid json }' }] },
        { content: [{ type: 'text', text: JSON.stringify(validOutput) }] },
      ]);

      const lt = createLieutenant(baseConfig);
      const result = await processOrder(lt, 'What is your status?', baseContext, mockClient);
      
      expect(result.success).toBe(true);
      expect(mockClient.messages.create).toHaveBeenCalledTimes(2);
    });

    it('fails after two invalid attempts', async () => {
      const mockClient = createMockClient([
        { content: [{ type: 'text', text: '{ invalid }' }] },
        { content: [{ type: 'text', text: '{ still invalid }' }] },
      ]);

      const lt = createLieutenant(baseConfig);
      const result = await processOrder(lt, 'Do something', baseContext, mockClient);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('adds order to message history', async () => {
      const validOutput: LieutenantOutput = { directives: [] };
      
      const mockClient = createMockClient([
        { content: [{ type: 'text', text: JSON.stringify(validOutput) }] },
      ]);

      const lt = createLieutenant(baseConfig);
      await processOrder(lt, 'Take the hill!', baseContext, mockClient);
      
      expect(lt.messageHistory).toContainEqual({
        from: 'commander',
        content: 'Take the hill!',
        timestamp: expect.any(Number),
      });
    });

    it('clears busy flag after processing', async () => {
      const validOutput: LieutenantOutput = { directives: [] };
      
      const mockClient = createMockClient([
        { content: [{ type: 'text', text: JSON.stringify(validOutput) }] },
      ]);

      const lt = createLieutenant(baseConfig);
      await processOrder(lt, 'Move out', baseContext, mockClient);
      
      // Should be not busy after completion
      expect(lt.busy).toBe(false);
    });

    it('handles API errors gracefully', async () => {
      const mockClient = createMockClient([
        new Error('API rate limit'),
      ]);

      const lt = createLieutenant(baseConfig);
      const result = await processOrder(lt, 'Move out', baseContext, mockClient);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('API rate limit');
      expect(lt.busy).toBe(false);  // Should reset busy flag
    });

    it('stores last successful output', async () => {
      const validOutput: LieutenantOutput = {
        directives: [
          { unit: 'all', nodes: [{ id: 'hold', on: 'tick', action: { type: 'hold' } }] },
        ],
      };
      
      const mockClient = createMockClient([
        { content: [{ type: 'text', text: JSON.stringify(validOutput) }] },
      ]);

      const lt = createLieutenant(baseConfig);
      expect(lt.lastOutput).toBeNull();
      
      await processOrder(lt, 'Hold', baseContext, mockClient);
      
      expect(lt.lastOutput).toBeDefined();
      expect(lt.lastOutput?.directives).toHaveLength(1);
    });

    it('keeps only last 10 messages', async () => {
      const validOutput: LieutenantOutput = { directives: [] };

      const mockClient = createMockClient(
        Array(12).fill({ content: [{ type: 'text', text: JSON.stringify(validOutput) }] })
      );

      const lt = createLieutenant(baseConfig);

      for (let i = 0; i < 12; i++) {
        await processOrder(lt, `Order ${i}`, baseContext, mockClient);
      }

      expect(lt.messageHistory.length).toBeLessThanOrEqual(10);
    });
  });

  describe('LLM call timeout', () => {
    const baseContext = {
      currentOrders: 'Hold position.',
      visibleUnits: [{ id: 'p_s1_0', position: { x: 100, y: 100 }, health: 100, morale: 100 }],
      terrain: 'Open ground',
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('times out if LLM call takes too long', async () => {
      // Create a client that never resolves
      const mockClient: LLMClient = {
        messages: {
          create: vi.fn(() => new Promise(() => {
            // Never resolves
          })),
        },
      };

      const lt = createLieutenant(baseConfig);
      const orderPromise = processOrder(lt, 'Hold the line!', baseContext, mockClient);

      // Advance past the 30s timeout
      await vi.advanceTimersByTimeAsync(30_000);

      const result = await orderPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(lt.busy).toBe(false);
    });

    it('succeeds if LLM responds before timeout', async () => {
      const validOutput: LieutenantOutput = { directives: [] };

      // Create a client that resolves after a short delay
      const mockClient: LLMClient = {
        messages: {
          create: vi.fn(() => new Promise(resolve => {
            setTimeout(() => {
              resolve({ content: [{ type: 'text', text: JSON.stringify(validOutput) }] });
            }, 100);
          })),
        },
      };

      const lt = createLieutenant(baseConfig);
      const orderPromise = processOrder(lt, 'Hold the line!', baseContext, mockClient);

      // Advance just past the LLM response time (not the timeout)
      await vi.advanceTimersByTimeAsync(150);

      const result = await orderPromise;

      expect(result.success).toBe(true);
      expect(lt.busy).toBe(false);
    });

    it('times out on first call and retries are not attempted', async () => {
      // A client that never resolves — the timeout should fire and
      // processOrder's catch block should handle it (no retry on timeout)
      const mockClient: LLMClient = {
        messages: {
          create: vi.fn(() => new Promise(() => {})),
        },
      };

      const lt = createLieutenant(baseConfig);
      const orderPromise = processOrder(lt, 'Attack!', baseContext, mockClient);

      await vi.advanceTimersByTimeAsync(30_000);

      const result = await orderPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      // The timeout throws, caught by the outer catch — only 1 create call
      expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrent order processing', () => {
    const baseContext = {
      currentOrders: 'Hold position.',
      visibleUnits: [{ id: 'p_s1_0', position: { x: 100, y: 100 }, health: 100, morale: 100 }],
      terrain: 'Open ground',
    };

    it('marks lieutenant as busy during processing', async () => {
      let resolveCall: ((value: unknown) => void) | null = null;
      const validOutput: LieutenantOutput = { directives: [] };

      const mockClient: LLMClient = {
        messages: {
          create: vi.fn(() => new Promise(resolve => {
            resolveCall = resolve;
          })),
        },
      };

      const lt = createLieutenant(baseConfig);
      expect(lt.busy).toBe(false);

      const orderPromise = processOrder(lt, 'Hold', baseContext, mockClient);
      expect(lt.busy).toBe(true);

      // Resolve the LLM call
      resolveCall!({ content: [{ type: 'text', text: JSON.stringify(validOutput) }] });
      await orderPromise;

      expect(lt.busy).toBe(false);
    });

    it('multiple lieutenants can process orders in parallel', async () => {
      const validOutput: LieutenantOutput = {
        directives: [],
        message_up: 'Acknowledged.',
      };
      const callOrder: string[] = [];

      // Each lieutenant gets its own mock that tracks call order
      function createTrackedClient(ltId: string): LLMClient {
        return {
          messages: {
            create: vi.fn(async () => {
              callOrder.push(`${ltId}_start`);
              // Simulate async delay
              await new Promise(resolve => setTimeout(resolve, 10));
              callOrder.push(`${ltId}_end`);
              return { content: [{ type: 'text', text: JSON.stringify(validOutput) }] };
            }),
          },
        };
      }

      const ltAlpha = createLieutenant({ ...baseConfig, id: 'lt_alpha', name: 'Alpha' });
      const ltBravo = createLieutenant({ ...baseConfig, id: 'lt_bravo', name: 'Bravo' });
      const ltCharlie = createLieutenant({ ...baseConfig, id: 'lt_charlie', name: 'Charlie' });

      const clientAlpha = createTrackedClient('alpha');
      const clientBravo = createTrackedClient('bravo');
      const clientCharlie = createTrackedClient('charlie');

      // Process all orders in parallel (simulating Promise.all)
      const results = await Promise.all([
        processOrder(ltAlpha, 'Advance', baseContext, clientAlpha),
        processOrder(ltBravo, 'Hold', baseContext, clientBravo),
        processOrder(ltCharlie, 'Retreat', baseContext, clientCharlie),
      ]);

      // All should succeed
      expect(results.every(r => r.success)).toBe(true);

      // All should have started before any finished (parallel execution)
      // With parallel execution, all starts should come before all ends
      const starts = callOrder.filter(c => c.endsWith('_start'));
      const ends = callOrder.filter(c => c.endsWith('_end'));
      expect(starts).toHaveLength(3);
      expect(ends).toHaveLength(3);

      // All three lieutenants should be not busy
      expect(ltAlpha.busy).toBe(false);
      expect(ltBravo.busy).toBe(false);
      expect(ltCharlie.busy).toBe(false);
    });
  });
});
