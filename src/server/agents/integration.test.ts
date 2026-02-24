// Integration test: Full Phase 2 workflow
// Player sends order → Lieutenant interprets → Flowcharts compiled → Troops update

import { describe, it, expect, vi } from 'vitest';
import { createLieutenant, processOrder, LLMClient, LieutenantConfig } from './lieutenant.js';
import { compileDirectives } from './compiler.js';
import { LieutenantOutput } from './schema.js';
import { createSimulation, SimulationState } from '../sim/simulation.js';
import { createBasicScenario } from '../sim/scenario.js';

describe('Phase 2 Integration', () => {
  // Mock LLM that returns valid tactical responses
  function createTacticalMockClient(): LLMClient {
    return {
      messages: {
        create: vi.fn(async ({ messages }) => {
          const userMessage = messages[0]?.content || '';
          
          // Generate contextual response based on order
          let output: LieutenantOutput;
          
          if (userMessage.toLowerCase().includes('hold')) {
            output = {
              directives: [
                {
                  unit: 'all',
                  nodes: [
                    { id: 'hold_position', on: 'tick', action: { type: 'hold' }, priority: 1 },
                    { id: 'defend', on: 'under_attack', action: { type: 'engage' }, priority: 10 },
                  ],
                },
              ],
              message_up: 'Understood. Holding position and will engage if attacked.',
            };
          } else if (userMessage.toLowerCase().includes('advance') || userMessage.toLowerCase().includes('take')) {
            output = {
              directives: [
                {
                  unit: 'all',
                  nodes: [
                    { 
                      id: 'advance', 
                      on: 'no_enemies_visible', 
                      action: { type: 'moveTo', position: { x: 300, y: 150 } },
                      priority: 1 
                    },
                    { 
                      id: 'engage_spotted', 
                      on: 'enemy_spotted', 
                      condition: 'distance < 80',
                      action: { type: 'engage' }, 
                      priority: 10 
                    },
                  ],
                },
              ],
              message_up: 'Moving to take the high ground. Will engage enemies on contact.',
            };
          } else if (userMessage.toLowerCase().includes('fall back') || userMessage.toLowerCase().includes('retreat')) {
            output = {
              directives: [
                {
                  unit: 'all',
                  nodes: [
                    { 
                      id: 'retreat', 
                      on: 'tick', 
                      action: { type: 'fallback', position: { x: 50, y: 150 } },
                      priority: 5 
                    },
                  ],
                },
              ],
              message_up: 'Falling back to the rear. Covering retreat.',
            };
          } else {
            // Default: acknowledge and hold
            output = {
              directives: [
                {
                  unit: 'all',
                  nodes: [
                    { id: 'default_hold', on: 'tick', action: { type: 'hold' } },
                  ],
                },
              ],
              message_up: 'Awaiting further orders.',
            };
          }
          
          return { content: [{ type: 'text', text: JSON.stringify(output) }] };
        }),
      },
    };
  }

  const lieutenantConfig: LieutenantConfig = {
    id: 'lt_alpha',
    name: 'Lt. Adaeze',
    personality: 'aggressive',
    stats: { initiative: 7, discipline: 5, communication: 6 },
    troopIds: ['p_s1_0', 'p_s1_1', 'p_s1_2'],
    authorizedPeers: [],
  };

  it('processes order and compiles flowcharts for troops', async () => {
    const mockClient = createTacticalMockClient();
    const lt = createLieutenant(lieutenantConfig);
    
    const context = {
      currentOrders: '',
      visibleUnits: [
        { id: 'p_s1_0', position: { x: 100, y: 100 }, health: 100, morale: 100 },
        { id: 'p_s1_1', position: { x: 115, y: 100 }, health: 100, morale: 100 },
        { id: 'p_s1_2', position: { x: 130, y: 100 }, health: 100, morale: 100 },
      ],
      terrain: 'Open ground with ridge to the east',
    };
    
    // Step 1: Process order
    const result = await processOrder(lt, 'Take the high ground!', context, mockClient);
    
    expect(result.success).toBe(true);
    expect(result.output?.directives).toBeDefined();
    expect(result.output?.message_up).toContain('high ground');
    
    // Step 2: Compile directives to flowcharts
    const compiled = compileDirectives(result.output!, lt.troopIds);
    
    expect(compiled.errors).toEqual([]);
    expect(Object.keys(compiled.flowcharts)).toHaveLength(3);
    
    // Each troop should have the advance behavior
    for (const troopId of lt.troopIds) {
      const flowchart = compiled.flowcharts[troopId];
      expect(flowchart).toBeDefined();
      expect(flowchart!.nodes.some(n => n.id === 'advance')).toBe(true);
      expect(flowchart!.nodes.some(n => n.id === 'engage_spotted')).toBe(true);
    }
  });

  it('handles hold order correctly', async () => {
    const mockClient = createTacticalMockClient();
    const lt = createLieutenant(lieutenantConfig);
    
    const context = {
      currentOrders: '',
      visibleUnits: [],
      terrain: 'Defensive position on ridge',
    };
    
    const result = await processOrder(lt, 'Hold this position at all costs!', context, mockClient);
    
    expect(result.success).toBe(true);
    expect(result.output?.message_up).toContain('Holding');
    
    const compiled = compileDirectives(result.output!, lt.troopIds);
    
    // Should have hold and defend behaviors
    const flowchart = compiled.flowcharts[lt.troopIds[0]!];
    expect(flowchart!.nodes.some(n => n.action.type === 'hold')).toBe(true);
    expect(flowchart!.nodes.some(n => n.action.type === 'engage')).toBe(true);
  });

  it('handles retreat order correctly', async () => {
    const mockClient = createTacticalMockClient();
    const lt = createLieutenant(lieutenantConfig);
    
    const context = {
      currentOrders: '',
      visibleUnits: [],
      terrain: 'Under heavy fire',
    };
    
    const result = await processOrder(lt, 'Fall back to the treeline!', context, mockClient);
    
    expect(result.success).toBe(true);
    expect(result.output?.message_up).toContain('Falling back');
    
    const compiled = compileDirectives(result.output!, lt.troopIds);
    
    const flowchart = compiled.flowcharts[lt.troopIds[0]!];
    expect(flowchart!.nodes.some(n => n.action.type === 'fallback')).toBe(true);
  });

  it('integrates with simulation state', async () => {
    const mockClient = createTacticalMockClient();
    const lt = createLieutenant({
      ...lieutenantConfig,
      troopIds: ['p_s1_0', 'p_s1_1', 'p_s1_2', 'p_s1_3', 'p_s1_4', 'p_s1_5', 'p_s1_6', 'p_s1_7', 'p_s1_8', 'p_s1_9'],
    });
    
    // Create simulation with basic scenario
    const scenario = createBasicScenario();
    const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
    
    // Extract visible unit info from simulation
    const visibleUnits = lt.troopIds.map(id => {
      const agent = sim.battle.agents.get(id);
      return {
        id,
        position: agent?.position || { x: 0, y: 0 },
        health: agent?.health || 0,
        morale: agent?.morale || 0,
      };
    }).filter(u => u.health > 0);
    
    const context = {
      currentOrders: '',
      visibleUnits,
      terrain: 'Open battlefield',
    };
    
    // Process order
    const result = await processOrder(lt, 'Advance and engage!', context, mockClient);
    expect(result.success).toBe(true);
    
    // Compile and verify integration with existing troop ids
    const compiled = compileDirectives(result.output!, lt.troopIds);
    
    // Should have compiled flowcharts for troops that exist in simulation
    const validTroopIds = lt.troopIds.filter(id => sim.battle.agents.has(id));
    expect(Object.keys(compiled.flowcharts).length).toBeGreaterThan(0);
  });

  it('lieutenant reports back to commander', async () => {
    const mockClient = createTacticalMockClient();
    const lt = createLieutenant(lieutenantConfig);
    
    const context = {
      currentOrders: '',
      visibleUnits: [],
      terrain: 'Unknown terrain',
    };
    
    const result = await processOrder(lt, 'What is your status?', context, mockClient);
    
    expect(result.success).toBe(true);
    expect(result.output?.message_up).toBeDefined();
    expect(typeof result.output?.message_up).toBe('string');
  });
});
