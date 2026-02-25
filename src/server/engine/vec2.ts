/**
 * Vector math utilities for the Warchief game engine.
 *
 * Wraps Matter.js Vector module to provide well-tested 2D vector operations.
 * All functions are pure (no mutation) unless noted otherwise.
 */

import Matter from 'matter-js';

/** Re-export the base Vec2 type from shared. */
export type { Vec2 } from '../../shared/types/index.js';
import type { Vec2 } from '../../shared/types/index.js';

/** Create a new Vec2. */
export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

/** Vec2 at origin (0, 0). */
export const ZERO: Readonly<Vec2> = Object.freeze({ x: 0, y: 0 });

/** Add two vectors: a + b. */
export function add(a: Vec2, b: Vec2): Vec2 {
  return Matter.Vector.add(a, b);
}

/** Subtract b from a: a - b. */
export function sub(a: Vec2, b: Vec2): Vec2 {
  return Matter.Vector.sub(a, b);
}

/** Multiply vector by scalar. */
export function scale(v: Vec2, scalar: number): Vec2 {
  return Matter.Vector.mult(v, scalar);
}

/** Compute the magnitude (length) of a vector. */
export function magnitude(v: Vec2): number {
  return Matter.Vector.magnitude(v);
}

/** Compute squared magnitude (avoids sqrt, faster for comparisons). */
export function magnitudeSq(v: Vec2): number {
  return Matter.Vector.magnitudeSquared(v);
}

/** Return a unit vector (length 1) in the same direction. Returns ZERO for zero-length vectors. */
export function normalize(v: Vec2): Vec2 {
  const mag = magnitude(v);
  if (mag === 0) return { x: 0, y: 0 };
  return Matter.Vector.normalise(v);
}

/** Euclidean distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared distance between two points (avoids sqrt, faster for range checks). */
export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/** Dot product of two vectors. */
export function dot(a: Vec2, b: Vec2): number {
  return Matter.Vector.dot(a, b);
}

/** Cross product (scalar result in 2D: a.x*b.y - a.y*b.x). */
export function cross(a: Vec2, b: Vec2): number {
  return Matter.Vector.cross(a, b);
}

/** Angle of a vector in radians (from positive x-axis). */
export function angle(v: Vec2): number {
  return Matter.Vector.angle({ x: 0, y: 0 }, v);
}

/** Angle between two points in radians. */
export function angleBetween(from: Vec2, to: Vec2): number {
  return Matter.Vector.angle(from, to);
}

/** Rotate a vector by an angle (in radians) around origin. */
export function rotate(v: Vec2, angleRad: number): Vec2 {
  return Matter.Vector.rotate(v, angleRad);
}

/** Rotate a vector around a given center point. */
export function rotateAround(v: Vec2, center: Vec2, angleRad: number): Vec2 {
  const translated = sub(v, center);
  const rotated = rotate(translated, angleRad);
  return add(rotated, center);
}

/** Linear interpolation between two points. t=0 returns a, t=1 returns b. */
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/** Clamp a point within rectangular bounds. */
export function clamp(v: Vec2, minX: number, minY: number, maxX: number, maxY: number): Vec2 {
  return {
    x: Math.max(minX, Math.min(maxX, v.x)),
    y: Math.max(minY, Math.min(maxY, v.y)),
  };
}

/**
 * Move from `current` toward `target` by at most `maxDistance`.
 * Returns the new position. If within maxDistance, returns target exactly.
 */
export function moveToward(current: Vec2, target: Vec2, maxDistance: number): Vec2 {
  const dist = distance(current, target);
  if (dist <= maxDistance) {
    return { x: target.x, y: target.y };
  }
  const ratio = maxDistance / dist;
  return {
    x: current.x + (target.x - current.x) * ratio,
    y: current.y + (target.y - current.y) * ratio,
  };
}

/** Check if a point is within a given range of another point. */
export function isWithinRange(a: Vec2, b: Vec2, range: number): boolean {
  return distanceSq(a, b) <= range * range;
}

/** Deep copy a Vec2. */
export function clone(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}
