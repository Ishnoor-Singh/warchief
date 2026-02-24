// Tests for lieutenant LLM client
import { describe, it, expect, vi } from 'vitest';
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
});
