import { describe, it, expect } from 'vitest';
import {
  getSpeed,
  computeMovementTick,
  updateAllMovement,
  repositionInFormation,
  getVisibleEnemies,
  DEFAULT_SPEED,
} from './movement.js';
import { createTroop, createLieutenant } from './unit-types.js';
import type { AgentState } from '../../shared/types/index.js';

describe('Movement Module', () => {
  describe('getSpeed', () => {
    it('returns troop speed from stats', () => {
      const troop = createTroop({
        id: 't', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq', stats: { speed: 4 },
      });
      expect(getSpeed(troop)).toBe(4);
    });

    it('returns default speed for lieutenants', () => {
      const lt = createLieutenant({
        id: 'lt', team: 'player', position: { x: 0, y: 0 }, name: 'Test',
      });
      expect(getSpeed(lt)).toBe(DEFAULT_SPEED);
    });
  });

  describe('computeMovementTick', () => {
    it('moves agent toward target at constant speed', () => {
      const agent = createTroop({
        id: 't', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq', stats: { speed: 5 },
      });

      const result = computeMovementTick(agent, { x: 100, y: 0 });

      expect(result.arrived).toBe(false);
      expect(result.position.x).toBeCloseTo(5);
      expect(result.position.y).toBeCloseTo(0);
    });

    it('arrives when within one tick distance', () => {
      const agent = createTroop({
        id: 't', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq', stats: { speed: 5 },
      });

      const result = computeMovementTick(agent, { x: 3, y: 0 });

      expect(result.arrived).toBe(true);
      expect(result.position.x).toBeCloseTo(3);
      expect(result.position.y).toBeCloseTo(0);
    });

    it('does not snap to target when chasing', () => {
      const agent = createTroop({
        id: 't', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq', stats: { speed: 5 },
      });

      const result = computeMovementTick(agent, { x: 3, y: 0 }, true);

      expect(result.arrived).toBe(false);
      expect(result.position).toEqual(agent.position); // stays put when too close
    });

    it('handles diagonal movement correctly', () => {
      const agent = createTroop({
        id: 't', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq', stats: { speed: 5 },
      });

      const result = computeMovementTick(agent, { x: 30, y: 40 });

      expect(result.arrived).toBe(false);
      // Should move 5 units toward (30, 40) - distance is 50
      expect(result.position.x).toBeCloseTo(3); // 30/50 * 5
      expect(result.position.y).toBeCloseTo(4); // 40/50 * 5
    });
  });

  describe('updateAllMovement', () => {
    it('moves agents toward target positions', () => {
      const agents = new Map<string, AgentState>();
      const troop = createTroop({
        id: 't1', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq', stats: { speed: 5 },
      });
      troop.targetPosition = { x: 100, y: 0 };
      troop.currentAction = 'moving';
      agents.set('t1', troop);

      const arrived = updateAllMovement(agents);

      expect(arrived).toHaveLength(0);
      expect(troop.position.x).toBeCloseTo(5);
    });

    it('returns arrived agents when they reach target', () => {
      const agents = new Map<string, AgentState>();
      const troop = createTroop({
        id: 't1', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq', stats: { speed: 5 },
      });
      troop.targetPosition = { x: 3, y: 0 };
      troop.currentAction = 'moving';
      agents.set('t1', troop);

      const arrived = updateAllMovement(agents);

      expect(arrived).toHaveLength(1);
      expect(arrived[0]!.id).toBe('t1');
      expect(troop.targetPosition).toBeNull();
      expect(troop.currentAction).toBe('holding');
    });

    it('pursues target agents', () => {
      const agents = new Map<string, AgentState>();

      const pursuer = createTroop({
        id: 'p', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq', stats: { speed: 5 },
      });
      pursuer.targetId = 'e';
      pursuer.currentAction = 'engaging';

      const target = createTroop({
        id: 'e', team: 'enemy', position: { x: 100, y: 0 },
        lieutenantId: 'lt_e', squadId: 'esq',
      });

      agents.set('p', pursuer);
      agents.set('e', target);

      updateAllMovement(agents);

      // Pursuer should have moved toward target
      expect(pursuer.position.x).toBeCloseTo(5);
    });

    it('clears targetId when target is dead', () => {
      const agents = new Map<string, AgentState>();

      const pursuer = createTroop({
        id: 'p', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq',
      });
      pursuer.targetId = 'e';

      const target = createTroop({
        id: 'e', team: 'enemy', position: { x: 100, y: 0 },
        lieutenantId: 'lt_e', squadId: 'esq',
      });
      target.alive = false;

      agents.set('p', pursuer);
      agents.set('e', target);

      updateAllMovement(agents);

      expect(pursuer.targetId).toBeNull();
    });

    it('skips dead agents', () => {
      const agents = new Map<string, AgentState>();

      const dead = createTroop({
        id: 'd', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq',
      });
      dead.alive = false;
      dead.targetPosition = { x: 100, y: 0 };

      agents.set('d', dead);

      updateAllMovement(agents);

      // Dead agent should not move
      expect(dead.position.x).toBe(0);
    });
  });

  describe('repositionInFormation', () => {
    it('sets target position based on formation slot', () => {
      const agents = new Map<string, AgentState>();

      const lt = createLieutenant({
        id: 'lt', team: 'player', position: { x: 100, y: 100 }, name: 'Test',
      });
      const t1 = createTroop({
        id: 't1', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq',
      });
      const t2 = createTroop({
        id: 't2', team: 'player', position: { x: 10, y: 0 },
        lieutenantId: 'lt', squadId: 'sq',
      });

      agents.set('lt', lt);
      agents.set('t1', t1);
      agents.set('t2', t2);

      repositionInFormation(t1, lt.position, agents);

      expect(t1.targetPosition).not.toBeNull();
      expect(t1.currentAction).toBe('moving');
    });

    it('does nothing for lieutenants', () => {
      const agents = new Map<string, AgentState>();

      const lt = createLieutenant({
        id: 'lt', team: 'player', position: { x: 100, y: 100 }, name: 'Test',
      });
      agents.set('lt', lt);

      repositionInFormation(lt, { x: 100, y: 100 }, agents);

      expect(lt.targetPosition).toBeNull();
    });
  });

  describe('getVisibleEnemies', () => {
    it('returns enemies within visibility radius', () => {
      const player = createTroop({
        id: 'p', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq',
        visibilityRadius: 100,
      });

      const nearEnemy = createTroop({
        id: 'e1', team: 'enemy', position: { x: 50, y: 0 },
        lieutenantId: 'lt_e', squadId: 'esq',
      });

      const farEnemy = createTroop({
        id: 'e2', team: 'enemy', position: { x: 200, y: 0 },
        lieutenantId: 'lt_e', squadId: 'esq',
      });

      const visible = getVisibleEnemies(player, [player, nearEnemy, farEnemy]);

      expect(visible).toHaveLength(1);
      expect(visible[0]!.agent.id).toBe('e1');
      expect(visible[0]!.distance).toBeCloseTo(50);
    });

    it('does not include allies', () => {
      const player1 = createTroop({
        id: 'p1', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq',
        visibilityRadius: 100,
      });

      const player2 = createTroop({
        id: 'p2', team: 'player', position: { x: 10, y: 0 },
        lieutenantId: 'lt', squadId: 'sq',
      });

      const visible = getVisibleEnemies(player1, [player1, player2]);
      expect(visible).toHaveLength(0);
    });

    it('does not include dead enemies', () => {
      const player = createTroop({
        id: 'p', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq',
        visibilityRadius: 100,
      });

      const deadEnemy = createTroop({
        id: 'e', team: 'enemy', position: { x: 10, y: 0 },
        lieutenantId: 'lt_e', squadId: 'esq',
      });
      deadEnemy.alive = false;

      const visible = getVisibleEnemies(player, [player, deadEnemy]);
      expect(visible).toHaveLength(0);
    });

    it('returns enemies sorted by distance (closest first)', () => {
      const player = createTroop({
        id: 'p', team: 'player', position: { x: 0, y: 0 },
        lieutenantId: 'lt', squadId: 'sq',
        visibilityRadius: 100,
      });

      const e1 = createTroop({
        id: 'e1', team: 'enemy', position: { x: 50, y: 0 },
        lieutenantId: 'lt_e', squadId: 'esq',
      });

      const e2 = createTroop({
        id: 'e2', team: 'enemy', position: { x: 20, y: 0 },
        lieutenantId: 'lt_e', squadId: 'esq',
      });

      const visible = getVisibleEnemies(player, [player, e1, e2]);

      expect(visible).toHaveLength(2);
      expect(visible[0]!.agent.id).toBe('e2'); // closer
      expect(visible[1]!.agent.id).toBe('e1'); // farther
    });
  });
});
