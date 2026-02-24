// Tests for flowchart runtime - especially next/else chaining

import { describe, it, expect } from 'vitest';
import {
  createFlowchartRuntime,
  queueEvent,
  processEvents,
  evaluateCondition,
  Flowchart,
} from './flowchart.js';
import { GameEvent } from '../../shared/events/index.js';

describe('Flowchart Runtime', () => {
  describe('next/else chaining', () => {
    it('follows next chain to execute multiple actions', () => {
      const flowchart: Flowchart = {
        agentId: 'test_agent',
        nodes: [
          {
            id: 'step1',
            on: 'enemy_spotted',
            action: { type: 'setFormation', formation: 'wedge' },
            next: 'step2',
            priority: 10,
          },
          {
            id: 'step2',
            on: 'enemy_spotted', // event type must match for lookup, but chained via next
            action: { type: 'engage', targetId: '' },
          },
        ],
        defaultAction: { type: 'hold' },
      };

      const runtime = createFlowchartRuntime(flowchart);
      const event: GameEvent = {
        type: 'enemy_spotted',
        enemyId: 'e1',
        position: { x: 100, y: 100 },
        distance: 30,
      };
      queueEvent(runtime, event);
      const actions = processEvents(runtime);

      expect(actions).toHaveLength(2);
      expect(actions[0]!.type).toBe('setFormation');
      expect(actions[1]!.type).toBe('engage');
    });

    it('follows else branch when condition fails', () => {
      const flowchart: Flowchart = {
        agentId: 'test_agent',
        nodes: [
          {
            id: 'engage_close',
            on: 'enemy_spotted',
            condition: 'distance < 20',
            action: { type: 'engage', targetId: '' },
            else: 'fallback_far',
            priority: 10,
          },
          {
            id: 'fallback_far',
            on: 'enemy_spotted',
            action: { type: 'fallback', position: { x: 0, y: 0 } },
          },
        ],
        defaultAction: { type: 'hold' },
      };

      const runtime = createFlowchartRuntime(flowchart);
      // Distance is 80, so condition "distance < 20" fails → should follow else
      const event: GameEvent = {
        type: 'enemy_spotted',
        enemyId: 'e1',
        position: { x: 100, y: 100 },
        distance: 80,
      };
      queueEvent(runtime, event);
      const actions = processEvents(runtime);

      expect(actions).toHaveLength(1);
      expect(actions[0]!.type).toBe('fallback');
    });

    it('limits chain depth to prevent infinite loops', () => {
      // Create a circular chain: A → B → A
      const flowchart: Flowchart = {
        agentId: 'test_agent',
        nodes: [
          {
            id: 'nodeA',
            on: 'enemy_spotted',
            action: { type: 'hold' },
            next: 'nodeB',
            priority: 10,
          },
          {
            id: 'nodeB',
            on: 'enemy_spotted',
            action: { type: 'hold' },
            next: 'nodeA', // circular!
          },
        ],
        defaultAction: { type: 'hold' },
      };

      const runtime = createFlowchartRuntime(flowchart);
      queueEvent(runtime, {
        type: 'enemy_spotted',
        enemyId: 'e1',
        position: { x: 100, y: 100 },
        distance: 30,
      });
      const actions = processEvents(runtime);

      // Should not hang — depth limit of 10 caps it
      // First action from nodeA + up to 10 chain steps
      expect(actions.length).toBeLessThanOrEqual(12);
      expect(actions.length).toBeGreaterThan(1);
    });
  });

  describe('evaluateCondition', () => {
    it('evaluates simple comparisons', () => {
      const event = { type: 'enemy_spotted', distance: 30 } as GameEvent;
      expect(evaluateCondition('distance < 50', event)).toBe(true);
      expect(evaluateCondition('distance > 50', event)).toBe(false);
      expect(evaluateCondition('distance >= 30', event)).toBe(true);
    });

    it('returns true for empty condition', () => {
      const event = { type: 'tick', tick: 1 } as GameEvent;
      expect(evaluateCondition('', event)).toBe(true);
    });

    it('rejects unsafe expressions', () => {
      const event = { type: 'tick', tick: 1 } as GameEvent;
      // Should be rejected by the regex guard
      expect(evaluateCondition('process.exit()', event)).toBe(false);
    });
  });

  describe('processEvents returns flat action arrays', () => {
    it('returns multiple actions from multiple events', () => {
      const flowchart: Flowchart = {
        agentId: 'test_agent',
        nodes: [
          {
            id: 'engage',
            on: 'enemy_spotted',
            action: { type: 'engage', targetId: '' },
            priority: 10,
          },
          {
            id: 'defend',
            on: 'under_attack',
            action: { type: 'engage', targetId: '' },
            priority: 10,
          },
        ],
        defaultAction: { type: 'hold' },
      };

      const runtime = createFlowchartRuntime(flowchart);
      queueEvent(runtime, {
        type: 'enemy_spotted',
        enemyId: 'e1',
        position: { x: 100, y: 100 },
        distance: 30,
      });
      queueEvent(runtime, {
        type: 'under_attack',
        attackerId: 'e1',
        damage: 10,
      });

      const actions = processEvents(runtime);
      expect(actions).toHaveLength(2);
    });
  });
});
