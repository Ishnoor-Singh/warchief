// Warchief Headless CLI Mode
// Runs the full game in a single process with NDJSON on stdin/stdout.
// Designed for AI players (e.g. Claude Code) to play the game programmatically.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... npx tsx src/headless.ts [--scenario basic|assault] [--model <model-id>]
//
// Protocol (newline-delimited JSON):
//
// OUTPUT (game → player):
//   { "type": "ready", "data": { lieutenants, scenario, battlefield } }
//   { "type": "state", "data": { tick, agents, running, winner, ... } }
//   { "type": "message", "data": { id, from, to, content, type, tick } }
//   { "type": "lieutenants", "data": { lieutenants: [...] } }
//   { "type": "flowchart", "data": { lieutenantId, flowcharts } }
//   { "type": "battle_end", "data": { winner, summary } }
//   { "type": "error", "data": { message } }
//
// INPUT (player → game):
//   { "type": "briefing", "data": { briefings: { lt_alpha: "...", lt_bravo: "...", ... } } }
//   { "type": "order", "data": { lieutenantId: "lt_alpha", order: "..." } }
//   { "type": "start" }
//   { "type": "pause" }
//   { "type": "resume" }
//   { "type": "status" }

import * as readline from 'readline';
import Anthropic from '@anthropic-ai/sdk';

import { createSimulation, simulationTick, getFilteredStateForTeam, getDetailedBattleSummary, SimulationState, distance } from './server/sim/simulation.js';
import { createBasicScenario, createAssaultScenario } from './server/sim/scenario.js';
import { createLieutenant, processOrder, Lieutenant, LLMClient, OrderContext } from './server/agents/lieutenant.js';
import { VisibleUnitInfo, VisibleEnemyInfo } from './server/agents/input-builder.js';
import { compileDirectives, applyFlowcharts } from './server/agents/compiler.js';
import { createAICommander, generateCommanderOrders, AICommander } from './server/agents/ai-commander.js';

// ─── Configuration ───────────────────────────────────────────────────────────

const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', default: true },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (faster)' },
];

const AI_COMMANDER_INTERVAL = 50; // Every 5 seconds at 10 tps

// ─── Parse CLI args ──────────────────────────────────────────────────────────

function parseArgs(): { scenario: 'basic' | 'assault'; model: string } {
  const args = process.argv.slice(2);
  let scenario: 'basic' | 'assault' = 'basic';
  let model = AVAILABLE_MODELS.find(m => m.default)?.id || AVAILABLE_MODELS[0]!.id;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      const val = args[i + 1];
      if (val === 'basic' || val === 'assault') {
        scenario = val;
      }
      i++;
    } else if (args[i] === '--model' && args[i + 1]) {
      model = args[i + 1]!;
      i++;
    }
  }

  return { scenario, model };
}

// ─── Output helper ───────────────────────────────────────────────────────────

function emit(message: { type: string; data?: unknown }) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

// ─── Game session state ──────────────────────────────────────────────────────

interface HeadlessSession {
  simulation: SimulationState | null;
  lieutenants: Lieutenant[];
  enemyLieutenants: Lieutenant[];
  aiCommander: AICommander | null;
  timer: NodeJS.Timeout | null;
  anthropicClient: LLMClient | null;
  model: string;
  scenario: 'basic' | 'assault';
  aiCommanderInterval: number;
}

// ─── Core game logic (reused from server/index.ts) ──────────────────────────

function buildOrderContext(session: HeadlessSession, lieutenant: Lieutenant): OrderContext {
  const visibleUnits: VisibleUnitInfo[] = lieutenant.troopIds
    .map(id => session.simulation?.battle.agents.get(id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined && a.alive)
    .map(a => ({
      id: a.id,
      position: { x: a.position.x, y: a.position.y },
      health: a.health,
      morale: a.morale,
    }));

  const visibleEnemies: VisibleEnemyInfo[] = [];
  const seenEnemyIds = new Set<string>();

  if (session.simulation) {
    for (const troopId of lieutenant.troopIds) {
      const troop = session.simulation.battle.agents.get(troopId);
      if (!troop || !troop.alive) continue;

      for (const agent of session.simulation.battle.agents.values()) {
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
  }

  return {
    currentOrders: '',
    visibleUnits,
    visibleEnemies,
    terrain: 'Open battlefield with ridge formations',
  };
}

async function processOrderWithModel(
  session: HeadlessSession,
  lieutenant: Lieutenant,
  order: string,
  context: OrderContext
) {
  const client = session.anthropicClient;
  if (!client) throw new Error('No API client');

  const originalCreate = client.messages.create.bind(client.messages);
  client.messages.create = async (params: Parameters<typeof originalCreate>[0]) => {
    return originalCreate({ ...params, model: session.model });
  };

  return processOrder(lieutenant, order, context, client);
}

async function processInitialBriefing(session: HeadlessSession, lieutenant: Lieutenant, briefing: string) {
  if (!session.anthropicClient) return;

  const context = buildOrderContext(session, lieutenant);
  const result = await processOrderWithModel(session, lieutenant, briefing, context);

  if (result.success && result.output) {
    const compiled = compileDirectives(result.output, lieutenant.troopIds);
    if (session.simulation) {
      applyFlowcharts(compiled, session.simulation.runtimes);
    }

    emit({
      type: 'message',
      data: {
        id: `msg_${Date.now()}_${lieutenant.id}`,
        from: lieutenant.id,
        to: 'commander',
        content: result.output.message_up || 'Understood, commander.',
        timestamp: Date.now(),
        tick: 0,
        type: 'report',
      },
    });
  }
}

async function briefEnemyLieutenants(session: HeadlessSession) {
  if (!session.anthropicClient || !session.aiCommander || !session.simulation) return;

  const result = await generateCommanderOrders(session.aiCommander, session.simulation, session.anthropicClient);

  if (result.success && result.orders) {
    for (const commanderOrder of result.orders) {
      const enemyLt = session.enemyLieutenants.find(lt => lt.id === commanderOrder.lieutenantId);
      if (enemyLt) {
        const context = buildOrderContext(session, enemyLt);
        const ltResult = await processOrderWithModel(session, enemyLt, commanderOrder.order, context);

        if (ltResult.success && ltResult.output) {
          const compiled = compileDirectives(ltResult.output, enemyLt.troopIds);
          applyFlowcharts(compiled, session.simulation!.runtimes);
        }
      }
    }
  }

  emit({
    type: 'message',
    data: {
      id: `msg_${Date.now()}_intel`,
      from: 'intel',
      to: 'commander',
      content: 'Intelligence report: Enemy forces are organizing. Their commanders appear to be issuing orders.',
      timestamp: Date.now(),
      tick: 0,
      type: 'alert',
    },
  });
}

async function runAICommanderCycle(session: HeadlessSession) {
  if (!session.anthropicClient || !session.aiCommander || !session.simulation) return;

  const result = await generateCommanderOrders(session.aiCommander, session.simulation, session.anthropicClient);

  if (result.success && result.orders) {
    for (const commanderOrder of result.orders) {
      const enemyLt = session.enemyLieutenants.find(lt => lt.id === commanderOrder.lieutenantId);
      if (enemyLt && !enemyLt.busy) {
        const context = buildOrderContext(session, enemyLt);
        const ltResult = await processOrderWithModel(session, enemyLt, commanderOrder.order, context);

        if (ltResult.success && ltResult.output) {
          const compiled = compileDirectives(ltResult.output, enemyLt.troopIds);
          if (session.simulation) {
            applyFlowcharts(compiled, session.simulation.runtimes);
          }
        }
      }
    }
  }
}

// ─── Send helpers ────────────────────────────────────────────────────────────

function sendBattleState(session: HeadlessSession) {
  if (!session.simulation) return;

  const filtered = getFilteredStateForTeam(session.simulation, 'player');

  const activeNodes: Record<string, string | null> = {};
  for (const [agentId, runtime] of session.simulation.runtimes) {
    activeNodes[agentId] = runtime.currentNodeId;
  }

  emit({
    type: 'state',
    data: { ...filtered, activeNodes },
  });
}

function sendLieutenants(session: HeadlessSession) {
  emit({
    type: 'lieutenants',
    data: {
      lieutenants: session.lieutenants.map(lt => ({
        id: lt.id,
        name: lt.name,
        personality: lt.personality,
        troopIds: lt.troopIds,
        busy: lt.busy,
        stats: lt.stats,
      })),
    },
  });
}

// ─── Initialize game ─────────────────────────────────────────────────────────

function initializeGame(session: HeadlessSession): void {
  const scenarioData = session.scenario === 'assault' ? createAssaultScenario() : createBasicScenario();

  session.simulation = createSimulation(
    scenarioData.width,
    scenarioData.height,
    scenarioData.agents,
    scenarioData.flowcharts,
    {
      onTroopMessage: (agentId, type, message) => {
        const agent = session.simulation?.battle.agents.get(agentId);
        if (!agent) return;
        const lt = session.lieutenants.find(l => l.troopIds.includes(agentId))
          || session.enemyLieutenants.find(l => l.troopIds.includes(agentId));

        if (agent.team === 'player') {
          emit({
            type: 'message',
            data: {
              id: `msg_${Date.now()}_${agentId}`,
              from: lt?.id || agentId,
              to: 'commander',
              content: `[${agentId}] ${message}`,
              timestamp: Date.now(),
              tick: session.simulation?.battle.tick ?? 0,
              type: type === 'alert' ? 'alert' : 'report',
            },
          });
        }
      },
    }
  );

  // Create player lieutenants
  session.lieutenants = [
    createLieutenant({
      id: 'lt_alpha',
      name: 'Lt. Adaeze',
      personality: 'aggressive',
      stats: { initiative: 8, discipline: 5, communication: 7 },
      troopIds: Array.from(session.simulation.battle.agents.keys()).filter(id => id.startsWith('p_s1')),
      authorizedPeers: ['lt_bravo'],
    }),
    createLieutenant({
      id: 'lt_bravo',
      name: 'Lt. Chen',
      personality: 'cautious',
      stats: { initiative: 5, discipline: 8, communication: 6 },
      troopIds: Array.from(session.simulation.battle.agents.keys()).filter(id => id.startsWith('p_s2')),
      authorizedPeers: ['lt_alpha', 'lt_charlie'],
    }),
    createLieutenant({
      id: 'lt_charlie',
      name: 'Lt. Morrison',
      personality: 'disciplined',
      stats: { initiative: 6, discipline: 9, communication: 5 },
      troopIds: Array.from(session.simulation.battle.agents.keys()).filter(id => id.startsWith('p_s3')),
      authorizedPeers: ['lt_bravo'],
    }),
  ];

  // Create enemy lieutenants
  session.enemyLieutenants = [
    createLieutenant({
      id: 'lt_enemy_1',
      name: 'Lt. Volkov',
      personality: 'aggressive',
      stats: { initiative: 7, discipline: 6, communication: 5 },
      troopIds: Array.from(session.simulation.battle.agents.keys()).filter(id => id.startsWith('e_s1') || id.startsWith('e_s2')),
      authorizedPeers: ['lt_enemy_2'],
    }),
    createLieutenant({
      id: 'lt_enemy_2',
      name: 'Lt. Kira',
      personality: 'cautious',
      stats: { initiative: 5, discipline: 8, communication: 7 },
      troopIds: Array.from(session.simulation.battle.agents.keys()).filter(id => id.startsWith('e_s3')),
      authorizedPeers: ['lt_enemy_1'],
    }),
  ];

  // Create AI commander
  session.aiCommander = createAICommander({
    personality: 'balanced',
    lieutenantIds: session.enemyLieutenants.map(lt => lt.id),
    model: session.model,
  });
}

// ─── Start simulation loop ──────────────────────────────────────────────────

function startBattle(session: HeadlessSession): void {
  if (!session.simulation) {
    emit({ type: 'error', data: { message: 'No battle initialized' } });
    return;
  }

  session.simulation.battle.running = true;

  session.timer = setInterval(() => {
    if (session.simulation && session.simulation.battle.running) {
      simulationTick(session.simulation);

      // Send state every 5 ticks
      if (session.simulation.battle.tick % 5 === 0) {
        sendBattleState(session);
      }

      // AI Commander cycle
      if (
        session.aiCommander &&
        !session.aiCommander.busy &&
        session.simulation.battle.tick % session.aiCommanderInterval === 0 &&
        session.simulation.battle.tick > 0
      ) {
        runAICommanderCycle(session).catch(err => {
          emit({ type: 'error', data: { message: `AI Commander error: ${(err as Error).message}` } });
        });
      }

      // Check battle end
      if (session.simulation.battle.winner) {
        if (session.timer) clearInterval(session.timer);
        session.timer = null;

        const summary = getDetailedBattleSummary(session.simulation);
        emit({
          type: 'battle_end',
          data: { winner: summary.winner, summary },
        });

        // If stdin is already closed, exit now
        if (process.stdin.destroyed || !process.stdin.readable) {
          process.exit(0);
        }
      }
    }
  }, 100);

  emit({ type: 'battle_started', data: {} });
}

// ─── Handle incoming commands ────────────────────────────────────────────────

async function handleCommand(session: HeadlessSession, message: { type: string; data?: unknown }) {
  switch (message.type) {
    case 'briefing': {
      const { briefings } = message.data as { briefings: Record<string, string> };

      if (!session.anthropicClient) {
        emit({ type: 'error', data: { message: 'No API key configured (set ANTHROPIC_API_KEY env var)' } });
        return;
      }

      const briefingPromises: Promise<void>[] = [];

      for (const lt of session.lieutenants) {
        const briefing = briefings[lt.id];
        if (briefing) {
          briefingPromises.push(processInitialBriefing(session, lt, briefing));
        }
      }

      // Brief enemy lieutenants via AI commander
      briefingPromises.push(briefEnemyLieutenants(session));

      await Promise.all(briefingPromises);

      sendBattleState(session);
      sendLieutenants(session);
      emit({ type: 'battle_ready', data: {} });
      break;
    }

    case 'order': {
      const { lieutenantId, order } = message.data as { lieutenantId: string; order: string };

      if (!session.anthropicClient) {
        emit({ type: 'error', data: { message: 'No API key configured' } });
        return;
      }

      const lieutenant = session.lieutenants.find(lt => lt.id === lieutenantId);
      if (!lieutenant) {
        emit({ type: 'error', data: { message: `Lieutenant not found: ${lieutenantId}` } });
        return;
      }

      lieutenant.busy = true;
      sendLieutenants(session);

      emit({
        type: 'message',
        data: {
          id: `msg_${Date.now()}`,
          from: 'commander',
          to: lieutenantId,
          content: order,
          timestamp: Date.now(),
          tick: session.simulation?.battle.tick ?? 0,
          type: 'order',
        },
      });

      try {
        const context = buildOrderContext(session, lieutenant);
        const result = await processOrderWithModel(session, lieutenant, order, context);

        lieutenant.busy = false;

        if (result.success && result.output) {
          emit({
            type: 'message',
            data: {
              id: `msg_${Date.now()}`,
              from: lieutenantId,
              to: 'commander',
              content: result.output.message_up || 'Understood.',
              timestamp: Date.now(),
              tick: session.simulation?.battle.tick ?? 0,
              type: 'report',
            },
          });

          // Send response_to_player if the lieutenant has something to say directly
          if (result.output.response_to_player) {
            emit({
              type: 'message',
              data: {
                id: `msg_${Date.now()}_resp`,
                from: lieutenantId,
                to: 'player',
                content: result.output.response_to_player,
                timestamp: Date.now(),
                tick: session.simulation?.battle.tick ?? 0,
                type: 'response',
              },
            });
          }

          const compiled = compileDirectives(result.output, lieutenant.troopIds);
          if (session.simulation) {
            applyFlowcharts(compiled, session.simulation.runtimes);
          }

          emit({
            type: 'flowchart',
            data: { lieutenantId, flowcharts: compiled.flowcharts },
          });
        } else {
          emit({
            type: 'message',
            data: {
              id: `msg_${Date.now()}`,
              from: lieutenantId,
              to: 'commander',
              content: `Error processing order: ${result.error}`,
              timestamp: Date.now(),
              tick: session.simulation?.battle.tick ?? 0,
              type: 'alert',
            },
          });
        }
      } catch (err) {
        lieutenant.busy = false;
        emit({
          type: 'message',
          data: {
            id: `msg_${Date.now()}`,
            from: lieutenantId,
            to: 'commander',
            content: `Error: ${(err as Error).message}`,
            timestamp: Date.now(),
            tick: session.simulation?.battle.tick ?? 0,
            type: 'alert',
          },
        });
      }

      sendLieutenants(session);
      break;
    }

    case 'start': {
      startBattle(session);
      break;
    }

    case 'pause': {
      if (session.simulation) {
        session.simulation.battle.running = false;
        if (session.timer) {
          clearInterval(session.timer);
          session.timer = null;
        }
        emit({ type: 'battle_paused', data: {} });
      }
      break;
    }

    case 'resume': {
      if (session.simulation && !session.simulation.battle.running) {
        startBattle(session);
      }
      break;
    }

    case 'status': {
      sendBattleState(session);
      sendLieutenants(session);
      break;
    }

    default: {
      emit({ type: 'error', data: { message: `Unknown command type: ${message.type}` } });
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write('Warning: ANTHROPIC_API_KEY not set. LLM features (briefings, orders) will not work.\n');
    process.stderr.write('Set it with: export ANTHROPIC_API_KEY=sk-...\n');
  }

  // Initialize client
  let anthropicClient: LLMClient | null = null;
  if (apiKey) {
    anthropicClient = new Anthropic({ apiKey }) as unknown as LLMClient;
  }

  // Build session
  const session: HeadlessSession = {
    simulation: null,
    lieutenants: [],
    enemyLieutenants: [],
    aiCommander: null,
    timer: null,
    anthropicClient,
    model: config.model,
    scenario: config.scenario,
    aiCommanderInterval: AI_COMMANDER_INTERVAL,
  };

  // Initialize the game
  initializeGame(session);

  // Emit ready state
  emit({
    type: 'ready',
    data: {
      scenario: config.scenario,
      model: config.model,
      hasApiKey: !!apiKey,
      battlefield: {
        width: session.simulation!.battle.width,
        height: session.simulation!.battle.height,
      },
      lieutenants: session.lieutenants.map(lt => ({
        id: lt.id,
        name: lt.name,
        personality: lt.personality,
        troopIds: lt.troopIds,
        stats: lt.stats,
      })),
      enemyCount: session.enemyLieutenants.reduce((sum, lt) => sum + lt.troopIds.length, 0),
    },
  });

  sendBattleState(session);
  sendLieutenants(session);

  // Set up stdin reader
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const message = JSON.parse(trimmed);
      await handleCommand(session, message);
    } catch (err) {
      emit({ type: 'error', data: { message: `Invalid JSON input: ${(err as Error).message}` } });
    }
  });

  rl.on('close', () => {
    // If battle is running, keep process alive until it ends.
    // Otherwise exit immediately.
    if (session.simulation?.battle.running && !session.simulation.battle.winner) {
      process.stderr.write('stdin closed — battle still running, waiting for it to finish...\n');
      return;
    }
    if (session.timer) clearInterval(session.timer);
    process.exit(0);
  });

  // Log to stderr (won't interfere with NDJSON on stdout)
  process.stderr.write(`Warchief Headless CLI — scenario: ${config.scenario}, model: ${config.model}\n`);
  process.stderr.write('Waiting for commands on stdin (NDJSON)...\n');
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${(err as Error).message}\n`);
  process.exit(1);
});
