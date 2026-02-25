import { describe, it, expect } from 'vitest';
import {
  vec2, ZERO,
  add, sub, scale,
  magnitude, magnitudeSq,
  normalize, distance, distanceSq,
  dot, cross,
  angle, angleBetween,
  rotate, rotateAround,
  lerp, clamp, moveToward, isWithinRange, clone,
} from './vec2.js';

describe('Vec2 Utilities', () => {
  describe('vec2', () => {
    it('creates a vector with given coordinates', () => {
      const v = vec2(3, 4);
      expect(v).toEqual({ x: 3, y: 4 });
    });
  });

  describe('ZERO', () => {
    it('is the zero vector', () => {
      expect(ZERO).toEqual({ x: 0, y: 0 });
    });

    it('is frozen (immutable)', () => {
      expect(Object.isFrozen(ZERO)).toBe(true);
    });
  });

  describe('add', () => {
    it('adds two vectors', () => {
      const result = add({ x: 1, y: 2 }, { x: 3, y: 4 });
      expect(result.x).toBeCloseTo(4);
      expect(result.y).toBeCloseTo(6);
    });

    it('handles negative values', () => {
      const result = add({ x: 5, y: -3 }, { x: -2, y: 7 });
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(4);
    });
  });

  describe('sub', () => {
    it('subtracts b from a', () => {
      const result = sub({ x: 5, y: 7 }, { x: 2, y: 3 });
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(4);
    });
  });

  describe('scale', () => {
    it('multiplies vector by scalar', () => {
      const result = scale({ x: 3, y: 4 }, 2);
      expect(result.x).toBeCloseTo(6);
      expect(result.y).toBeCloseTo(8);
    });

    it('handles zero scalar', () => {
      const result = scale({ x: 3, y: 4 }, 0);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });

    it('handles negative scalar', () => {
      const result = scale({ x: 3, y: 4 }, -1);
      expect(result.x).toBeCloseTo(-3);
      expect(result.y).toBeCloseTo(-4);
    });
  });

  describe('magnitude', () => {
    it('calculates vector length', () => {
      expect(magnitude({ x: 3, y: 4 })).toBeCloseTo(5);
    });

    it('returns 0 for zero vector', () => {
      expect(magnitude({ x: 0, y: 0 })).toBe(0);
    });

    it('handles unit vectors', () => {
      expect(magnitude({ x: 1, y: 0 })).toBeCloseTo(1);
      expect(magnitude({ x: 0, y: 1 })).toBeCloseTo(1);
    });
  });

  describe('magnitudeSq', () => {
    it('calculates squared length', () => {
      expect(magnitudeSq({ x: 3, y: 4 })).toBeCloseTo(25);
    });
  });

  describe('normalize', () => {
    it('returns unit vector in same direction', () => {
      const n = normalize({ x: 3, y: 4 });
      expect(magnitude(n)).toBeCloseTo(1);
      expect(n.x).toBeCloseTo(0.6);
      expect(n.y).toBeCloseTo(0.8);
    });

    it('returns zero for zero vector', () => {
      const n = normalize({ x: 0, y: 0 });
      expect(n).toEqual({ x: 0, y: 0 });
    });
  });

  describe('distance', () => {
    it('calculates euclidean distance', () => {
      expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
    });

    it('returns 0 for same point', () => {
      const p = { x: 10, y: 20 };
      expect(distance(p, p)).toBe(0);
    });

    it('is symmetric', () => {
      const a = { x: 1, y: 2 };
      const b = { x: 4, y: 6 };
      expect(distance(a, b)).toBeCloseTo(distance(b, a));
    });
  });

  describe('distanceSq', () => {
    it('calculates squared distance', () => {
      expect(distanceSq({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(25);
    });
  });

  describe('dot', () => {
    it('computes dot product', () => {
      expect(dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(0);
      expect(dot({ x: 1, y: 2 }, { x: 3, y: 4 })).toBeCloseTo(11);
    });
  });

  describe('cross', () => {
    it('computes 2D cross product', () => {
      expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(1);
      expect(cross({ x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(-1);
    });
  });

  describe('lerp', () => {
    it('returns a at t=0', () => {
      const result = lerp({ x: 0, y: 0 }, { x: 10, y: 10 }, 0);
      expect(result).toEqual({ x: 0, y: 0 });
    });

    it('returns b at t=1', () => {
      const result = lerp({ x: 0, y: 0 }, { x: 10, y: 10 }, 1);
      expect(result).toEqual({ x: 10, y: 10 });
    });

    it('returns midpoint at t=0.5', () => {
      const result = lerp({ x: 0, y: 0 }, { x: 10, y: 10 }, 0.5);
      expect(result).toEqual({ x: 5, y: 5 });
    });
  });

  describe('clamp', () => {
    it('clamps within bounds', () => {
      const result = clamp({ x: -5, y: 200 }, 0, 0, 100, 100);
      expect(result).toEqual({ x: 0, y: 100 });
    });

    it('leaves point unchanged when inside bounds', () => {
      const result = clamp({ x: 50, y: 50 }, 0, 0, 100, 100);
      expect(result).toEqual({ x: 50, y: 50 });
    });
  });

  describe('moveToward', () => {
    it('moves toward target by given distance', () => {
      const result = moveToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 3);
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(0);
    });

    it('snaps to target when within distance', () => {
      const result = moveToward({ x: 0, y: 0 }, { x: 2, y: 0 }, 5);
      expect(result.x).toBeCloseTo(2);
      expect(result.y).toBeCloseTo(0);
    });

    it('handles diagonal movement', () => {
      const result = moveToward({ x: 0, y: 0 }, { x: 3, y: 4 }, 5);
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(4);
    });

    it('handles zero distance', () => {
      const result = moveToward({ x: 5, y: 5 }, { x: 5, y: 5 }, 3);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(5);
    });
  });

  describe('isWithinRange', () => {
    it('returns true when within range', () => {
      expect(isWithinRange({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(true);
    });

    it('returns true when exactly at range', () => {
      expect(isWithinRange({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(true);
    });

    it('returns false when outside range', () => {
      expect(isWithinRange({ x: 0, y: 0 }, { x: 3, y: 4 }, 4)).toBe(false);
    });
  });

  describe('clone', () => {
    it('creates a copy', () => {
      const original = { x: 5, y: 10 };
      const copy = clone(original);
      expect(copy).toEqual(original);
      expect(copy).not.toBe(original);
    });

    it('copy is independent from original', () => {
      const original = { x: 5, y: 10 };
      const copy = clone(original);
      copy.x = 99;
      expect(original.x).toBe(5);
    });
  });

  describe('rotate', () => {
    it('rotates 90 degrees', () => {
      const result = rotate({ x: 1, y: 0 }, Math.PI / 2);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });

    it('rotates 180 degrees', () => {
      const result = rotate({ x: 1, y: 0 }, Math.PI);
      expect(result.x).toBeCloseTo(-1);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe('rotateAround', () => {
    it('rotates point around center', () => {
      const result = rotateAround({ x: 2, y: 0 }, { x: 1, y: 0 }, Math.PI / 2);
      expect(result.x).toBeCloseTo(1);
      expect(result.y).toBeCloseTo(1);
    });
  });
});
