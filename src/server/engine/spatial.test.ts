import { describe, it, expect, afterEach } from 'vitest';
import {
  createSpatialWorld,
  addBody,
  removeBody,
  updateBodyPosition,
  queryRange,
  queryPairsInRange,
  destroySpatialWorld,
  SpatialWorld,
} from './spatial.js';

describe('Spatial World', () => {
  let world: SpatialWorld;

  afterEach(() => {
    if (world) destroySpatialWorld(world);
  });

  describe('createSpatialWorld', () => {
    it('creates a world with no bodies', () => {
      world = createSpatialWorld();
      expect(world.bodies.size).toBe(0);
    });
  });

  describe('addBody', () => {
    it('adds a body and tracks it', () => {
      world = createSpatialWorld();
      addBody(world, 'unit_1', { x: 100, y: 100 });

      expect(world.bodies.size).toBe(1);
      expect(world.bodies.has('unit_1')).toBe(true);
    });

    it('updates position if body already exists', () => {
      world = createSpatialWorld();
      addBody(world, 'unit_1', { x: 100, y: 100 });
      addBody(world, 'unit_1', { x: 200, y: 200 });

      expect(world.bodies.size).toBe(1);
      const body = world.bodies.get('unit_1')!;
      expect(body.position.x).toBeCloseTo(200);
      expect(body.position.y).toBeCloseTo(200);
    });
  });

  describe('removeBody', () => {
    it('removes a body', () => {
      world = createSpatialWorld();
      addBody(world, 'unit_1', { x: 100, y: 100 });
      removeBody(world, 'unit_1');

      expect(world.bodies.size).toBe(0);
    });

    it('handles removing non-existent body gracefully', () => {
      world = createSpatialWorld();
      expect(() => removeBody(world, 'nonexistent')).not.toThrow();
    });
  });

  describe('updateBodyPosition', () => {
    it('moves a body to a new position', () => {
      world = createSpatialWorld();
      addBody(world, 'unit_1', { x: 100, y: 100 });
      updateBodyPosition(world, 'unit_1', { x: 200, y: 300 });

      const body = world.bodies.get('unit_1')!;
      expect(body.position.x).toBeCloseTo(200);
      expect(body.position.y).toBeCloseTo(300);
    });
  });

  describe('queryRange', () => {
    it('finds bodies within range', () => {
      world = createSpatialWorld();
      addBody(world, 'a', { x: 100, y: 100 });
      addBody(world, 'b', { x: 110, y: 100 });
      addBody(world, 'c', { x: 500, y: 500 });

      const result = queryRange(world, { x: 100, y: 100 }, 50);

      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).not.toContain('c');
    });

    it('handles circular range (not just rectangular)', () => {
      world = createSpatialWorld();
      // Place a body at the corner of a 50x50 square around center
      // Distance from center to corner of 50x50 = sqrt(50^2 + 50^2) = ~70.7
      addBody(world, 'corner', { x: 150, y: 150 });

      const result = queryRange(world, { x: 100, y: 100 }, 60);

      // Corner is ~70.7 away, outside the 60 range
      expect(result).not.toContain('corner');
    });

    it('returns empty array when no bodies in range', () => {
      world = createSpatialWorld();
      addBody(world, 'far', { x: 1000, y: 1000 });

      const result = queryRange(world, { x: 0, y: 0 }, 50);
      expect(result).toHaveLength(0);
    });
  });

  describe('queryPairsInRange', () => {
    it('finds pairs within range', () => {
      world = createSpatialWorld();
      addBody(world, 'a', { x: 0, y: 0 });
      addBody(world, 'b', { x: 10, y: 0 });
      addBody(world, 'c', { x: 1000, y: 0 });

      const pairs = queryPairsInRange(world, 50);

      expect(pairs).toHaveLength(1);
      expect(pairs[0]).toEqual(['a', 'b']);
    });

    it('returns no pairs when bodies are far apart', () => {
      world = createSpatialWorld();
      addBody(world, 'a', { x: 0, y: 0 });
      addBody(world, 'b', { x: 1000, y: 1000 });

      const pairs = queryPairsInRange(world, 50);
      expect(pairs).toHaveLength(0);
    });
  });
});
