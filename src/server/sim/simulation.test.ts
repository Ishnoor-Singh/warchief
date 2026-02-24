// RED: Tests for simulation enhancements
// - Visibility-filtered state for client
// - Enhanced battle summary with per-team stats
// - Current node tracking for flowchart highlighting
// - Morale/courage checks

import { describe, it, expect } from 'vitest';
import {
  createSimulation,
  simulationTick,
  getBattleSummary,
  getFilteredStateForTeam,
  getDetailedBattleSummary,
  distance,
} from './simulation.js';
import { createBasicScenario, createAssaultScenario } from './scenario.js';
import { AgentState, Vec2 } from '../../shared/types/index.js';

describe('Simulation Enhancements', () => {
  describe('getFilteredStateForTeam', () => {
    it('returns all friendly agents regardless of distance', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const filtered = getFilteredStateForTeam(sim, 'player');

      // Should include all player agents
      const playerAgents = filtered.agents.filter(a => a.team === 'player');
      const totalPlayerAgents = scenario.agents.filter(a => a.team === 'player').length;
      expect(playerAgents.length).toBe(totalPlayerAgents);
    });

    it('only includes enemy agents within visibility radius of any friendly agent', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const filtered = getFilteredStateForTeam(sim, 'player');

      // In basic scenario, armies start far apart (x=50 vs x=350)
      // Visibility radius is 80, so no enemies should be visible initially
      const visibleEnemies = filtered.agents.filter(a => a.team === 'enemy');
      expect(visibleEnemies.length).toBe(0);
    });

    it('includes enemy agents when they are within visibility range', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      // Move a player agent close to enemy
      const playerAgent = Array.from(sim.battle.agents.values()).find(a => a.team === 'player')!;
      playerAgent.position = { x: 340, y: 100 }; // Close to enemy at x=350

      const filtered = getFilteredStateForTeam(sim, 'player');

      const visibleEnemies = filtered.agents.filter(a => a.team === 'enemy');
      expect(visibleEnemies.length).toBeGreaterThan(0);
    });

    it('includes visibility zones for fog of war rendering', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const filtered = getFilteredStateForTeam(sim, 'player');

      expect(filtered.visibilityZones).toBeDefined();
      expect(filtered.visibilityZones.length).toBeGreaterThan(0);
      // Each zone should have position and radius
      for (const zone of filtered.visibilityZones) {
        expect(zone.position).toBeDefined();
        expect(zone.radius).toBeGreaterThan(0);
      }
    });
  });

  describe('getDetailedBattleSummary', () => {
    it('returns casualty counts per team', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const summary = getDetailedBattleSummary(sim);

      expect(summary.player.alive).toBeGreaterThan(0);
      expect(summary.player.dead).toBe(0);
      expect(summary.enemy.alive).toBeGreaterThan(0);
      expect(summary.enemy.dead).toBe(0);
      expect(summary.tick).toBe(0);
    });

    it('tracks casualties after combat', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      // Kill a player agent manually
      const playerAgent = Array.from(sim.battle.agents.values()).find(a => a.team === 'player')!;
      playerAgent.alive = false;
      playerAgent.health = 0;

      const summary = getDetailedBattleSummary(sim);

      expect(summary.player.dead).toBe(1);
      expect(summary.player.alive).toBe(summary.player.total - 1);
    });

    it('includes winner when battle is over', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
      sim.battle.winner = 'player';

      const summary = getDetailedBattleSummary(sim);

      expect(summary.winner).toBe('player');
    });

    it('includes battle duration in ticks', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
      sim.battle.tick = 150;

      const summary = getDetailedBattleSummary(sim);

      expect(summary.tick).toBe(150);
      expect(summary.durationSeconds).toBeCloseTo(15, 0);
    });
  });

  describe('currentNodeId tracking', () => {
    it('flowchart runtime tracks current node after processing event', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      // Run a few ticks to trigger events
      sim.battle.running = true;
      for (let i = 0; i < 5; i++) {
        simulationTick(sim);
      }

      // Check that at least some runtimes have a currentNodeId set
      let hasCurrentNode = false;
      for (const runtime of sim.runtimes.values()) {
        if (runtime.currentNodeId !== null) {
          hasCurrentNode = true;
          break;
        }
      }

      expect(hasCurrentNode).toBe(true);
    });
  });

  describe('distance utility', () => {
    it('calculates correct distance', () => {
      const a: Vec2 = { x: 0, y: 0 };
      const b: Vec2 = { x: 3, y: 4 };
      expect(distance(a, b)).toBeCloseTo(5);
    });

    it('returns 0 for same point', () => {
      const a: Vec2 = { x: 10, y: 20 };
      expect(distance(a, a)).toBe(0);
    });
  });
});
