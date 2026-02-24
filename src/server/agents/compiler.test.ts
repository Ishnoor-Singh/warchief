// RED: Tests for flowchart compiler (LieutenantOutput → runtime flowcharts)
import { describe, it, expect } from 'vitest';
import { 
  compileDirectives, 
  CompiledFlowcharts,
  resolveUnitPattern 
} from './compiler.js';
import { LieutenantOutput } from './schema.js';

describe('Flowchart Compiler', () => {
  describe('resolveUnitPattern', () => {
    const availableUnits = ['p_s1_0', 'p_s1_1', 'p_s1_2', 'p_s2_0', 'p_s2_1'];

    it('resolves specific unit id', () => {
      const result = resolveUnitPattern('p_s1_0', availableUnits);
      expect(result).toEqual(['p_s1_0']);
    });

    it('resolves "all" to all units', () => {
      const result = resolveUnitPattern('all', availableUnits);
      expect(result).toEqual(availableUnits);
    });

    it('resolves wildcard pattern "p_s1_*"', () => {
      const result = resolveUnitPattern('p_s1_*', availableUnits);
      expect(result).toEqual(['p_s1_0', 'p_s1_1', 'p_s1_2']);
    });

    it('resolves wildcard pattern "p_s2_*"', () => {
      const result = resolveUnitPattern('p_s2_*', availableUnits);
      expect(result).toEqual(['p_s2_0', 'p_s2_1']);
    });

    it('returns empty array for non-matching pattern', () => {
      const result = resolveUnitPattern('p_s3_*', availableUnits);
      expect(result).toEqual([]);
    });

    it('returns empty array for non-existent unit', () => {
      const result = resolveUnitPattern('nonexistent', availableUnits);
      expect(result).toEqual([]);
    });
  });

  describe('compileDirectives', () => {
    const availableUnits = ['p_s1_0', 'p_s1_1', 'p_s2_0'];

    it('compiles empty directives', () => {
      const output: LieutenantOutput = { directives: [] };
      const result = compileDirectives(output, availableUnits);
      
      expect(result.flowcharts).toEqual({});
      expect(result.errors).toEqual([]);
    });

    it('compiles directive for specific unit', () => {
      const output: LieutenantOutput = {
        directives: [
          {
            unit: 'p_s1_0',
            nodes: [
              { id: 'hold', on: 'tick', action: { type: 'hold' } },
            ],
          },
        ],
      };
      
      const result = compileDirectives(output, availableUnits);
      
      expect(result.flowcharts['p_s1_0']).toBeDefined();
      expect(result.flowcharts['p_s1_0']!.nodes).toHaveLength(1);
      expect(result.flowcharts['p_s1_0']!.nodes[0]!.id).toBe('hold');
    });

    it('compiles directive for "all" units', () => {
      const output: LieutenantOutput = {
        directives: [
          {
            unit: 'all',
            nodes: [
              { id: 'engage', on: 'enemy_spotted', action: { type: 'engage' } },
            ],
          },
        ],
      };
      
      const result = compileDirectives(output, availableUnits);
      
      expect(Object.keys(result.flowcharts)).toHaveLength(3);
      expect(result.flowcharts['p_s1_0']).toBeDefined();
      expect(result.flowcharts['p_s1_1']).toBeDefined();
      expect(result.flowcharts['p_s2_0']).toBeDefined();
    });

    it('compiles directive with wildcard pattern', () => {
      const output: LieutenantOutput = {
        directives: [
          {
            unit: 'p_s1_*',
            nodes: [
              { id: 'fallback', on: 'under_attack', action: { type: 'fallback', position: { x: 0, y: 0 } } },
            ],
          },
        ],
      };
      
      const result = compileDirectives(output, availableUnits);
      
      expect(Object.keys(result.flowcharts)).toHaveLength(2);
      expect(result.flowcharts['p_s1_0']).toBeDefined();
      expect(result.flowcharts['p_s1_1']).toBeDefined();
      expect(result.flowcharts['p_s2_0']).toBeUndefined();
    });

    it('merges multiple directives for same unit', () => {
      const output: LieutenantOutput = {
        directives: [
          {
            unit: 'p_s1_0',
            nodes: [
              { id: 'hold', on: 'tick', action: { type: 'hold' } },
            ],
          },
          {
            unit: 'p_s1_0',
            nodes: [
              { id: 'engage', on: 'enemy_spotted', action: { type: 'engage' } },
            ],
          },
        ],
      };
      
      const result = compileDirectives(output, availableUnits);
      
      expect(result.flowcharts['p_s1_0']!.nodes).toHaveLength(2);
    });

    it('preserves node priority', () => {
      const output: LieutenantOutput = {
        directives: [
          {
            unit: 'p_s1_0',
            nodes: [
              { id: 'low', on: 'enemy_spotted', action: { type: 'hold' }, priority: 1 },
              { id: 'high', on: 'enemy_spotted', action: { type: 'engage' }, priority: 10 },
            ],
          },
        ],
      };
      
      const result = compileDirectives(output, availableUnits);
      const nodes = result.flowcharts['p_s1_0']!.nodes;
      
      expect(nodes.find(n => n.id === 'high')?.priority).toBe(10);
      expect(nodes.find(n => n.id === 'low')?.priority).toBe(1);
    });

    it('preserves conditions and chaining', () => {
      const output: LieutenantOutput = {
        directives: [
          {
            unit: 'p_s1_0',
            nodes: [
              { 
                id: 'check_distance', 
                on: 'enemy_spotted', 
                condition: 'distance < 50',
                action: { type: 'engage' },
                else: 'fallback_node'
              },
              {
                id: 'fallback_node',
                on: 'enemy_spotted',
                action: { type: 'fallback', position: { x: 100, y: 100 } },
              },
            ],
          },
        ],
      };
      
      const result = compileDirectives(output, availableUnits);
      const node = result.flowcharts['p_s1_0']!.nodes.find(n => n.id === 'check_distance');
      
      expect(node?.condition).toBe('distance < 50');
      expect(node?.else).toBe('fallback_node');
    });

    it('reports error for non-matching unit pattern', () => {
      const output: LieutenantOutput = {
        directives: [
          {
            unit: 'nonexistent',
            nodes: [
              { id: 'hold', on: 'tick', action: { type: 'hold' } },
            ],
          },
        ],
      };
      
      const result = compileDirectives(output, availableUnits);
      
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('nonexistent');
    });

    it('includes default hold action for all compiled flowcharts', () => {
      const output: LieutenantOutput = {
        directives: [
          {
            unit: 'p_s1_0',
            nodes: [
              { id: 'engage', on: 'enemy_spotted', action: { type: 'engage' } },
            ],
          },
        ],
      };
      
      const result = compileDirectives(output, availableUnits);
      
      expect(result.flowcharts['p_s1_0']!.defaultAction).toEqual({ type: 'hold' });
    });
  });
});
