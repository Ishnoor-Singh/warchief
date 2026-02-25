// Simulation tick: scheduled internal mutation that drives the battle loop

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { simulationTick, getDetailedBattleSummary, SimulationState } from "./gameLogic/simulation";
import type { Lieutenant } from "./gameLogic/lieutenant";
import type { AICommander } from "./gameLogic/aiCommander";

const AI_COMMANDER_INTERVAL = 50;

export const simulationTick_fn = internalMutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game || !game.battleState) return;

    const battleState = game.battleState as SimulationState['battle'];
    if (!battleState.running) return;

    // Reconstruct simulation state from stored data
    const simState: SimulationState = {
      battle: battleState,
      runtimes: game.runtimes || {},
      squadCasualties: game.squadCasualties || {},
      activeEngagements: game.activeEngagements || [],
    };

    // Process one tick
    const { state, battleEvents, troopMessages } = simulationTick(simState);

    // Write battle events to DB
    for (const evt of battleEvents) {
      await ctx.db.insert("battleEvents", {
        gameId,
        eventType: evt.type,
        tick: evt.tick,
        team: evt.team,
        message: evt.message,
        position: evt.position,
      });
    }

    // Write troop messages to DB
    for (const msg of troopMessages) {
      const agent = state.battle.agents[msg.agentId];
      if (agent && agent.team === 'player') {
        const lieutenants = game.lieutenants as Lieutenant[] | undefined;
        const lt = lieutenants?.find(l => l.troopIds.includes(msg.agentId));

        await ctx.db.insert("messages", {
          gameId,
          messageId: `msg_${Date.now()}_${msg.agentId}`,
          from: lt?.id || msg.agentId,
          to: 'commander',
          content: `[${msg.agentId}] ${msg.message}`,
          timestamp: Date.now(),
          tick: state.battle.tick,
          messageType: msg.messageType === 'alert' ? 'alert' : 'report',
        });
      }
    }

    // Update game state
    const updates: Record<string, unknown> = {
      battleState: state.battle,
      runtimes: state.runtimes,
      squadCasualties: state.squadCasualties,
      activeEngagements: state.activeEngagements,
    };

    // Check for battle end
    if (state.battle.winner) {
      updates.phase = 'post-battle';

      const summary = getDetailedBattleSummary(state);
      await ctx.db.insert("messages", {
        gameId,
        messageId: `msg_${Date.now()}_battle_end`,
        from: 'system',
        to: 'commander',
        content: `Battle ended. Winner: ${state.battle.winner}. Duration: ${summary.durationSeconds}s.`,
        timestamp: Date.now(),
        tick: state.battle.tick,
        messageType: 'alert',
      });

      // Don't schedule next tick
      updates.tickScheduleId = undefined;
      await ctx.db.patch(gameId, updates);
      return;
    }

    await ctx.db.patch(gameId, updates);

    // Schedule AI Commander cycles (non-blocking via actions)
    const tick = state.battle.tick;
    if (tick > 0 && tick % AI_COMMANDER_INTERVAL === 0) {
      const aiCommander = game.aiCommander as AICommander | undefined;
      if (aiCommander && !aiCommander.busy && game.apiKey) {
        await ctx.scheduler.runAfter(0, internal.llm.runAICommanderCycle, {
          gameId,
          commanderTeam: 'enemy',
        });
      }

      const playerAICommander = game.playerAICommander as AICommander | undefined;
      if (playerAICommander && !playerAICommander.busy && game.apiKey) {
        await ctx.scheduler.runAfter(0, internal.llm.runAICommanderCycle, {
          gameId,
          commanderTeam: 'player',
        });
      }
    }

    // Schedule next tick
    const interval = Math.round(100 / game.speed);
    const tickId = await ctx.scheduler.runAfter(interval, internal.tick.simulationTick, { gameId });
    await ctx.db.patch(gameId, { tickScheduleId: tickId });
  },
});

// Re-export with the name that internal.tick.simulationTick expects
export { simulationTick_fn as simulationTick };
