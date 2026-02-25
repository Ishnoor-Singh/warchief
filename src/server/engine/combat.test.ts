import { describe, it, expect } from 'vitest';
import {
  calculateDamage,
  applyDamage,
  applyMoraleLoss,
  isInCombatRange,
  findCombatPairs,
  buildSquadCasualties,
  recordSquadDeath,
  getTeamStrength,
  checkWinCondition,
  COMBAT_RANGE,
  BASE_DAMAGE,
  MORALE_LOSS_ON_ALLY_DEATH,
  MORALE_EFFECT_RANGE,
  WIN_THRESHOLD,
} from './combat.js';
import { createTroop, createLieutenant } from './unit-types.js';
import type { AgentState } from '../../shared/types/index.js';

function makePlayerTroop(id: string, x: number, y: number, combat = 5): AgentState {
  return createTroop({
    id, team: 'player', position: { x, y },
    lieutenantId: 'lt_1', squadId: 'squad_1',
    stats: { combat },
  });
}

function makeEnemyTroop(id: string, x: number, y: number, combat = 5): AgentState {
  return createTroop({
    id, team: 'enemy', position: { x, y },
    lieutenantId: 'lt_e', squadId: 'enemy_squad_1',
    stats: { combat },
  });
}

describe('Combat Module', () => {
  describe('calculateDamage', () => {
    it('calculates damage based on combat stats', () => {
      const attacker = makePlayerTroop('a', 0, 0, 5);
      const defender = makeEnemyTroop('d', 10, 0, 5);

      // Use fixed rng at 0.5 (no variance)
      const result = calculateDamage(attacker, defender, () => 0.5);

      expect(result.attackerId).toBe('a');
      expect(result.defenderId).toBe('d');
      expect(result.damage).toBe(BASE_DAMAGE); // 10 * (5/5) * 1.0 = 10
      expect(result.defenderDied).toBe(false);
    });

    it('higher combat stat deals more damage', () => {
      const strong = makePlayerTroop('strong', 0, 0, 10);
      const weak = makeEnemyTroop('weak', 10, 0, 5);

      const result = calculateDamage(strong, weak, () => 0.5);
      expect(result.damage).toBe(BASE_DAMAGE * 2); // 10 * (10/5) = 20
    });

    it('lower combat stat deals less damage', () => {
      const weak = makePlayerTroop('weak', 0, 0, 2);
      const strong = makeEnemyTroop('strong', 10, 0, 10);

      const result = calculateDamage(weak, strong, () => 0.5);
      expect(result.damage).toBe(Math.max(1, Math.round(BASE_DAMAGE * 0.2)));
    });

    it('always deals at least 1 damage', () => {
      const weak = makePlayerTroop('weak', 0, 0, 1);
      const strong = makeEnemyTroop('strong', 10, 0, 10);

      const result = calculateDamage(weak, strong, () => 0.0); // max negative variance
      expect(result.damage).toBeGreaterThanOrEqual(1);
    });

    it('applies variance from rng', () => {
      const a = makePlayerTroop('a', 0, 0);
      const b = makeEnemyTroop('b', 10, 0);

      const low = calculateDamage(a, b, () => 0.0);
      const high = calculateDamage(a, b, () => 1.0);

      expect(high.damage).toBeGreaterThan(low.damage);
    });
  });

  describe('applyDamage', () => {
    it('reduces health', () => {
      const agent = makePlayerTroop('a', 0, 0);
      const died = applyDamage(agent, 30);

      expect(agent.health).toBe(70);
      expect(died).toBe(false);
      expect(agent.alive).toBe(true);
    });

    it('kills agent when health reaches 0', () => {
      const agent = makePlayerTroop('a', 0, 0);
      const died = applyDamage(agent, 100);

      expect(agent.health).toBe(0);
      expect(died).toBe(true);
      expect(agent.alive).toBe(false);
    });

    it('does not set health below 0', () => {
      const agent = makePlayerTroop('a', 0, 0);
      applyDamage(agent, 150);
      expect(agent.health).toBe(0);
    });
  });

  describe('applyMoraleLoss', () => {
    it('reduces morale for nearby allies', () => {
      const dead = makePlayerTroop('dead', 50, 50);
      dead.alive = false;

      const nearby = makePlayerTroop('nearby', 55, 50);
      const farAway = makePlayerTroop('far', 500, 500);

      const affected = applyMoraleLoss(dead, [dead, nearby, farAway]);

      expect(affected).toHaveLength(1);
      expect(affected[0]!.id).toBe('nearby');
      expect(nearby.morale).toBe(100 - MORALE_LOSS_ON_ALLY_DEATH);
      expect(farAway.morale).toBe(100); // unaffected
    });

    it('does not affect enemies', () => {
      const dead = makePlayerTroop('dead', 50, 50);
      dead.alive = false;
      const enemy = makeEnemyTroop('enemy', 55, 50);

      const affected = applyMoraleLoss(dead, [dead, enemy]);
      expect(affected).toHaveLength(0);
      expect(enemy.morale).toBe(100);
    });

    it('does not reduce morale below 0', () => {
      const dead = makePlayerTroop('dead', 50, 50);
      dead.alive = false;

      const nearby = makePlayerTroop('nearby', 55, 50);
      nearby.morale = 2; // very low morale

      applyMoraleLoss(dead, [dead, nearby]);
      expect(nearby.morale).toBe(0);
    });
  });

  describe('isInCombatRange', () => {
    it('returns true for units within combat range', () => {
      const a = makePlayerTroop('a', 0, 0);
      const b = makeEnemyTroop('b', COMBAT_RANGE - 1, 0);
      expect(isInCombatRange(a, b)).toBe(true);
    });

    it('returns true for units exactly at combat range', () => {
      const a = makePlayerTroop('a', 0, 0);
      const b = makeEnemyTroop('b', COMBAT_RANGE, 0);
      expect(isInCombatRange(a, b)).toBe(true);
    });

    it('returns false for units outside combat range', () => {
      const a = makePlayerTroop('a', 0, 0);
      const b = makeEnemyTroop('b', COMBAT_RANGE + 1, 0);
      expect(isInCombatRange(a, b)).toBe(false);
    });
  });

  describe('findCombatPairs', () => {
    it('finds pairs of opposing units in range', () => {
      const p = makePlayerTroop('p', 0, 0);
      const e = makeEnemyTroop('e', 10, 0);

      const pairs = findCombatPairs([p, e]);
      expect(pairs).toHaveLength(1);
      expect(pairs[0]).toEqual([p, e]);
    });

    it('does not pair same-team units', () => {
      const p1 = makePlayerTroop('p1', 0, 0);
      const p2 = makePlayerTroop('p2', 10, 0);

      const pairs = findCombatPairs([p1, p2]);
      expect(pairs).toHaveLength(0);
    });

    it('does not pair dead units', () => {
      const p = makePlayerTroop('p', 0, 0);
      const e = makeEnemyTroop('e', 10, 0);
      e.alive = false;

      const pairs = findCombatPairs([p, e]);
      expect(pairs).toHaveLength(0);
    });

    it('does not pair units out of range', () => {
      const p = makePlayerTroop('p', 0, 0);
      const e = makeEnemyTroop('e', 100, 0);

      const pairs = findCombatPairs([p, e]);
      expect(pairs).toHaveLength(0);
    });

    it('handles multiple combat pairs', () => {
      const p1 = makePlayerTroop('p1', 0, 0);
      const p2 = makePlayerTroop('p2', 50, 0);
      const e1 = makeEnemyTroop('e1', 10, 0);
      const e2 = makeEnemyTroop('e2', 55, 0);

      const pairs = findCombatPairs([p1, p2, e1, e2]);
      expect(pairs).toHaveLength(2);
    });
  });

  describe('Squad Casualty Tracking', () => {
    it('builds tracking from agents', () => {
      const squad = [
        makePlayerTroop('t1', 0, 0),
        makePlayerTroop('t2', 10, 0),
        makePlayerTroop('t3', 20, 0),
      ];

      const casualties = buildSquadCasualties(squad);
      const info = casualties.get('player:squad_1');
      expect(info).toEqual({ total: 3, dead: 0 });
    });

    it('ignores lieutenants', () => {
      const lt = createLieutenant({
        id: 'lt', team: 'player', position: { x: 0, y: 0 }, name: 'Test',
      });

      const casualties = buildSquadCasualties([lt]);
      expect(casualties.size).toBe(0);
    });

    it('records squad deaths', () => {
      const squad = [
        makePlayerTroop('t1', 0, 0),
        makePlayerTroop('t2', 10, 0),
        makePlayerTroop('t3', 20, 0),
        makePlayerTroop('t4', 30, 0),
      ];

      const casualties = buildSquadCasualties(squad);
      const percent = recordSquadDeath(casualties, squad[0]!);

      expect(percent).toBe(25);
      expect(casualties.get('player:squad_1')!.dead).toBe(1);
    });
  });

  describe('getTeamStrength', () => {
    it('counts alive and total troops per team', () => {
      const p1 = makePlayerTroop('p1', 0, 0);
      const p2 = makePlayerTroop('p2', 10, 0);
      p2.alive = false;
      const e1 = makeEnemyTroop('e1', 100, 0);

      const strength = getTeamStrength([p1, p2, e1]);

      expect(strength.player.alive).toBe(1);
      expect(strength.player.total).toBe(2);
      expect(strength.player.ratio).toBeCloseTo(0.5);
      expect(strength.enemy.alive).toBe(1);
      expect(strength.enemy.total).toBe(1);
    });

    it('ignores lieutenants', () => {
      const lt = createLieutenant({
        id: 'lt', team: 'player', position: { x: 0, y: 0 }, name: 'Test',
      });

      const strength = getTeamStrength([lt]);
      expect(strength.player.total).toBe(0);
    });
  });

  describe('checkWinCondition', () => {
    it('returns null when both teams have sufficient strength', () => {
      const agents = [
        ...Array.from({ length: 10 }, (_, i) => makePlayerTroop(`p${i}`, 0, i * 10)),
        ...Array.from({ length: 10 }, (_, i) => makeEnemyTroop(`e${i}`, 100, i * 10)),
      ];

      expect(checkWinCondition(agents)).toBeNull();
    });

    it('returns player when enemy below threshold', () => {
      const agents = [
        ...Array.from({ length: 10 }, (_, i) => makePlayerTroop(`p${i}`, 0, i * 10)),
        ...Array.from({ length: 10 }, (_, i) => {
          const t = makeEnemyTroop(`e${i}`, 100, i * 10);
          if (i >= 1) { t.alive = false; t.health = 0; }
          return t;
        }),
      ];

      // 1 out of 10 alive = 10% < 20% threshold
      expect(checkWinCondition(agents)).toBe('player');
    });

    it('returns enemy when player below threshold', () => {
      const agents = [
        ...Array.from({ length: 10 }, (_, i) => {
          const t = makePlayerTroop(`p${i}`, 0, i * 10);
          if (i >= 1) { t.alive = false; t.health = 0; }
          return t;
        }),
        ...Array.from({ length: 10 }, (_, i) => makeEnemyTroop(`e${i}`, 100, i * 10)),
      ];

      expect(checkWinCondition(agents)).toBe('enemy');
    });
  });
});
