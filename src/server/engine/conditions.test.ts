import { describe, it, expect } from 'vitest';
import { evaluateCondition } from './conditions.js';
import type { GameEvent } from '../../shared/events/index.js';

describe('Condition Evaluator', () => {
  describe('basic comparisons', () => {
    it('evaluates less than', () => {
      const event = { type: 'enemy_spotted', distance: 30 } as GameEvent;
      expect(evaluateCondition('distance < 50', event)).toBe(true);
      expect(evaluateCondition('distance < 20', event)).toBe(false);
    });

    it('evaluates greater than', () => {
      const event = { type: 'enemy_spotted', distance: 30 } as GameEvent;
      expect(evaluateCondition('distance > 20', event)).toBe(true);
      expect(evaluateCondition('distance > 50', event)).toBe(false);
    });

    it('evaluates less than or equal', () => {
      const event = { type: 'enemy_spotted', distance: 30 } as GameEvent;
      expect(evaluateCondition('distance <= 30', event)).toBe(true);
      expect(evaluateCondition('distance <= 29', event)).toBe(false);
    });

    it('evaluates greater than or equal', () => {
      const event = { type: 'enemy_spotted', distance: 30 } as GameEvent;
      expect(evaluateCondition('distance >= 30', event)).toBe(true);
      expect(evaluateCondition('distance >= 31', event)).toBe(false);
    });

    it('evaluates equal', () => {
      const event = { type: 'enemy_spotted', distance: 30 } as GameEvent;
      expect(evaluateCondition('distance == 30', event)).toBe(true);
      expect(evaluateCondition('distance == 31', event)).toBe(false);
    });

    it('evaluates not equal', () => {
      const event = { type: 'enemy_spotted', distance: 30 } as GameEvent;
      expect(evaluateCondition('distance != 31', event)).toBe(true);
      expect(evaluateCondition('distance != 30', event)).toBe(false);
    });
  });

  describe('logical operators', () => {
    it('evaluates AND', () => {
      const event = { type: 'enemy_spotted', distance: 30, damage: 10 } as unknown as GameEvent;
      expect(evaluateCondition('distance < 50 && distance > 20', event)).toBe(true);
      expect(evaluateCondition('distance < 20 && distance > 10', event)).toBe(false);
    });

    it('evaluates OR', () => {
      const event = { type: 'enemy_spotted', distance: 30 } as GameEvent;
      expect(evaluateCondition('distance < 20 || distance > 25', event)).toBe(true);
      expect(evaluateCondition('distance < 20 || distance > 40', event)).toBe(false);
    });
  });

  describe('empty/undefined conditions', () => {
    it('returns true for empty string', () => {
      const event = { type: 'tick', tick: 1 } as GameEvent;
      expect(evaluateCondition('', event)).toBe(true);
    });

    it('returns true for undefined', () => {
      const event = { type: 'tick', tick: 1 } as GameEvent;
      expect(evaluateCondition(undefined, event)).toBe(true);
    });

    it('returns true for whitespace-only string', () => {
      const event = { type: 'tick', tick: 1 } as GameEvent;
      expect(evaluateCondition('   ', event)).toBe(true);
    });
  });

  describe('string comparisons', () => {
    it('evaluates string equality', () => {
      const event = { type: 'flanked', direction: 'left' } as GameEvent;
      expect(evaluateCondition('direction == "left"', event)).toBe(true);
      expect(evaluateCondition('direction == "right"', event)).toBe(false);
    });

    it('evaluates string inequality', () => {
      const event = { type: 'flanked', direction: 'rear' } as GameEvent;
      expect(evaluateCondition('direction != "left"', event)).toBe(true);
    });
  });

  describe('game-specific conditions', () => {
    it('evaluates casualty threshold condition', () => {
      const event = { type: 'casualty_threshold', lossPercent: 50 } as GameEvent;
      expect(evaluateCondition('lossPercent > 30', event)).toBe(true);
      expect(evaluateCondition('lossPercent > 75', event)).toBe(false);
    });

    it('evaluates damage-based conditions', () => {
      const event = { type: 'under_attack', attackerId: 'e1', damage: 25 } as GameEvent;
      expect(evaluateCondition('damage > 20', event)).toBe(true);
      expect(evaluateCondition('damage < 10', event)).toBe(false);
    });
  });

  describe('safety', () => {
    it('rejects process.exit() (no eval)', () => {
      const event = { type: 'tick', tick: 1 } as GameEvent;
      // This should NOT call process.exit - it should return false
      expect(evaluateCondition('process.exit()', event)).toBe(false);
    });

    it('rejects require() calls', () => {
      const event = { type: 'tick', tick: 1 } as GameEvent;
      expect(evaluateCondition('require("fs")', event)).toBe(false);
    });

    it('rejects arbitrary code', () => {
      const event = { type: 'tick', tick: 1 } as GameEvent;
      expect(evaluateCondition('while(true){}', event)).toBe(false);
    });

    it('handles unknown variables gracefully (returns 0)', () => {
      const event = { type: 'tick', tick: 1 } as GameEvent;
      expect(evaluateCondition('unknownVar > 0', event)).toBe(false);
    });
  });

  describe('parentheses', () => {
    it('respects parenthesized expressions', () => {
      const event = { type: 'enemy_spotted', distance: 30 } as GameEvent;
      // (30 < 50) => true, so the whole expression is true
      expect(evaluateCondition('(distance < 50)', event)).toBe(true);
    });
  });

  describe('decimal numbers', () => {
    it('handles decimal comparisons', () => {
      const event = { type: 'enemy_spotted', distance: 30.5 } as GameEvent;
      expect(evaluateCondition('distance > 30', event)).toBe(true);
      expect(evaluateCondition('distance < 31', event)).toBe(true);
    });
  });
});
