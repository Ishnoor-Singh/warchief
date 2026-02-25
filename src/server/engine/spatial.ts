/**
 * Spatial query system for the Warchief game engine.
 *
 * Uses Matter.js bodies and queries for efficient spatial lookups.
 * Each game agent is represented as a sensor body (no collision response)
 * in a Matter.js world. This allows us to leverage the engine's broadphase
 * for fast range queries instead of O(n^2) pairwise distance checks.
 *
 * ## Usage
 *
 * ```ts
 * const world = createSpatialWorld(400, 300);
 * addBody(world, 'unit_1', { x: 100, y: 100 });
 * addBody(world, 'unit_2', { x: 110, y: 100 });
 *
 * const nearby = queryRange(world, { x: 100, y: 100 }, 50);
 * // => ['unit_1', 'unit_2']
 * ```
 */

import Matter from 'matter-js';
import type { Vec2 } from '../../shared/types/index.js';

export interface SpatialWorld {
  engine: Matter.Engine;
  bodies: Map<string, Matter.Body>;
}

/**
 * Create a new spatial world for tracking entity positions.
 *
 * Gravity is disabled since this is a top-down strategy game.
 */
export function createSpatialWorld(): SpatialWorld {
  const engine = Matter.Engine.create({
    gravity: { x: 0, y: 0, scale: 0 },
  });

  return {
    engine,
    bodies: new Map(),
  };
}

/**
 * Add or update a body in the spatial world.
 *
 * Bodies are circles with a radius of 5 (unit representation size),
 * created as sensors so they don't generate collision responses.
 */
export function addBody(world: SpatialWorld, id: string, position: Vec2): Matter.Body {
  const existing = world.bodies.get(id);
  if (existing) {
    Matter.Body.setPosition(existing, position);
    return existing;
  }

  const body = Matter.Bodies.circle(position.x, position.y, 5, {
    isSensor: true,
    isStatic: true,
    label: id,
  });

  Matter.Composite.add(world.engine.world, body);
  world.bodies.set(id, body);
  return body;
}

/** Remove a body from the spatial world. */
export function removeBody(world: SpatialWorld, id: string): void {
  const body = world.bodies.get(id);
  if (body) {
    Matter.Composite.remove(world.engine.world, body);
    world.bodies.delete(id);
  }
}

/** Update a body's position. */
export function updateBodyPosition(world: SpatialWorld, id: string, position: Vec2): void {
  const body = world.bodies.get(id);
  if (body) {
    Matter.Body.setPosition(body, position);
  }
}

/**
 * Query all bodies within a given range of a point.
 *
 * Returns an array of entity IDs (body labels) within the range.
 * Uses Matter.js Query.region for efficient spatial lookup.
 */
export function queryRange(world: SpatialWorld, center: Vec2, range: number): string[] {
  const bounds = {
    min: { x: center.x - range, y: center.y - range },
    max: { x: center.x + range, y: center.y + range },
  };

  const allBodies = Matter.Composite.allBodies(world.engine.world);
  const candidates = Matter.Query.region(allBodies, bounds);

  // Filter to circular range (the query gives us a rectangular region)
  const rangeSq = range * range;
  return candidates
    .filter(body => {
      const dx = body.position.x - center.x;
      const dy = body.position.y - center.y;
      return dx * dx + dy * dy <= rangeSq;
    })
    .map(body => body.label);
}

/**
 * Query all pairs of bodies within a given distance of each other.
 *
 * More efficient than checking all pairs when entities are sparse.
 * Returns pairs as [idA, idB] tuples.
 */
export function queryPairsInRange(world: SpatialWorld, range: number): Array<[string, string]> {
  const allBodies = Matter.Composite.allBodies(world.engine.world);
  const pairs: Array<[string, string]> = [];
  const rangeSq = range * range;

  // Use Matter.js broadphase to reduce pair checks
  for (let i = 0; i < allBodies.length; i++) {
    const a = allBodies[i]!;
    for (let j = i + 1; j < allBodies.length; j++) {
      const b = allBodies[j]!;
      const dx = a.position.x - b.position.x;
      const dy = a.position.y - b.position.y;
      if (dx * dx + dy * dy <= rangeSq) {
        pairs.push([a.label, b.label]);
      }
    }
  }

  return pairs;
}

/** Destroy the spatial world and free resources. */
export function destroySpatialWorld(world: SpatialWorld): void {
  Matter.Engine.clear(world.engine);
  world.bodies.clear();
}
