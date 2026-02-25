import { describe, it, expect } from 'vitest';
import {
  createTroop,
  createLieutenant,
  createSquad,
  isTroop,
  isLieutenant,
  getTroopStats,
  getLieutenantStats,
  DEFAULT_TROOP_STATS,
  DEFAULT_LIEUTENANT_STATS,
  TROOP_PRESETS,
  LIEUTENANT_PRESETS,
  TROOP_VISIBILITY_RADIUS,
  LIEUTENANT_VISIBILITY_RADIUS,
  DEFAULT_HEALTH,
  DEFAULT_MORALE,
} from './unit-types.js';

describe('Unit Types', () => {
  describe('createTroop', () => {
    it('creates a troop with default stats', () => {
      const troop = createTroop({
        id: 'test_troop',
        team: 'player',
        position: { x: 100, y: 200 },
        lieutenantId: 'lt_1',
        squadId: 'squad_1',
      });

      expect(troop.id).toBe('test_troop');
      expect(troop.type).toBe('troop');
      expect(troop.team).toBe('player');
      expect(troop.position).toEqual({ x: 100, y: 200 });
      expect(troop.health).toBe(DEFAULT_HEALTH);
      expect(troop.maxHealth).toBe(DEFAULT_HEALTH);
      expect(troop.morale).toBe(DEFAULT_MORALE);
      expect(troop.alive).toBe(true);
      expect(troop.stats).toEqual(DEFAULT_TROOP_STATS);
      expect(troop.lieutenantId).toBe('lt_1');
      expect(troop.squadId).toBe('squad_1');
      expect(troop.visibilityRadius).toBe(TROOP_VISIBILITY_RADIUS);
    });

    it('creates a troop with custom stats', () => {
      const troop = createTroop({
        id: 'custom',
        team: 'enemy',
        position: { x: 0, y: 0 },
        lieutenantId: 'lt_1',
        squadId: 'squad_1',
        stats: { combat: 8, speed: 3 },
      });

      expect(troop.stats.combat).toBe(8);
      expect(troop.stats.speed).toBe(3);
      expect(troop.stats.courage).toBe(DEFAULT_TROOP_STATS.courage);
      expect(troop.stats.discipline).toBe(DEFAULT_TROOP_STATS.discipline);
    });

    it('creates a troop with a preset', () => {
      const troop = createTroop({
        id: 'vanguard',
        team: 'player',
        position: { x: 0, y: 0 },
        lieutenantId: 'lt_1',
        squadId: 'squad_1',
        preset: 'vanguard',
      });

      expect(troop.stats.combat).toBe(TROOP_PRESETS.vanguard.combat);
      expect(troop.stats.speed).toBe(TROOP_PRESETS.vanguard.speed);
      expect(troop.stats.courage).toBe(TROOP_PRESETS.vanguard.courage);
    });

    it('preset stats can be overridden', () => {
      const troop = createTroop({
        id: 'custom_vanguard',
        team: 'player',
        position: { x: 0, y: 0 },
        lieutenantId: 'lt_1',
        squadId: 'squad_1',
        preset: 'vanguard',
        stats: { combat: 10 },
      });

      expect(troop.stats.combat).toBe(10);
      expect(troop.stats.speed).toBe(TROOP_PRESETS.vanguard.speed);
    });

    it('creates an independent copy of position', () => {
      const pos = { x: 100, y: 200 };
      const troop = createTroop({
        id: 'test',
        team: 'player',
        position: pos,
        lieutenantId: 'lt_1',
        squadId: 'squad_1',
      });

      pos.x = 999;
      expect(troop.position.x).toBe(100);
    });

    it('supports custom health and morale', () => {
      const troop = createTroop({
        id: 'test',
        team: 'player',
        position: { x: 0, y: 0 },
        lieutenantId: 'lt_1',
        squadId: 'squad_1',
        health: 50,
        morale: 75,
      });

      expect(troop.health).toBe(50);
      expect(troop.maxHealth).toBe(50);
      expect(troop.morale).toBe(75);
    });
  });

  describe('createLieutenant', () => {
    it('creates a lieutenant with default stats', () => {
      const lt = createLieutenant({
        id: 'lt_test',
        team: 'player',
        position: { x: 50, y: 50 },
        name: 'Test Lt',
      });

      expect(lt.id).toBe('lt_test');
      expect(lt.type).toBe('lieutenant');
      expect(lt.team).toBe('player');
      expect(lt.name).toBe('Test Lt');
      expect(lt.personality).toBe('disciplined'); // default
      expect(lt.stats).toEqual(DEFAULT_LIEUTENANT_STATS);
      expect(lt.visibilityRadius).toBe(LIEUTENANT_VISIBILITY_RADIUS);
      expect(lt.lieutenantId).toBeNull();
      expect(lt.squadId).toBeNull();
    });

    it('creates a lieutenant with a preset', () => {
      const lt = createLieutenant({
        id: 'lt_aggro',
        team: 'enemy',
        position: { x: 0, y: 0 },
        name: 'Aggressive Lt',
        preset: 'aggressive',
      });

      expect(lt.personality).toBe('aggressive');
      expect(lt.stats.initiative).toBe(LIEUTENANT_PRESETS.aggressive.stats.initiative);
      expect(lt.stats.discipline).toBe(LIEUTENANT_PRESETS.aggressive.stats.discipline);
    });

    it('supports troop IDs list', () => {
      const lt = createLieutenant({
        id: 'lt_test',
        team: 'player',
        position: { x: 0, y: 0 },
        name: 'Test',
        troopIds: ['t1', 't2', 't3'],
      });

      expect(lt.troopIds).toEqual(['t1', 't2', 't3']);
    });

    it('defaults troopIds to empty array', () => {
      const lt = createLieutenant({
        id: 'lt_test',
        team: 'player',
        position: { x: 0, y: 0 },
        name: 'Test',
      });

      expect(lt.troopIds).toEqual([]);
    });
  });

  describe('createSquad', () => {
    it('creates the correct number of troops', () => {
      const squad = createSquad('sq', 5, {
        team: 'player',
        centerPosition: { x: 100, y: 100 },
        lieutenantId: 'lt_1',
        squadId: 'squad_1',
      });

      expect(squad).toHaveLength(5);
    });

    it('generates correct IDs', () => {
      const squad = createSquad('alpha', 3, {
        team: 'player',
        centerPosition: { x: 0, y: 0 },
        lieutenantId: 'lt_1',
        squadId: 'squad_1',
      });

      expect(squad.map(t => t.id)).toEqual(['alpha_0', 'alpha_1', 'alpha_2']);
    });

    it('spaces troops evenly along x-axis', () => {
      const squad = createSquad('sq', 3, {
        team: 'player',
        centerPosition: { x: 100, y: 100 },
        lieutenantId: 'lt_1',
        squadId: 'squad_1',
      });

      // 3 troops with 15 spacing: positions at 85, 100, 115
      expect(squad[0]!.position.x).toBeCloseTo(85);
      expect(squad[1]!.position.x).toBeCloseTo(100);
      expect(squad[2]!.position.x).toBeCloseTo(115);
      // All at same y
      expect(squad[0]!.position.y).toBe(100);
    });

    it('all troops share the same squad and lieutenant', () => {
      const squad = createSquad('sq', 4, {
        team: 'enemy',
        centerPosition: { x: 0, y: 0 },
        lieutenantId: 'lt_enemy',
        squadId: 'enemy_squad_1',
      });

      for (const troop of squad) {
        expect(troop.lieutenantId).toBe('lt_enemy');
        expect(troop.squadId).toBe('enemy_squad_1');
        expect(troop.team).toBe('enemy');
      }
    });

    it('supports presets', () => {
      const squad = createSquad('sq', 2, {
        team: 'player',
        centerPosition: { x: 0, y: 0 },
        lieutenantId: 'lt_1',
        squadId: 'squad_1',
        preset: 'berserker',
      });

      for (const troop of squad) {
        expect(troop.stats.combat).toBe(TROOP_PRESETS.berserker.combat);
      }
    });
  });

  describe('type guards', () => {
    const troop = createTroop({
      id: 'troop',
      team: 'player',
      position: { x: 0, y: 0 },
      lieutenantId: 'lt',
      squadId: 'sq',
    });

    const lt = createLieutenant({
      id: 'lt',
      team: 'player',
      position: { x: 0, y: 0 },
      name: 'Test',
    });

    it('isTroop returns true for troops', () => {
      expect(isTroop(troop)).toBe(true);
      expect(isTroop(lt)).toBe(false);
    });

    it('isLieutenant returns true for lieutenants', () => {
      expect(isLieutenant(lt)).toBe(true);
      expect(isLieutenant(troop)).toBe(false);
    });

    it('getTroopStats returns stats for troops', () => {
      const stats = getTroopStats(troop);
      expect(stats.combat).toBeDefined();
      expect(stats.speed).toBeDefined();
    });

    it('getTroopStats throws for lieutenants', () => {
      expect(() => getTroopStats(lt)).toThrow();
    });

    it('getLieutenantStats returns stats for lieutenants', () => {
      const stats = getLieutenantStats(lt);
      expect(stats.initiative).toBeDefined();
    });

    it('getLieutenantStats throws for troops', () => {
      expect(() => getLieutenantStats(troop)).toThrow();
    });
  });

  describe('troop presets', () => {
    it('all presets have valid stat ranges', () => {
      for (const [name, stats] of Object.entries(TROOP_PRESETS)) {
        expect(stats.combat, `${name}.combat`).toBeGreaterThanOrEqual(1);
        expect(stats.combat, `${name}.combat`).toBeLessThanOrEqual(10);
        expect(stats.speed, `${name}.speed`).toBeGreaterThan(0);
        expect(stats.courage, `${name}.courage`).toBeGreaterThanOrEqual(1);
        expect(stats.courage, `${name}.courage`).toBeLessThanOrEqual(10);
        expect(stats.discipline, `${name}.discipline`).toBeGreaterThanOrEqual(1);
        expect(stats.discipline, `${name}.discipline`).toBeLessThanOrEqual(10);
      }
    });

    it('has expected archetypes', () => {
      expect(TROOP_PRESETS.infantry).toBeDefined();
      expect(TROOP_PRESETS.scout).toBeDefined();
      expect(TROOP_PRESETS.vanguard).toBeDefined();
      expect(TROOP_PRESETS.archer).toBeDefined();
      expect(TROOP_PRESETS.berserker).toBeDefined();
      expect(TROOP_PRESETS.guardian).toBeDefined();
      expect(TROOP_PRESETS.militia).toBeDefined();
    });

    it('scout is faster than vanguard', () => {
      expect(TROOP_PRESETS.scout.speed).toBeGreaterThan(TROOP_PRESETS.vanguard.speed);
    });

    it('vanguard has higher combat than militia', () => {
      expect(TROOP_PRESETS.vanguard.combat).toBeGreaterThan(TROOP_PRESETS.militia.combat);
    });

    it('guardian has high courage and discipline', () => {
      expect(TROOP_PRESETS.guardian.courage).toBeGreaterThanOrEqual(8);
      expect(TROOP_PRESETS.guardian.discipline).toBeGreaterThanOrEqual(7);
    });
  });
});
