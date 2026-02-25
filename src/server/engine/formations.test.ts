import { describe, it, expect } from 'vitest';
import {
  computeFormationSlot,
  computeFormationPositions,
  FORMATION_SPACING,
  FORMATION_FORWARD_OFFSET,
} from './formations.js';
import type { FormationType, Vec2 } from '../../shared/types/index.js';

const CENTER: Vec2 = { x: 100, y: 100 };

describe('Formations Module', () => {
  describe('computeFormationSlot edge cases', () => {
    it('returns center for 0 total troops', () => {
      const pos = computeFormationSlot('line', CENTER, 0, 0);
      expect(pos).toEqual(CENTER);
    });

    it('returns center for negative index', () => {
      const pos = computeFormationSlot('line', CENTER, -1, 5);
      expect(pos).toEqual(CENTER);
    });

    it('returns center for index >= total', () => {
      const pos = computeFormationSlot('line', CENTER, 5, 5);
      expect(pos).toEqual(CENTER);
    });
  });

  describe('line formation', () => {
    it('arranges troops in a horizontal line', () => {
      const positions = computeFormationPositions('line', CENTER, 5);

      // All at same y (forward offset from center)
      for (const pos of positions) {
        expect(pos.y).toBeCloseTo(CENTER.y + FORMATION_FORWARD_OFFSET);
      }

      // Evenly spaced along x
      for (let i = 1; i < positions.length; i++) {
        const gap = positions[i]!.x - positions[i - 1]!.x;
        expect(gap).toBeCloseTo(FORMATION_SPACING);
      }
    });

    it('is centered on the leader position', () => {
      const positions = computeFormationPositions('line', CENTER, 3);
      const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
      expect(avgX).toBeCloseTo(CENTER.x);
    });

    it('single troop is directly in front of leader', () => {
      const positions = computeFormationPositions('line', CENTER, 1);
      expect(positions[0]!.x).toBeCloseTo(CENTER.x);
      expect(positions[0]!.y).toBeCloseTo(CENTER.y + FORMATION_FORWARD_OFFSET);
    });
  });

  describe('column formation', () => {
    it('arranges troops in a single file', () => {
      const positions = computeFormationPositions('column', CENTER, 4);

      // All at same x
      for (const pos of positions) {
        expect(pos.x).toBeCloseTo(CENTER.x);
      }

      // Extending forward from leader
      for (let i = 0; i < positions.length; i++) {
        expect(positions[i]!.y).toBeCloseTo(CENTER.y + 20 + i * FORMATION_SPACING);
      }
    });
  });

  describe('wedge formation', () => {
    it('creates a V-shape', () => {
      const positions = computeFormationPositions('wedge', CENTER, 6);

      // Troops should fan out from center
      // Index 0: left of center row 0
      // Index 1: right of center row 0
      // Index 2: further left row 1
      // Index 3: further right row 1

      // Each row should be further from center x
      for (let i = 2; i < positions.length; i++) {
        const currentRow = Math.floor(i / 2);
        const prevRow = Math.floor((i - 2) / 2);
        if (currentRow > prevRow) {
          const currentDist = Math.abs(positions[i]!.x - CENTER.x);
          const prevDist = Math.abs(positions[i - 2]!.x - CENTER.x);
          expect(currentDist).toBeGreaterThanOrEqual(prevDist);
        }
      }
    });
  });

  describe('defensive_circle formation', () => {
    it('arranges troops in a ring', () => {
      const positions = computeFormationPositions('defensive_circle', CENTER, 8);

      // All troops should be equidistant from center
      const distances = positions.map(p => {
        const dx = p.x - CENTER.x;
        const dy = p.y - CENTER.y;
        return Math.sqrt(dx * dx + dy * dy);
      });

      const avgDist = distances.reduce((s, d) => s + d, 0) / distances.length;
      for (const d of distances) {
        expect(d).toBeCloseTo(avgDist, 0);
      }
    });

    it('has minimum radius of 30', () => {
      const positions = computeFormationPositions('defensive_circle', CENTER, 2);
      const dist = Math.sqrt(
        (positions[0]!.x - CENTER.x) ** 2 +
        (positions[0]!.y - CENTER.y) ** 2
      );
      expect(dist).toBeGreaterThanOrEqual(30);
    });
  });

  describe('scatter formation', () => {
    it('produces distinct positions for each troop', () => {
      const positions = computeFormationPositions('scatter', CENTER, 9);

      // All positions should be unique
      const seen = new Set<string>();
      for (const pos of positions) {
        const key = `${Math.round(pos.x)},${Math.round(pos.y)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });

    it('arranges in a grid-like pattern', () => {
      const positions = computeFormationPositions('scatter', CENTER, 9);
      // 9 troops → 3x3 grid
      expect(positions).toHaveLength(9);
    });
  });

  describe('pincer formation', () => {
    it('creates two flanking groups', () => {
      const positions = computeFormationPositions('pincer', CENTER, 8);

      const left = positions.filter(p => p.x < CENTER.x);
      const right = positions.filter(p => p.x > CENTER.x);

      expect(left.length).toBe(4);
      expect(right.length).toBe(4);
    });

    it('flanking groups are offset from center', () => {
      const positions = computeFormationPositions('pincer', CENTER, 6);

      for (const pos of positions) {
        const dist = Math.abs(pos.x - CENTER.x);
        expect(dist).toBeCloseTo(40);
      }
    });

    it('handles odd numbers of troops', () => {
      const positions = computeFormationPositions('pincer', CENTER, 7);
      expect(positions).toHaveLength(7);

      // Left group has ceil(7/2) = 4, right has 3
      const left = positions.filter(p => p.x < CENTER.x);
      const right = positions.filter(p => p.x > CENTER.x);
      expect(left.length).toBe(4);
      expect(right.length).toBe(3);
    });
  });

  describe('computeFormationPositions', () => {
    it('returns correct number of positions', () => {
      const formations: FormationType[] = ['line', 'column', 'wedge', 'defensive_circle', 'scatter', 'pincer'];

      for (const formation of formations) {
        const positions = computeFormationPositions(formation, CENTER, 10);
        expect(positions, `${formation} should have 10 positions`).toHaveLength(10);
      }
    });

    it('all positions are finite numbers', () => {
      const formations: FormationType[] = ['line', 'column', 'wedge', 'defensive_circle', 'scatter', 'pincer'];

      for (const formation of formations) {
        const positions = computeFormationPositions(formation, CENTER, 10);
        for (const pos of positions) {
          expect(isFinite(pos.x), `${formation} x should be finite`).toBe(true);
          expect(isFinite(pos.y), `${formation} y should be finite`).toBe(true);
        }
      }
    });
  });
});
