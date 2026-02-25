import { describe, it, expect } from 'vitest';
import {
  isInsideFeature,
  getTerrainAt,
  getAllTerrainAt,
  getTerrainModifiers,
  getEffectiveVisibilityRadius,
  createTerrainMap,
  getTerrainTypeModifiers,
  type TerrainFeature,
  type TerrainMap,
} from './terrain.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHill(id: string, x: number, y: number, w: number, h: number): TerrainFeature {
  return { id, type: 'hill', position: { x, y }, size: { x: w, y: h } };
}

function makeForest(id: string, x: number, y: number, w: number, h: number): TerrainFeature {
  return { id, type: 'forest', position: { x, y }, size: { x: w, y: h } };
}

function makeRiver(id: string, x: number, y: number, w: number, h: number): TerrainFeature {
  return { id, type: 'river', position: { x, y }, size: { x: w, y: h } };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Terrain System', () => {
  describe('isInsideFeature', () => {
    it('returns true for a point inside the feature bounds', () => {
      const hill = makeHill('h1', 100, 100, 50, 50);
      expect(isInsideFeature({ x: 125, y: 125 }, hill)).toBe(true);
    });

    it('returns true for a point on the boundary', () => {
      const hill = makeHill('h1', 100, 100, 50, 50);
      expect(isInsideFeature({ x: 100, y: 100 }, hill)).toBe(true); // top-left
      expect(isInsideFeature({ x: 150, y: 150 }, hill)).toBe(true); // bottom-right
    });

    it('returns false for a point outside the feature', () => {
      const hill = makeHill('h1', 100, 100, 50, 50);
      expect(isInsideFeature({ x: 99, y: 125 }, hill)).toBe(false);
      expect(isInsideFeature({ x: 151, y: 125 }, hill)).toBe(false);
      expect(isInsideFeature({ x: 125, y: 99 }, hill)).toBe(false);
      expect(isInsideFeature({ x: 125, y: 151 }, hill)).toBe(false);
    });
  });

  describe('getTerrainAt', () => {
    it('returns null for empty terrain map', () => {
      const map = createTerrainMap();
      expect(getTerrainAt({ x: 50, y: 50 }, map)).toBeNull();
    });

    it('returns the feature when position is inside it', () => {
      const hill = makeHill('h1', 100, 100, 50, 50);
      const map = createTerrainMap([hill]);
      expect(getTerrainAt({ x: 125, y: 125 }, map)).toBe(hill);
    });

    it('returns null when position is outside all features', () => {
      const hill = makeHill('h1', 100, 100, 50, 50);
      const map = createTerrainMap([hill]);
      expect(getTerrainAt({ x: 0, y: 0 }, map)).toBeNull();
    });

    it('returns first matching feature when multiple overlap', () => {
      const hill = makeHill('h1', 100, 100, 50, 50);
      const forest = makeForest('f1', 120, 120, 50, 50);
      const map = createTerrainMap([hill, forest]);
      // Point at (130,130) is inside both
      expect(getTerrainAt({ x: 130, y: 130 }, map)).toBe(hill);
    });
  });

  describe('getAllTerrainAt', () => {
    it('returns empty array for open ground', () => {
      const map = createTerrainMap([makeHill('h1', 100, 100, 50, 50)]);
      expect(getAllTerrainAt({ x: 0, y: 0 }, map)).toEqual([]);
    });

    it('returns all overlapping features', () => {
      const hill = makeHill('h1', 100, 100, 50, 50);
      const forest = makeForest('f1', 120, 120, 50, 50);
      const map = createTerrainMap([hill, forest]);
      const result = getAllTerrainAt({ x: 130, y: 130 }, map);
      expect(result).toHaveLength(2);
      expect(result).toContain(hill);
      expect(result).toContain(forest);
    });
  });

  describe('getTerrainModifiers', () => {
    it('returns neutral modifiers for open ground', () => {
      const map = createTerrainMap();
      const mods = getTerrainModifiers({ x: 50, y: 50 }, map);
      expect(mods.defenseMultiplier).toBe(1.0);
      expect(mods.speedMultiplier).toBe(1.0);
      expect(mods.visibilityBonus).toBe(0);
      expect(mods.concealmentMultiplier).toBe(1.0);
    });

    it('returns hill modifiers on a hill', () => {
      const map = createTerrainMap([makeHill('h1', 0, 0, 100, 100)]);
      const mods = getTerrainModifiers({ x: 50, y: 50 }, map);
      expect(mods.defenseMultiplier).toBeLessThan(1.0); // takes less damage
      expect(mods.speedMultiplier).toBeLessThan(1.0);   // slightly slower
      expect(mods.visibilityBonus).toBeGreaterThan(0);   // sees farther
    });

    it('returns forest modifiers in a forest', () => {
      const map = createTerrainMap([makeForest('f1', 0, 0, 100, 100)]);
      const mods = getTerrainModifiers({ x: 50, y: 50 }, map);
      expect(mods.defenseMultiplier).toBeLessThan(1.0);     // takes less damage
      expect(mods.speedMultiplier).toBeLessThan(1.0);       // slower
      expect(mods.concealmentMultiplier).toBeLessThan(1.0); // harder to spot
    });

    it('returns river modifiers in a river', () => {
      const map = createTerrainMap([makeRiver('r1', 0, 0, 100, 100)]);
      const mods = getTerrainModifiers({ x: 50, y: 50 }, map);
      expect(mods.defenseMultiplier).toBeGreaterThan(1.0); // MORE damage taken
      expect(mods.speedMultiplier).toBeLessThan(0.5);      // very slow
    });

    it('stacks modifiers multiplicatively for overlapping features', () => {
      const hill = makeHill('h1', 0, 0, 100, 100);
      const forest = makeForest('f1', 0, 0, 100, 100);
      const map = createTerrainMap([hill, forest]);

      const hillMods = getTerrainTypeModifiers('hill');
      const forestMods = getTerrainTypeModifiers('forest');
      const combined = getTerrainModifiers({ x: 50, y: 50 }, map);

      expect(combined.defenseMultiplier).toBeCloseTo(hillMods.defenseMultiplier * forestMods.defenseMultiplier);
      expect(combined.speedMultiplier).toBeCloseTo(hillMods.speedMultiplier * forestMods.speedMultiplier);
    });
  });

  describe('getEffectiveVisibilityRadius', () => {
    it('returns base radius on open ground', () => {
      const map = createTerrainMap();
      const result = getEffectiveVisibilityRadius({ x: 0, y: 0 }, { x: 50, y: 50 }, 60, map);
      expect(result).toBe(60);
    });

    it('increases radius when viewer is on a hill', () => {
      const map = createTerrainMap([makeHill('h1', 0, 0, 50, 50)]);
      const result = getEffectiveVisibilityRadius({ x: 25, y: 25 }, { x: 200, y: 200 }, 60, map);
      expect(result).toBeGreaterThan(60);
    });

    it('decreases radius when target is in a forest', () => {
      const map = createTerrainMap([makeForest('f1', 190, 190, 50, 50)]);
      const result = getEffectiveVisibilityRadius({ x: 0, y: 0 }, { x: 200, y: 200 }, 60, map);
      expect(result).toBeLessThan(60);
    });

    it('combines viewer hill bonus with target forest concealment', () => {
      const map = createTerrainMap([
        makeHill('h1', 0, 0, 50, 50),
        makeForest('f1', 190, 190, 50, 50),
      ]);
      const hillOnly = getEffectiveVisibilityRadius({ x: 25, y: 25 }, { x: 100, y: 100 }, 60, map);
      const combined = getEffectiveVisibilityRadius({ x: 25, y: 25 }, { x: 200, y: 200 }, 60, map);
      // Hill bonus helps but forest concealment cuts it down
      expect(combined).toBeLessThan(hillOnly);
    });
  });

  describe('getTerrainTypeModifiers', () => {
    it('returns modifiers for each terrain type', () => {
      const hill = getTerrainTypeModifiers('hill');
      const forest = getTerrainTypeModifiers('forest');
      const river = getTerrainTypeModifiers('river');

      expect(hill.defenseMultiplier).toBeDefined();
      expect(forest.concealmentMultiplier).toBeDefined();
      expect(river.speedMultiplier).toBeDefined();
    });

    it('returns a copy (not the original object)', () => {
      const a = getTerrainTypeModifiers('hill');
      const b = getTerrainTypeModifiers('hill');
      expect(a).toEqual(b);
      a.defenseMultiplier = 999;
      expect(b.defenseMultiplier).not.toBe(999);
    });
  });

  describe('createTerrainMap', () => {
    it('creates empty map by default', () => {
      const map = createTerrainMap();
      expect(map.features).toEqual([]);
    });

    it('creates map with provided features', () => {
      const features = [makeHill('h1', 0, 0, 50, 50), makeForest('f1', 100, 100, 50, 50)];
      const map = createTerrainMap(features);
      expect(map.features).toHaveLength(2);
    });
  });
});
