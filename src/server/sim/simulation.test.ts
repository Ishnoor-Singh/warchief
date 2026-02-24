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

      // Run enough ticks to cross the visibility event interval (fires every 10 ticks)
      sim.battle.running = true;
      for (let i = 0; i < 11; i++) {
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

  describe('ally_down events', () => {
    it('reduces morale of nearby allies when a troop dies in combat', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      // Get two player agents and place them close together
      const playerAgents = Array.from(sim.battle.agents.values()).filter(a => a.team === 'player');
      const victim = playerAgents[0]!;
      const nearby = playerAgents[1]!;
      nearby.position = { x: victim.position.x + 10, y: victim.position.y };

      // Put an enemy right on top of the victim to trigger combat
      const enemy = Array.from(sim.battle.agents.values()).find(a => a.team === 'enemy')!;
      enemy.position = { ...victim.position };
      victim.health = 1; // will die on next combat tick

      sim.battle.running = true;
      simulationTick(sim);

      // Nearby ally's morale should have dropped
      expect(nearby.morale).toBeLessThan(100);
    });
  });

  describe('squad casualty tracking', () => {
    it('initializes squad casualty tracking from scenario agents', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      // Basic scenario has player squad_1 with 10 troops
      const key = 'player:squad_1';
      const squadInfo = sim.squadCasualties.get(key);
      expect(squadInfo).toBeDefined();
      expect(squadInfo!.total).toBe(10);
      expect(squadInfo!.dead).toBe(0);
    });
  });

  describe('troop message callbacks', () => {
    it('calls onTroopMessage callback when requestSupport action is executed', () => {
      const messages: Array<{ agentId: string; type: string; message: string }> = [];
      const scenario = createBasicScenario();
      const sim = createSimulation(
        scenario.width, scenario.height, scenario.agents, scenario.flowcharts,
        {
          onTroopMessage: (agentId, type, message) => {
            messages.push({ agentId, type, message });
          },
        }
      );

      // Override one agent's flowchart to include requestSupport
      const agentId = Array.from(sim.battle.agents.keys()).find(id => id.startsWith('p_s1'))!;
      const runtime = sim.runtimes.get(agentId)!;
      runtime.flowchart = {
        agentId,
        nodes: [{
          id: 'request_help',
          on: 'under_attack',
          action: { type: 'requestSupport', message: 'Taking heavy fire!' },
          priority: 10,
        }],
        defaultAction: { type: 'hold' },
      };

      // Place an enemy right next to this agent to trigger combat → under_attack
      const enemy = Array.from(sim.battle.agents.values()).find(a => a.team === 'enemy')!;
      const agent = sim.battle.agents.get(agentId)!;
      enemy.position = { ...agent.position };

      sim.battle.running = true;
      // Tick once for combat to happen → under_attack queued
      simulationTick(sim);
      // Tick again at the visibility interval to process the queued under_attack
      for (let i = 0; i < 10; i++) simulationTick(sim);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some(m => m.type === 'requestSupport' && m.message === 'Taking heavy fire!')).toBe(true);
    });
  });

  describe('visibility throttling', () => {
    it('does not fire enemy_spotted on ticks that are not at the interval', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      // Place agents close so they can see each other
      const playerAgent = Array.from(sim.battle.agents.values()).find(a => a.team === 'player')!;
      const enemyAgent = Array.from(sim.battle.agents.values()).find(a => a.team === 'enemy')!;
      playerAgent.position = { x: 300, y: 150 };
      enemyAgent.position = { x: 310, y: 150 };

      const runtime = sim.runtimes.get(playerAgent.id)!;

      sim.battle.running = true;
      // Tick once (tick 1) — not at interval, no visibility events
      simulationTick(sim);

      // currentNodeId should still be null — only tick events fire, no matching nodes
      expect(runtime.currentNodeId).toBeNull();
    });

    it('fires enemy_spotted at the visibility interval tick', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const playerAgent = Array.from(sim.battle.agents.values()).find(a => a.team === 'player')!;
      const enemyAgent = Array.from(sim.battle.agents.values()).find(a => a.team === 'enemy')!;
      playerAgent.position = { x: 300, y: 150 };
      enemyAgent.position = { x: 310, y: 150 };

      const runtime = sim.runtimes.get(playerAgent.id)!;

      sim.battle.running = true;
      // Tick to interval (10 ticks)
      for (let i = 0; i < 10; i++) simulationTick(sim);

      // Now a node should have been triggered from enemy_spotted
      expect(runtime.currentNodeId).not.toBeNull();
    });
  });

  describe('filtered state excludes dead friendlies', () => {
    it('does not include dead friendly agents in filtered state', () => {
      const scenario = createBasicScenario();
      const sim = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);

      const playerAgent = Array.from(sim.battle.agents.values()).find(a => a.team === 'player')!;
      playerAgent.alive = false;
      playerAgent.health = 0;

      const filtered = getFilteredStateForTeam(sim, 'player');
      const deadInFiltered = filtered.agents.filter(a => !a.alive);
      expect(deadInFiltered.length).toBe(0);
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
