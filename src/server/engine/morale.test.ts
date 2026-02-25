import { describe, it, expect } from 'vitest';
import {
  shouldRout,
  applyRoutingPanic,
  checkMoraleRecovery,
  ROUT_MORALE_THRESHOLD,
  ROUTING_PANIC_RANGE,
  ROUTING_PANIC_MORALE_LOSS,
  MORALE_RECOVERY_RATE,
} from './morale.js';
import { createTroop, createLieutenant } from './unit-types.js';
import type { AgentState } from '../../shared/types/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTroop(id: string, morale: number, courage: number, opts?: {
  team?: 'player' | 'enemy';
  x?: number; y?: number;
}): AgentState {
  const troop = createTroop({
    id,
    team: opts?.team ?? 'player',
    position: { x: opts?.x ?? 0, y: opts?.y ?? 0 },
    lieutenantId: 'lt_1',
    squadId: 'squad_1',
    stats: { courage },
  });
  troop.morale = morale;
  return troop;
}

// ─── Routing Checks ──────────────────────────────────────────────────────────

describe('Morale & Routing System', () => {
  describe('shouldRout', () => {
    it('never routes when morale is high', () => {
      // With full morale (100), even low courage should not rout
      // Test with deterministic rng that always returns 0 (worst case)
      const result = shouldRout(100, 5, () => 1.0);
      expect(result).toBe(false);
    });

    it('always routes when morale is 0', () => {
      // Completely broken morale should always rout regardless of courage
      const result = shouldRout(0, 10, () => 0.0);
      expect(result).toBe(true);
    });

    it('low courage makes routing more likely at moderate morale', () => {
      // At moderate morale, low courage troops should rout more often
      let lowCourageRouts = 0;
      let highCourageRouts = 0;
      const runs = 1000;

      for (let i = 0; i < runs; i++) {
        const rng = () => Math.random();
        if (shouldRout(30, 2, rng)) lowCourageRouts++;
        if (shouldRout(30, 9, rng)) highCourageRouts++;
      }

      // Low courage should rout significantly more often
      expect(lowCourageRouts).toBeGreaterThan(highCourageRouts);
    });

    it('does not rout when morale is above threshold', () => {
      // Troops above the rout threshold should never rout
      const result = shouldRout(ROUT_MORALE_THRESHOLD + 10, 5, () => 0.0);
      expect(result).toBe(false);
    });

    it('may rout when morale is below threshold', () => {
      // With very low morale and worst-case rng, should rout
      const result = shouldRout(5, 1, () => 0.0);
      expect(result).toBe(true);
    });

    it('high courage resists routing at moderate-low morale', () => {
      // courage 10 troops should resist routing at moderate morale
      const result = shouldRout(30, 10, () => 0.99);
      expect(result).toBe(false);
    });
  });

  describe('applyRoutingPanic', () => {
    it('reduces morale of nearby same-team units', () => {
      const router = makeTroop('router', 10, 3, { x: 50, y: 50 });
      const nearby = makeTroop('nearby', 80, 5, { x: 55, y: 50 });
      const farAway = makeTroop('far', 80, 5, { x: 500, y: 500 });
      const enemy = makeTroop('enemy', 80, 5, { x: 55, y: 50, team: 'enemy' });

      const affected = applyRoutingPanic(router, [router, nearby, farAway, enemy]);

      expect(affected).toHaveLength(1);
      expect(affected[0]!.id).toBe('nearby');
      expect(nearby.morale).toBeLessThan(80);
      expect(farAway.morale).toBe(80); // not affected
      expect(enemy.morale).toBe(80);   // enemies not affected
    });

    it('does not reduce morale below 0', () => {
      const router = makeTroop('router', 5, 3, { x: 50, y: 50 });
      const nearby = makeTroop('nearby', 3, 5, { x: 55, y: 50 });

      applyRoutingPanic(router, [router, nearby]);
      expect(nearby.morale).toBeGreaterThanOrEqual(0);
    });

    it('does not affect dead units', () => {
      const router = makeTroop('router', 5, 3, { x: 50, y: 50 });
      const dead = makeTroop('dead', 80, 5, { x: 55, y: 50 });
      dead.alive = false;

      const affected = applyRoutingPanic(router, [router, dead]);
      expect(affected).toHaveLength(0);
    });

    it('affects units within ROUTING_PANIC_RANGE', () => {
      const router = makeTroop('router', 5, 3, { x: 0, y: 0 });
      const justInRange = makeTroop('near', 80, 5, { x: ROUTING_PANIC_RANGE - 1, y: 0 });
      const justOutOfRange = makeTroop('out', 80, 5, { x: ROUTING_PANIC_RANGE + 1, y: 0 });

      const affected = applyRoutingPanic(router, [router, justInRange, justOutOfRange]);
      expect(affected.map(a => a.id)).toContain('near');
      expect(affected.map(a => a.id)).not.toContain('out');
    });
  });

  describe('checkMoraleRecovery', () => {
    it('recovers morale when no enemies are nearby', () => {
      const troop = makeTroop('t1', 50, 5);
      const recovered = checkMoraleRecovery(troop, false);
      expect(recovered).toBe(true);
      expect(troop.morale).toBeGreaterThan(50);
    });

    it('does not recover morale when in combat', () => {
      const troop = makeTroop('t1', 50, 5);
      const recovered = checkMoraleRecovery(troop, true);
      expect(recovered).toBe(false);
      expect(troop.morale).toBe(50);
    });

    it('does not exceed 100 morale', () => {
      const troop = makeTroop('t1', 99, 5);
      checkMoraleRecovery(troop, false);
      expect(troop.morale).toBeLessThanOrEqual(100);
    });

    it('recovers at MORALE_RECOVERY_RATE per tick', () => {
      const troop = makeTroop('t1', 50, 5);
      checkMoraleRecovery(troop, false);
      expect(troop.morale).toBeCloseTo(50 + MORALE_RECOVERY_RATE);
    });
  });
});
