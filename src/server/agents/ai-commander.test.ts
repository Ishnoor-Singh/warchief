// RED: Tests for AI Commander - LLM-powered enemy opponent
import { describe, it, expect, vi } from 'vitest';
import {
  AICommander,
  createAICommander,
  generateCommanderOrders,
  buildCommanderContext,
  AICommanderConfig,
} from './ai-commander.js';
import { LLMClient } from './lieutenant.js';
import { createSimulation, SimulationState } from '../sim/simulation.js';
import { createBasicScenario } from '../sim/scenario.js';

// Mock LLM that returns valid commander decisions
function createMockCommanderClient(): LLMClient {
  return {
    messages: {
      create: vi.fn(async () => {
        const output = {
          orders: [
            {
              lieutenantId: 'lt_enemy_1',
              order: 'Advance aggressively toward the enemy left flank. Engage on sight.',
            },
            {
              lieutenantId: 'lt_enemy_2',
              order: 'Hold defensive position. Support lt_enemy_1 if they come under heavy fire.',
            },
          ],
          reasoning: 'Pushing the left flank to create pressure while holding the right.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(output) }] };
      }),
    },
  };
}

describe('AI Commander', () => {
  const baseConfig: AICommanderConfig = {
    personality: 'aggressive',
    lieutenantIds: ['lt_enemy_1', 'lt_enemy_2'],
    model: 'claude-sonnet-4-20250514',
  };

  describe('createAICommander', () => {
    it('creates an AI commander with config', () => {
      const commander = createAICommander(baseConfig);

      expect(commander.personality).toBe('aggressive');
      expect(commander.lieutenantIds).toEqual(['lt_enemy_1', 'lt_enemy_2']);
    });

    it('initializes with empty order history', () => {
      const commander = createAICommander(baseConfig);
      expect(commander.orderHistory).toEqual([]);
    });

    it('initializes as not busy', () => {
      const commander = createAICommander(baseConfig);
      expect(commander.busy).toBe(false);
    });

    it('tracks last order tick', () => {
      const commander = createAICommander(baseConfig);
      expect(commander.lastOrderTick).toBe(0);
    });
  });

  describe('buildCommanderContext', () => {
    it('builds context with battle state summary', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const commander = createAICommander(baseConfig);
      const context = buildCommanderContext(commander, sim);

      expect(context).toContain('enemy');
      expect(context).toContain('troops');
    });

    it('includes lieutenant ids in context', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const commander = createAICommander(baseConfig);
      const context = buildCommanderContext(commander, sim);

      expect(context).toContain('lt_enemy_1');
      expect(context).toContain('lt_enemy_2');
    });
  });

  describe('generateCommanderOrders', () => {
    it('returns orders for each lieutenant', async () => {
      const mockClient = createMockCommanderClient();
      const commander = createAICommander(baseConfig);
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const result = await generateCommanderOrders(commander, sim, mockClient);

      expect(result.success).toBe(true);
      expect(result.orders).toBeDefined();
      expect(result.orders!.length).toBeGreaterThan(0);
    });

    it('marks commander as busy during processing', async () => {
      const mockClient = createMockCommanderClient();
      const commander = createAICommander(baseConfig);
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      // Start the order generation (don't await yet)
      const promise = generateCommanderOrders(commander, sim, mockClient);

      // Commander should be busy during processing
      expect(commander.busy).toBe(true);

      await promise;

      // Should be not busy after
      expect(commander.busy).toBe(false);
    });

    it('stores orders in history', async () => {
      const mockClient = createMockCommanderClient();
      const commander = createAICommander(baseConfig);
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      await generateCommanderOrders(commander, sim, mockClient);

      expect(commander.orderHistory.length).toBeGreaterThan(0);
    });

    it('handles LLM errors gracefully', async () => {
      const mockClient: LLMClient = {
        messages: {
          create: vi.fn(async () => {
            throw new Error('API error');
          }),
        },
      };

      const commander = createAICommander(baseConfig);
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const result = await generateCommanderOrders(commander, sim, mockClient);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API error');
      expect(commander.busy).toBe(false);
    });

    it('handles malformed LLM response', async () => {
      const mockClient: LLMClient = {
        messages: {
          create: vi.fn(async () => ({
            content: [{ type: 'text', text: '{ invalid json }' }],
          })),
        },
      };

      const commander = createAICommander(baseConfig);
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const result = await generateCommanderOrders(commander, sim, mockClient);

      expect(result.success).toBe(false);
    });
  });
});
