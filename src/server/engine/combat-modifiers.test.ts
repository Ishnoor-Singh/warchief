import { describe, it, expect } from 'vitest';
import {
  getFormationModifiers,
  calculateFlankingMultiplier,
  calculateChargeBonusDamage,
  type FlankDirection,
} from './combat-modifiers.js';
import { createTroop } from './unit-types.js';
import type { AgentState, FormationType, Vec2 } from '../../shared/types/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTroop(id: string, x: number, y: number, opts?: {
  team?: 'player' | 'enemy';
  formation?: FormationType;
  combat?: number;
}): AgentState {
  const troop = createTroop({
    id,
    team: opts?.team ?? 'player',
    position: { x, y },
    lieutenantId: 'lt_1',
    squadId: 'squad_1',
    formation: opts?.formation ?? 'line',
    stats: { combat: opts?.combat ?? 5 },
  });
  return troop;
}

// ─── Formation Modifiers ─────────────────────────────────────────────────────

describe('Formation Combat Modifiers', () => {
  describe('getFormationModifiers', () => {
    it('returns balanced modifiers for line formation', () => {
      const mods = getFormationModifiers('line');
      expect(mods.attackMultiplier).toBeCloseTo(1.0);
      expect(mods.defenseMultiplier).toBeCloseTo(1.0);
    });

    it('returns offensive modifiers for wedge formation', () => {
      const mods = getFormationModifiers('wedge');
      expect(mods.attackMultiplier).toBeGreaterThan(1.0);  // strong attack
      expect(mods.defenseMultiplier).toBeLessThan(1.0);    // weak defense
    });

    it('returns defensive modifiers for defensive_circle', () => {
      const mods = getFormationModifiers('defensive_circle');
      expect(mods.attackMultiplier).toBeLessThan(1.0);     // weak attack
      expect(mods.defenseMultiplier).toBeGreaterThan(1.0); // strong defense
    });

    it('returns evasive modifiers for scatter formation', () => {
      const mods = getFormationModifiers('scatter');
      expect(mods.defenseMultiplier).toBeGreaterThan(1.0); // harder to hit
    });

    it('returns flanking modifiers for pincer formation', () => {
      const mods = getFormationModifiers('pincer');
      expect(mods.attackMultiplier).toBeGreaterThan(1.0); // flanking bonus
    });

    it('returns poor combat modifiers for column formation', () => {
      const mods = getFormationModifiers('column');
      expect(mods.attackMultiplier).toBeLessThan(1.0);  // bad at fighting
      expect(mods.defenseMultiplier).toBeLessThan(1.0); // bad at defending
    });

    it('returns all six formations without error', () => {
      const formations: FormationType[] = ['line', 'wedge', 'scatter', 'pincer', 'defensive_circle', 'column'];
      for (const f of formations) {
        const mods = getFormationModifiers(f);
        expect(mods.attackMultiplier).toBeGreaterThan(0);
        expect(mods.defenseMultiplier).toBeGreaterThan(0);
      }
    });
  });
});

// ─── Flanking Detection ──────────────────────────────────────────────────────

describe('Flanking Detection', () => {
  describe('calculateFlankingMultiplier', () => {
    it('returns 1.0 for a frontal attack (attacker in front of defender)', () => {
      // Defender at origin facing east (positive x), attacker ahead at (50, 0)
      const defenderPos: Vec2 = { x: 0, y: 0 };
      const defenderFacing: Vec2 = { x: 1, y: 0 };
      const attackerPos: Vec2 = { x: 50, y: 0 };

      const result = calculateFlankingMultiplier(attackerPos, defenderPos, defenderFacing);
      expect(result.multiplier).toBeCloseTo(1.0);
      expect(result.direction).toBe('front');
    });

    it('returns a side bonus for a flank attack from the side', () => {
      // Defender facing east, attacker directly to the south (right flank)
      const defenderPos: Vec2 = { x: 0, y: 0 };
      const defenderFacing: Vec2 = { x: 1, y: 0 };
      const attackerPos: Vec2 = { x: 0, y: 50 };

      const result = calculateFlankingMultiplier(attackerPos, defenderPos, defenderFacing);
      expect(result.multiplier).toBeGreaterThan(1.0);
      expect(result.multiplier).toBeLessThan(1.8);
      expect(result.direction).toBe('side');
    });

    it('returns a large bonus for a rear attack', () => {
      // Defender facing east, attacker behind at (-50, 0)
      const defenderPos: Vec2 = { x: 0, y: 0 };
      const defenderFacing: Vec2 = { x: 1, y: 0 };
      const attackerPos: Vec2 = { x: -50, y: 0 };

      const result = calculateFlankingMultiplier(attackerPos, defenderPos, defenderFacing);
      expect(result.multiplier).toBeGreaterThan(1.3);
      expect(result.direction).toBe('rear');
    });

    it('returns front for attacks within 60 degrees of facing', () => {
      // Defender facing east, attacker slightly off-center
      const defenderPos: Vec2 = { x: 0, y: 0 };
      const defenderFacing: Vec2 = { x: 1, y: 0 };
      const attackerPos: Vec2 = { x: 50, y: 20 }; // ~22 degrees off center

      const result = calculateFlankingMultiplier(attackerPos, defenderPos, defenderFacing);
      expect(result.direction).toBe('front');
      expect(result.multiplier).toBeCloseTo(1.0);
    });

    it('correctly identifies left vs right side attacks', () => {
      const defenderPos: Vec2 = { x: 0, y: 0 };
      const defenderFacing: Vec2 = { x: 1, y: 0 };

      // Left flank (negative y in east-facing orientation)
      const leftResult = calculateFlankingMultiplier({ x: 0, y: -50 }, defenderPos, defenderFacing);
      expect(leftResult.direction).toBe('side');

      // Right flank (positive y)
      const rightResult = calculateFlankingMultiplier({ x: 0, y: 50 }, defenderPos, defenderFacing);
      expect(rightResult.direction).toBe('side');
    });

    it('handles west-facing units correctly', () => {
      // Defender facing west, attacker behind (east of defender)
      const defenderPos: Vec2 = { x: 100, y: 100 };
      const defenderFacing: Vec2 = { x: -1, y: 0 };
      const attackerPos: Vec2 = { x: 150, y: 100 };

      const result = calculateFlankingMultiplier(attackerPos, defenderPos, defenderFacing);
      expect(result.direction).toBe('rear');
      expect(result.multiplier).toBeGreaterThan(1.3);
    });
  });
});

// ─── Charge Momentum ─────────────────────────────────────────────────────────

describe('Charge Momentum', () => {
  describe('calculateChargeBonusDamage', () => {
    it('returns bonus damage when unit was moving toward enemy', () => {
      const bonus = calculateChargeBonusDamage(10, true, 3.0);
      expect(bonus).toBeGreaterThan(0);
    });

    it('returns 0 when unit was not moving', () => {
      const bonus = calculateChargeBonusDamage(10, false, 0);
      expect(bonus).toBe(0);
    });

    it('returns 0 when speed is 0', () => {
      const bonus = calculateChargeBonusDamage(10, true, 0);
      expect(bonus).toBe(0);
    });

    it('scales with base damage', () => {
      const lowDmg = calculateChargeBonusDamage(5, true, 3.0);
      const highDmg = calculateChargeBonusDamage(20, true, 3.0);
      expect(highDmg).toBeGreaterThan(lowDmg);
    });

    it('scales with speed', () => {
      const slowCharge = calculateChargeBonusDamage(10, true, 1.0);
      const fastCharge = calculateChargeBonusDamage(10, true, 4.0);
      expect(fastCharge).toBeGreaterThan(slowCharge);
    });

    it('bonus is at most 100% of base damage', () => {
      const bonus = calculateChargeBonusDamage(10, true, 100.0);
      expect(bonus).toBeLessThanOrEqual(10); // capped at base damage
    });
  });
});
