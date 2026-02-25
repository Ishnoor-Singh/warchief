// Game management: mutations and queries for game state

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { createBasicScenario, createAssaultScenario } from "./gameLogic/scenario";
import { createSimulationState, getFilteredStateForTeam, getFullStateForObserver, getDetailedBattleSummary, distance } from "./gameLogic/simulation";
import { createPersonalityFlowchart, Flowchart, FlowchartNode } from "./gameLogic/flowchart";
import { createLieutenant, Lieutenant } from "./gameLogic/lieutenant";
import { createAICommander } from "./gameLogic/aiCommander";
import { compileDirectives, applyFlowcharts } from "./gameLogic/compiler";
import type { TroopStats } from "./gameLogic/types";

const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', default: true },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (faster)' },
];

const AI_COMMANDER_INTERVAL = 50;

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getGame = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return null;

    // Don't expose apiKey to client
    const { apiKey, ...safeGame } = game;

    // Compute filtered battle state for client
    let clientBattleState = null;
    let activeNodes: Record<string, string | null> = {};

    if (game.battleState && game.runtimes) {
      const simState = {
        battle: game.battleState,
        runtimes: game.runtimes,
        squadCasualties: game.squadCasualties || {},
        activeEngagements: game.activeEngagements || [],
      };

      if (game.mode === 'ai_vs_ai') {
        clientBattleState = getFullStateForObserver(simState);
      } else {
        clientBattleState = getFilteredStateForTeam(simState, 'player');
      }

      // Include active flowchart nodes for highlighting
      for (const [agentId, runtime] of Object.entries(game.runtimes as Record<string, { currentNodeId: string | null }>)) {
        activeNodes[agentId] = runtime.currentNodeId;
      }
    }

    return {
      ...safeGame,
      clientBattleState,
      activeNodes,
      models: AVAILABLE_MODELS,
      hasApiKey: !!game.apiKey,
    };
  },
});

export const getLieutenants = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game || !game.lieutenants) return [];

    return (game.lieutenants as Lieutenant[]).map(lt => ({
      id: lt.id,
      name: lt.name,
      personality: lt.personality,
      troopIds: lt.troopIds,
      busy: lt.busy,
      stats: lt.stats,
    }));
  },
});

export const getFlowcharts = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game || !game.lieutenants || !game.runtimes) return {};

    const result: Record<string, Flowchart> = {};
    const lieutenants = game.lieutenants as Lieutenant[];
    const runtimes = game.runtimes as Record<string, { flowchart: Flowchart }>;

    for (const lt of lieutenants) {
      result[lt.id] = buildLieutenantFlowchart(lt.id, lt.troopIds, runtimes);
    }

    return result;
  },
});

export const getMessages = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
  },
});

export const getBattleEvents = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    return await ctx.db
      .query("battleEvents")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const createGame = mutation({
  args: {},
  handler: async (ctx) => {
    const gameId = await ctx.db.insert("games", {
      phase: "setup",
      mode: "human_vs_ai",
      model: AVAILABLE_MODELS.find(m => m.default)?.id || AVAILABLE_MODELS[0]!.id,
      speed: 1,
      mapWidth: 400,
      mapHeight: 300,
    });
    return gameId;
  },
});

export const setModel = mutation({
  args: { gameId: v.id("games"), model: v.string() },
  handler: async (ctx, { gameId, model }) => {
    if (AVAILABLE_MODELS.find(m => m.id === model)) {
      await ctx.db.patch(gameId, { model });
    }
  },
});

export const setGameMode = mutation({
  args: { gameId: v.id("games"), mode: v.string() },
  handler: async (ctx, { gameId, mode }) => {
    if (mode === 'human_vs_ai' || mode === 'ai_vs_ai') {
      await ctx.db.patch(gameId, { mode });
    }
  },
});

export const setSpeed = mutation({
  args: { gameId: v.id("games"), speed: v.number() },
  handler: async (ctx, { gameId, speed }) => {
    if ([0.5, 1, 2].includes(speed)) {
      await ctx.db.patch(gameId, { speed });
    }
  },
});

export const initScenario = mutation({
  args: {
    gameId: v.id("games"),
    scenario: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, scenario }) => {
    const game = await ctx.db.get(gameId);
    if (!game) throw new Error("Game not found");

    const scenarioData = (scenario || 'basic') === 'assault'
      ? createAssaultScenario()
      : createBasicScenario();

    const simState = createSimulationState(
      scenarioData.width,
      scenarioData.height,
      scenarioData.agents,
      scenarioData.flowcharts
    );

    // Create player lieutenants
    const agentIds = Object.keys(simState.battle.agents);
    const lieutenants: Lieutenant[] = [
      createLieutenant({
        id: 'lt_alpha',
        name: 'Lt. Adaeze',
        personality: 'aggressive',
        stats: { initiative: 8, discipline: 5, communication: 7 },
        troopIds: agentIds.filter(id => id.startsWith('p_s1')),
        authorizedPeers: ['lt_bravo'],
      }),
      createLieutenant({
        id: 'lt_bravo',
        name: 'Lt. Chen',
        personality: 'cautious',
        stats: { initiative: 5, discipline: 8, communication: 6 },
        troopIds: agentIds.filter(id => id.startsWith('p_s2')),
        authorizedPeers: ['lt_alpha', 'lt_charlie'],
      }),
      createLieutenant({
        id: 'lt_charlie',
        name: 'Lt. Morrison',
        personality: 'disciplined',
        stats: { initiative: 6, discipline: 9, communication: 5 },
        troopIds: agentIds.filter(id => id.startsWith('p_s3')),
        authorizedPeers: ['lt_bravo'],
      }),
    ];

    // Create enemy lieutenants
    const enemyLieutenants: Lieutenant[] = [
      createLieutenant({
        id: 'lt_enemy_1',
        name: 'Lt. Volkov',
        personality: 'aggressive',
        stats: { initiative: 7, discipline: 6, communication: 5 },
        troopIds: agentIds.filter(id => id.startsWith('e_s1') || id.startsWith('e_s2')),
        authorizedPeers: ['lt_enemy_2'],
      }),
      createLieutenant({
        id: 'lt_enemy_2',
        name: 'Lt. Kira',
        personality: 'cautious',
        stats: { initiative: 5, discipline: 8, communication: 7 },
        troopIds: agentIds.filter(id => id.startsWith('e_s3')),
        authorizedPeers: ['lt_enemy_1'],
      }),
    ];

    // Apply personality-based default flowcharts for player troops
    const enemyCenter = { x: scenarioData.width - 50, y: scenarioData.height / 2 };
    for (const lt of lieutenants) {
      for (const troopId of lt.troopIds) {
        const runtime = simState.runtimes[troopId];
        if (runtime) {
          runtime.flowchart = createPersonalityFlowchart(troopId, lt.personality, enemyCenter);
        }
      }
    }

    // Build troop info for client
    const troopInfo: Record<string, Array<{
      id: string; squadId: string; position: { x: number; y: number };
      stats: { combat: number; speed: number; courage: number; discipline: number };
    }>> = {};

    for (const lt of lieutenants) {
      troopInfo[lt.id] = lt.troopIds.map(tid => {
        const agent = simState.battle.agents[tid]!;
        return {
          id: agent.id,
          squadId: agent.squadId || '',
          position: { x: agent.position.x, y: agent.position.y },
          stats: agent.stats as TroopStats,
        };
      });
    }

    await ctx.db.patch(gameId, {
      phase: 'pre-battle',
      battleState: simState.battle,
      runtimes: simState.runtimes,
      squadCasualties: simState.squadCasualties,
      activeEngagements: simState.activeEngagements,
      lieutenants,
      enemyLieutenants,
      mapWidth: scenarioData.width,
      mapHeight: scenarioData.height,
    });

    return {
      troopInfo,
      mapSize: { width: scenarioData.width, height: scenarioData.height },
    };
  },
});

export const initBattle = mutation({
  args: {
    gameId: v.id("games"),
    playerPersonality: v.optional(v.string()),
    enemyPersonality: v.optional(v.string()),
    gameMode: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, playerPersonality, enemyPersonality, gameMode }) => {
    const game = await ctx.db.get(gameId);
    if (!game) throw new Error("Game not found");

    const updates: Record<string, unknown> = {};

    if (gameMode) {
      updates.mode = gameMode;
    }

    if (playerPersonality) updates.playerPersonality = playerPersonality;
    if (enemyPersonality) updates.enemyPersonality = enemyPersonality;

    const mode = (gameMode || game.mode) as string;
    const enemyLieutenants = game.enemyLieutenants as Lieutenant[];

    // Create AI commander for enemy
    const aiCommander = createAICommander({
      personality: (enemyPersonality || 'balanced') as 'aggressive' | 'cautious' | 'balanced',
      lieutenantIds: enemyLieutenants.map(lt => lt.id),
      model: game.model,
      team: 'enemy',
      name: 'Enemy Commander',
    });
    updates.aiCommander = aiCommander;

    if (mode === 'ai_vs_ai') {
      const lieutenants = game.lieutenants as Lieutenant[];
      const playerAICommander = createAICommander({
        personality: (playerPersonality || 'balanced') as 'aggressive' | 'cautious' | 'balanced',
        lieutenantIds: lieutenants.map(lt => lt.id),
        model: game.model,
        team: 'player',
        name: 'Player Commander',
      });
      updates.playerAICommander = playerAICommander;
    }

    await ctx.db.patch(gameId, updates);

    // Schedule LLM briefings (enemy always, player in ai_vs_ai mode)
    if (game.apiKey) {
      await ctx.scheduler.runAfter(0, internal.llm.briefEnemyLieutenants, { gameId });

      if (mode === 'ai_vs_ai') {
        await ctx.scheduler.runAfter(0, internal.llm.briefPlayerAILieutenants, { gameId });
      }
    }

    return { gameMode: mode };
  },
});

export const startBattle = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game || !game.battleState) throw new Error("No battle initialized");

    const battleState = game.battleState as { running: boolean; [key: string]: unknown };
    battleState.running = true;

    await ctx.db.patch(gameId, {
      phase: 'battle',
      battleState,
    });

    // Schedule first simulation tick
    const interval = Math.round(100 / game.speed);
    const tickId = await ctx.scheduler.runAfter(interval, internal.tick.simulationTick, { gameId });
    await ctx.db.patch(gameId, { tickScheduleId: tickId });
  },
});

export const pauseBattle = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game || !game.battleState) return;

    const battleState = game.battleState as { running: boolean; [key: string]: unknown };
    battleState.running = false;

    // Cancel scheduled tick
    if (game.tickScheduleId) {
      await ctx.scheduler.cancel(game.tickScheduleId);
    }

    await ctx.db.patch(gameId, {
      battleState,
      tickScheduleId: undefined,
    });
  },
});

export const resumeBattle = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game || !game.battleState) return;

    const battleState = game.battleState as { running: boolean; [key: string]: unknown };
    battleState.running = true;

    await ctx.db.patch(gameId, { battleState });

    // Schedule next tick
    const interval = Math.round(100 / game.speed);
    const tickId = await ctx.scheduler.runAfter(interval, internal.tick.simulationTick, { gameId });
    await ctx.db.patch(gameId, { tickScheduleId: tickId });
  },
});

// Internal mutation used by LLM actions to apply lieutenant results
export const applyLieutenantResult = internalMutation({
  args: {
    gameId: v.id("games"),
    lieutenantId: v.string(),
    team: v.string(),
    output: v.any(),
    order: v.optional(v.string()),
  },
  handler: async (ctx, { gameId, lieutenantId, team, output, order }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return;

    const isPlayer = team === 'player';
    const lieutenants = (isPlayer ? game.lieutenants : game.enemyLieutenants) as Lieutenant[];
    const lt = lieutenants.find(l => l.id === lieutenantId);
    if (!lt) return;

    const runtimes = game.runtimes as Record<string, { flowchart: Flowchart; [key: string]: unknown }>;

    // Compile and apply flowcharts
    const compiled = compileDirectives(output, lt.troopIds);
    applyFlowcharts(compiled, runtimes);

    // Update lieutenant state
    lt.busy = false;
    lt.lastOutput = output;
    if (order) {
      lt.messageHistory.push({
        from: 'commander',
        content: order,
        timestamp: Date.now(),
      });
      if (lt.messageHistory.length > 10) {
        lt.messageHistory = lt.messageHistory.slice(-10);
      }
    }

    const updates: Record<string, unknown> = { runtimes };
    if (isPlayer) {
      updates.lieutenants = lieutenants;
    } else {
      updates.enemyLieutenants = lieutenants;
    }

    await ctx.db.patch(gameId, updates);

    // Add response message
    if (output.message_up) {
      await ctx.db.insert("messages", {
        gameId,
        messageId: `msg_${Date.now()}_${lieutenantId}`,
        from: lieutenantId,
        to: 'commander',
        content: output.message_up,
        timestamp: Date.now(),
        tick: (game.battleState as { tick: number })?.tick || 0,
        messageType: 'report',
      });
    }
  },
});

export const markLieutenantBusy = internalMutation({
  args: {
    gameId: v.id("games"),
    lieutenantId: v.string(),
    team: v.string(),
    busy: v.boolean(),
  },
  handler: async (ctx, { gameId, lieutenantId, team, busy }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return;

    const isPlayer = team === 'player';
    const lieutenants = (isPlayer ? game.lieutenants : game.enemyLieutenants) as Lieutenant[];
    const lt = lieutenants.find(l => l.id === lieutenantId);
    if (!lt) return;

    lt.busy = busy;

    if (isPlayer) {
      await ctx.db.patch(gameId, { lieutenants });
    } else {
      await ctx.db.patch(gameId, { enemyLieutenants: lieutenants });
    }
  },
});

export const addMessage = internalMutation({
  args: {
    gameId: v.id("games"),
    messageId: v.string(),
    from: v.string(),
    to: v.string(),
    content: v.string(),
    timestamp: v.number(),
    tick: v.number(),
    messageType: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
  },
});

export const setPhase = internalMutation({
  args: { gameId: v.id("games"), phase: v.string() },
  handler: async (ctx, { gameId, phase }) => {
    await ctx.db.patch(gameId, { phase });
  },
});

// Internal query for full game data (used by actions that need the API key)
export const getGameInternal = internalQuery({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    return await ctx.db.get(gameId);
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildLieutenantFlowchart(
  lieutenantId: string,
  troopIds: string[],
  runtimes: Record<string, { flowchart: Flowchart }>
): Flowchart {
  const seenNodeIds = new Set<string>();
  const nodes: FlowchartNode[] = [];

  for (const troopId of troopIds) {
    const runtime = runtimes[troopId];
    if (!runtime) continue;
    for (const node of runtime.flowchart.nodes) {
      if (!seenNodeIds.has(node.id)) {
        seenNodeIds.add(node.id);
        nodes.push(node);
      }
    }
  }

  return {
    agentId: lieutenantId,
    nodes,
    defaultAction: { type: 'hold' },
  };
}
