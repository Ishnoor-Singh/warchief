// LLM actions: external API calls to Anthropic for lieutenant orders and AI commander

import { v } from "convex/values";
import { action, internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildLieutenantPrompt, type VisibleUnitInfo, type VisibleEnemyInfo } from "./gameLogic/inputBuilder";
import { parseLieutenantOutput } from "./gameLogic/validation";
import { buildCommanderContext, CommanderOutputSchema, type AICommander, type CommanderOrder } from "./gameLogic/aiCommander";
import { distance, type SimulationState } from "./gameLogic/simulation";
import type { Lieutenant } from "./gameLogic/lieutenant";


// ─── Internal Mutation for storing API key ──────────────────────────────────

export const storeApiKey = internalMutation({
  args: { gameId: v.id("games"), apiKey: v.string() },
  handler: async (ctx, { gameId, apiKey }) => {
    await ctx.db.patch(gameId, { apiKey });
  },
});


// ─── Public Actions (called by client) ───────────────────────────────────────

// Validate API key by making a test call to Anthropic
export const validateApiKey = action({
  args: { gameId: v.id("games"), apiKey: v.string() },
  handler: async (ctx, { gameId, apiKey }) => {
    if (!apiKey || !apiKey.startsWith('sk-')) {
      throw new Error('Invalid API key format');
    }

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });
    try {
      await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
    } catch (err) {
      throw new Error('Invalid API key: ' + (err as Error).message);
    }

    await ctx.runMutation(internal.llm.storeApiKey, { gameId, apiKey });
    return { valid: true };
  },
});

// Send a pre-battle briefing to a lieutenant
export const sendBrief = action({
  args: {
    gameId: v.id("games"),
    lieutenantId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, { gameId, lieutenantId, message }) => {
    await ctx.runMutation(internal.games.markLieutenantBusy, {
      gameId, lieutenantId, team: 'player', busy: true,
    });

    await ctx.runMutation(internal.games.addMessage, {
      gameId,
      messageId: `msg_${Date.now()}_cmd`,
      from: 'commander',
      to: lieutenantId,
      content: message,
      timestamp: Date.now(),
      tick: 0,
      messageType: 'order',
    });

    try {
      const game = await ctx.runQuery(internal.games.getGameInternal, { gameId });
      if (!game || !game.apiKey) throw new Error("API key not set");

      const lieutenants = game.lieutenants as Lieutenant[];
      const lt = lieutenants.find(l => l.id === lieutenantId);
      if (!lt) throw new Error("Lieutenant not found");

      const context = buildOrderContext(game as GameData, lt);
      const result = await callLieutenantLLM(game.apiKey, game.model, lt, message, context);

      if (result.success && result.output) {
        await ctx.runMutation(internal.games.applyLieutenantResult, {
          gameId, lieutenantId, team: 'player', output: result.output, order: message,
        });
      } else {
        await ctx.runMutation(internal.games.markLieutenantBusy, {
          gameId, lieutenantId, team: 'player', busy: false,
        });
        await ctx.runMutation(internal.games.addMessage, {
          gameId,
          messageId: `msg_${Date.now()}_${lieutenantId}`,
          from: lieutenantId, to: 'commander',
          content: `I didn't quite follow that, commander. Could you clarify? (${result.error})`,
          timestamp: Date.now(), tick: 0, messageType: 'alert',
        });
      }
    } catch (err) {
      await ctx.runMutation(internal.games.markLieutenantBusy, {
        gameId, lieutenantId, team: 'player', busy: false,
      });
      await ctx.runMutation(internal.games.addMessage, {
        gameId,
        messageId: `msg_${Date.now()}_${lieutenantId}`,
        from: lieutenantId, to: 'commander',
        content: `Communication error: ${(err as Error).message}`,
        timestamp: Date.now(), tick: 0, messageType: 'alert',
      });
    }
  },
});

// Send an order during battle
export const sendOrder = action({
  args: {
    gameId: v.id("games"),
    lieutenantId: v.string(),
    order: v.string(),
  },
  handler: async (ctx, { gameId, lieutenantId, order }) => {
    await ctx.runMutation(internal.games.markLieutenantBusy, {
      gameId, lieutenantId, team: 'player', busy: true,
    });

    await ctx.runMutation(internal.games.addMessage, {
      gameId,
      messageId: `msg_${Date.now()}_cmd`,
      from: 'commander', to: lieutenantId,
      content: order, timestamp: Date.now(), tick: 0, messageType: 'order',
    });

    try {
      const game = await ctx.runQuery(internal.games.getGameInternal, { gameId });
      if (!game || !game.apiKey) throw new Error("API key not set");

      const lieutenants = game.lieutenants as Lieutenant[];
      const lt = lieutenants.find(l => l.id === lieutenantId);
      if (!lt) throw new Error("Lieutenant not found");

      const context = buildOrderContext(game as GameData, lt);
      const result = await callLieutenantLLM(game.apiKey, game.model, lt, order, context);

      if (result.success && result.output) {
        await ctx.runMutation(internal.games.applyLieutenantResult, {
          gameId, lieutenantId, team: 'player', output: result.output, order,
        });
      } else {
        await ctx.runMutation(internal.games.markLieutenantBusy, {
          gameId, lieutenantId, team: 'player', busy: false,
        });
        await ctx.runMutation(internal.games.addMessage, {
          gameId,
          messageId: `msg_${Date.now()}_${lieutenantId}`,
          from: lieutenantId, to: 'commander',
          content: `Error processing order: ${result.error}`,
          timestamp: Date.now(), tick: 0, messageType: 'alert',
        });
      }
    } catch (err) {
      await ctx.runMutation(internal.games.markLieutenantBusy, {
        gameId, lieutenantId, team: 'player', busy: false,
      });
      await ctx.runMutation(internal.games.addMessage, {
        gameId,
        messageId: `msg_${Date.now()}_${lieutenantId}`,
        from: lieutenantId, to: 'commander',
        content: `Error: ${(err as Error).message}`,
        timestamp: Date.now(), tick: 0, messageType: 'alert',
      });
    }
  },
});

// ─── Internal Actions (scheduled by mutations) ──────────────────────────────

export const briefEnemyLieutenants = internalAction({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.runQuery(internal.games.getGameInternal, { gameId });
    if (!game || !game.apiKey || !game.aiCommander) return;

    const commander = game.aiCommander as AICommander;
    const enemyLieutenants = game.enemyLieutenants as Lieutenant[];

    const simState: SimulationState = {
      battle: game.battleState as SimulationState['battle'],
      runtimes: (game.runtimes || {}) as SimulationState['runtimes'],
      squadCasualties: (game.squadCasualties || {}) as SimulationState['squadCasualties'],
      activeEngagements: (game.activeEngagements || []) as string[],
    };

    const orders = await callCommanderLLM(game.apiKey, commander, simState);

    if (orders) {
      for (const cmdOrder of orders) {
        const lt = enemyLieutenants.find(l => l.id === cmdOrder.lieutenantId);
        if (lt) {
          const context = buildOrderContext(game as GameData, lt);
          const result = await callLieutenantLLM(game.apiKey, game.model, lt, cmdOrder.order, context);

          if (result.success && result.output) {
            await ctx.runMutation(internal.games.applyLieutenantResult, {
              gameId, lieutenantId: lt.id, team: 'enemy', output: result.output, order: cmdOrder.order,
            });
          }
        }
      }
    }

    await ctx.runMutation(internal.games.addMessage, {
      gameId,
      messageId: `msg_${Date.now()}_intel_enemy`,
      from: 'intel', to: 'commander',
      content: 'Intelligence report: Enemy forces are organizing. Their commander is issuing orders.',
      timestamp: Date.now(), tick: 0, messageType: 'alert',
    });
  },
});

export const briefPlayerAILieutenants = internalAction({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.runQuery(internal.games.getGameInternal, { gameId });
    if (!game || !game.apiKey || !game.playerAICommander) return;

    const commander = game.playerAICommander as AICommander;
    const lieutenants = game.lieutenants as Lieutenant[];

    const simState: SimulationState = {
      battle: game.battleState as SimulationState['battle'],
      runtimes: (game.runtimes || {}) as SimulationState['runtimes'],
      squadCasualties: (game.squadCasualties || {}) as SimulationState['squadCasualties'],
      activeEngagements: (game.activeEngagements || []) as string[],
    };

    const orders = await callCommanderLLM(game.apiKey, commander, simState);

    if (orders) {
      for (const cmdOrder of orders) {
        const lt = lieutenants.find(l => l.id === cmdOrder.lieutenantId);
        if (lt) {
          const context = buildOrderContext(game as GameData, lt);
          const result = await callLieutenantLLM(game.apiKey, game.model, lt, cmdOrder.order, context);

          if (result.success && result.output) {
            await ctx.runMutation(internal.games.applyLieutenantResult, {
              gameId, lieutenantId: lt.id, team: 'player', output: result.output, order: cmdOrder.order,
            });
          }
        }
      }
    }
  },
});

export const runAICommanderCycle = internalAction({
  args: { gameId: v.id("games"), commanderTeam: v.string() },
  handler: async (ctx, { gameId, commanderTeam }) => {
    const game = await ctx.runQuery(internal.games.getGameInternal, { gameId });
    if (!game || !game.apiKey) return;

    const isEnemy = commanderTeam === 'enemy';
    const commander = (isEnemy ? game.aiCommander : game.playerAICommander) as AICommander | undefined;
    const lieutenants = (isEnemy ? game.enemyLieutenants : game.lieutenants) as Lieutenant[];

    if (!commander) return;

    const simState: SimulationState = {
      battle: game.battleState as SimulationState['battle'],
      runtimes: (game.runtimes || {}) as SimulationState['runtimes'],
      squadCasualties: (game.squadCasualties || {}) as SimulationState['squadCasualties'],
      activeEngagements: (game.activeEngagements || []) as string[],
    };

    const orders = await callCommanderLLM(game.apiKey, commander, simState);

    if (orders) {
      for (const cmdOrder of orders) {
        const lt = lieutenants.find(l => l.id === cmdOrder.lieutenantId);
        if (lt && !lt.busy) {
          const context = buildOrderContext(game as GameData, lt);
          const result = await callLieutenantLLM(game.apiKey, game.model, lt, cmdOrder.order, context);

          if (result.success && result.output) {
            await ctx.runMutation(internal.games.applyLieutenantResult, {
              gameId, lieutenantId: lt.id, team: commanderTeam, output: result.output, order: cmdOrder.order,
            });
          }
        }
      }

      if (commanderTeam === 'player') {
        for (const cmdOrder of orders) {
          await ctx.runMutation(internal.games.addMessage, {
            gameId,
            messageId: `msg_${Date.now()}_ai_cmd_${cmdOrder.lieutenantId}`,
            from: 'player_ai', to: cmdOrder.lieutenantId,
            content: cmdOrder.order, timestamp: Date.now(),
            tick: (game.battleState as { tick?: number })?.tick || 0,
            messageType: 'order',
          });
        }
      }
    }
  },
});

// ─── Helper Functions ────────────────────────────────────────────────────────

interface GameData {
  apiKey: string;
  model: string;
  battleState: SimulationState['battle'];
  runtimes: Record<string, unknown>;
  lieutenants: Lieutenant[];
  enemyLieutenants: Lieutenant[];
  [key: string]: unknown;
}

function buildOrderContext(game: GameData, lieutenant: Lieutenant) {
  const battle = game.battleState;
  if (!battle) return {
    currentOrders: '',
    visibleUnits: [] as VisibleUnitInfo[],
    visibleEnemies: [] as VisibleEnemyInfo[],
    terrain: 'Open battlefield',
  };

  const agents = battle.agents || {};

  const visibleUnits: VisibleUnitInfo[] = lieutenant.troopIds
    .map(id => agents[id])
    .filter((a): a is NonNullable<typeof a> => a !== undefined && a.alive)
    .map(a => ({
      id: a.id,
      position: { x: a.position.x, y: a.position.y },
      health: a.health,
      morale: a.morale,
    }));

  const visibleEnemies: VisibleEnemyInfo[] = [];
  const seenEnemyIds = new Set<string>();

  for (const troopId of lieutenant.troopIds) {
    const troop = agents[troopId];
    if (!troop || !troop.alive) continue;

    for (const agent of Object.values(agents)) {
      if (agent.team === troop.team || !agent.alive) continue;
      if (seenEnemyIds.has(agent.id)) continue;

      const dist = distance(troop.position, agent.position);
      if (dist <= troop.visibilityRadius) {
        seenEnemyIds.add(agent.id);
        visibleEnemies.push({
          id: agent.id,
          position: { x: agent.position.x, y: agent.position.y },
          distance: dist,
        });
      }
    }
  }

  return {
    currentOrders: '',
    visibleUnits,
    visibleEnemies,
    terrain: 'Open battlefield with ridge formations',
  };
}

async function callLieutenantLLM(
  apiKey: string,
  model: string,
  lieutenant: Lieutenant,
  order: string,
  context: { currentOrders: string; visibleUnits: VisibleUnitInfo[]; visibleEnemies?: VisibleEnemyInfo[]; terrain: string }
) {
  const systemPrompt = buildLieutenantPrompt({
    identity: {
      id: lieutenant.id,
      name: lieutenant.name,
      personality: lieutenant.personality,
      stats: lieutenant.stats,
    },
    currentOrders: context.currentOrders || order,
    visibleUnits: context.visibleUnits,
    visibleEnemies: context.visibleEnemies,
    authorizedPeers: lieutenant.authorizedPeers,
    terrain: context.terrain,
    recentMessages: lieutenant.messageHistory,
  });

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  try {
    let response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: order }],
    });

    let textContent = response.content.find(c => c.type === 'text');
    if (!textContent || !('text' in textContent)) {
      return { success: false as const, error: 'No text response from LLM' };
    }

    let parseResult = parseLieutenantOutput(textContent.text);

    if (!parseResult.success) {
      const retryPrompt = `${order}\n\nYour previous response was invalid: ${parseResult.error}\nPlease respond with valid JSON only.`;
      response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: retryPrompt }],
      });

      textContent = response.content.find(c => c.type === 'text');
      if (textContent && 'text' in textContent) {
        parseResult = parseLieutenantOutput(textContent.text);
      }
    }

    if (parseResult.success) {
      return { success: true as const, output: parseResult.data };
    }
    return { success: false as const, error: parseResult.error };
  } catch (error) {
    return { success: false as const, error: (error as Error).message };
  }
}

async function callCommanderLLM(
  apiKey: string,
  commander: AICommander,
  sim: SimulationState
): Promise<CommanderOrder[] | null> {
  const systemPrompt = buildCommanderContext(commander, sim);
  const userMessage = `Tick ${sim.battle.tick}. Assess the battlefield and issue orders to your lieutenants. Be decisive.`;

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: commander.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || !('text' in textContent)) return null;

    const raw = JSON.parse(textContent.text);
    const result = CommanderOutputSchema.safeParse(raw);
    if (!result.success) return null;

    return result.data.orders;
  } catch {
    return null;
  }
}
