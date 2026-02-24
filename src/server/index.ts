// Warchief Server - WebSocket + HTTP server for the game
// Serves frontend and handles real-time battle simulation

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

import { createSimulation, simulationTick, getFilteredStateForTeam, getDetailedBattleSummary, SimulationState, distance } from './sim/simulation.js';
import { createBasicScenario, createAssaultScenario } from './sim/scenario.js';
import { createLieutenant, processOrder, Lieutenant, LLMClient, OrderContext } from './agents/lieutenant.js';
import { VisibleUnitInfo, VisibleEnemyInfo } from './agents/input-builder.js';
import { compileDirectives, applyFlowcharts } from './agents/compiler.js';
import { createAICommander, generateCommanderOrders, AICommander } from './agents/ai-commander.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;

// Game state per connection
interface GameSession {
  ws: WebSocket;
  apiKey: string | null;
  model: string;
  simulation: SimulationState | null;
  lieutenants: Lieutenant[];             // Player's lieutenants
  enemyLieutenants: Lieutenant[];        // Enemy LLM lieutenants
  aiCommander: AICommander | null;       // Enemy AI commander
  timer: NodeJS.Timeout | null;
  anthropicClient: LLMClient | null;
  aiCommanderInterval: number;           // How often AI commander acts (in ticks)
}

const sessions = new Map<WebSocket, GameSession>();

// Available models
const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', default: true },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (faster)' },
];

// AI Commander order interval (every N ticks)
const AI_COMMANDER_INTERVAL = 50; // Every 5 seconds

// Create Express app
const app = express();
app.use(express.json());

// Serve static frontend in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

// Get available models
app.get('/api/models', (_req, res) => {
  res.json({ models: AVAILABLE_MODELS });
});

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('Client connected');

  const session: GameSession = {
    ws,
    apiKey: null,
    model: AVAILABLE_MODELS.find(m => m.default)?.id || AVAILABLE_MODELS[0]!.id,
    simulation: null,
    lieutenants: [],
    enemyLieutenants: [],
    aiCommander: null,
    timer: null,
    anthropicClient: null,
    aiCommanderInterval: AI_COMMANDER_INTERVAL,
  };

  sessions.set(ws, session);

  // Send initial state
  send(ws, {
    type: 'connected',
    data: {
      models: AVAILABLE_MODELS,
      selectedModel: session.model,
      needsApiKey: true,
    },
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(session, message);
    } catch (err) {
      console.error('Error handling message:', err);
      send(ws, { type: 'error', data: { message: (err as Error).message } });
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (session.timer) {
      clearInterval(session.timer);
    }
    sessions.delete(ws);
  });
});

function send(ws: WebSocket, message: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

async function handleMessage(session: GameSession, message: { type: string; data?: unknown }) {
  const { ws } = session;

  switch (message.type) {
    case 'set_api_key': {
      const { apiKey } = message.data as { apiKey: string };

      // Validate API key format (basic check)
      if (!apiKey || !apiKey.startsWith('sk-')) {
        send(ws, { type: 'error', data: { message: 'Invalid API key format' } });
        return;
      }

      // Test the API key with a minimal call
      try {
        const client = new Anthropic({ apiKey });
        await client.messages.create({
          model: session.model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        });

        session.apiKey = apiKey;
        session.anthropicClient = client as unknown as LLMClient;

        send(ws, { type: 'api_key_valid', data: { valid: true } });
      } catch (err) {
        send(ws, { type: 'error', data: { message: 'Invalid API key: ' + (err as Error).message } });
      }
      break;
    }

    case 'set_model': {
      const { model } = message.data as { model: string };
      if (AVAILABLE_MODELS.find(m => m.id === model)) {
        session.model = model;
        send(ws, { type: 'model_set', data: { model } });
      }
      break;
    }

    case 'init_battle': {
      const { scenario, briefings } = message.data as {
        scenario: 'basic' | 'assault';
        briefings: Record<string, string>;
      };

      // Create scenario
      const scenarioData = scenario === 'assault' ? createAssaultScenario() : createBasicScenario();

      // Create simulation with message routing callbacks
      session.simulation = createSimulation(
        scenarioData.width,
        scenarioData.height,
        scenarioData.agents,
        scenarioData.flowcharts,
        {
          onTroopMessage: (agentId, type, message) => {
            // Find which lieutenant this troop reports to
            const agent = session.simulation?.battle.agents.get(agentId);
            if (!agent) return;
            const lt = session.lieutenants.find(l => l.troopIds.includes(agentId))
              || session.enemyLieutenants.find(l => l.troopIds.includes(agentId));

            // Only relay player troop messages to the client
            if (agent.team === 'player') {
              send(ws, {
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

      // Create enemy lieutenants (LLM-powered)
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

      // Process initial briefings for player lieutenants
      if (session.apiKey && session.anthropicClient) {
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
      }

      // Send initial state (visibility-filtered)
      sendBattleState(session);
      sendLieutenants(session);

      send(ws, { type: 'battle_ready', data: {} });
      break;
    }

    case 'start_battle': {
      if (!session.simulation) {
        send(ws, { type: 'error', data: { message: 'No battle initialized' } });
        return;
      }

      session.simulation.battle.running = true;

      // Start simulation loop
      session.timer = setInterval(() => {
        if (session.simulation && session.simulation.battle.running) {
          // Run simulation tick
          simulationTick(session.simulation);

          // Send state every 5 ticks (visibility-filtered)
          if (session.simulation.battle.tick % 5 === 0) {
            sendBattleState(session);
          }

          // AI Commander decision cycle (non-blocking)
          if (
            session.aiCommander &&
            !session.aiCommander.busy &&
            session.simulation.battle.tick % session.aiCommanderInterval === 0 &&
            session.simulation.battle.tick > 0
          ) {
            runAICommanderCycle(session).catch(err => {
              console.error('AI Commander error:', err);
            });
          }

          // Check for battle end
          if (session.simulation.battle.winner) {
            if (session.timer) clearInterval(session.timer);

            const summary = getDetailedBattleSummary(session.simulation);
            send(ws, {
              type: 'battle_end',
              data: {
                winner: summary.winner,
                summary,
              },
            });
          }
        }
      }, 100);

      send(ws, { type: 'battle_started', data: {} });
      break;
    }

    case 'pause_battle': {
      if (session.simulation) {
        session.simulation.battle.running = false;
        if (session.timer) {
          clearInterval(session.timer);
          session.timer = null;
        }
        send(ws, { type: 'battle_paused', data: {} });
      }
      break;
    }

    case 'resume_battle': {
      if (session.simulation && !session.simulation.battle.running) {
        session.simulation.battle.running = true;

        // Restart the simulation loop
        session.timer = setInterval(() => {
          if (session.simulation && session.simulation.battle.running) {
            simulationTick(session.simulation);

            if (session.simulation.battle.tick % 5 === 0) {
              sendBattleState(session);
            }

            if (
              session.aiCommander &&
              !session.aiCommander.busy &&
              session.simulation.battle.tick % session.aiCommanderInterval === 0 &&
              session.simulation.battle.tick > 0
            ) {
              runAICommanderCycle(session).catch(err => {
                console.error('AI Commander error:', err);
              });
            }

            if (session.simulation.battle.winner) {
              if (session.timer) clearInterval(session.timer);

              const summary = getDetailedBattleSummary(session.simulation);
              send(ws, {
                type: 'battle_end',
                data: { winner: summary.winner, summary },
              });
            }
          }
        }, 100);

        send(ws, { type: 'battle_resumed', data: {} });
      }
      break;
    }

    case 'send_order': {
      const { lieutenantId, order } = message.data as { lieutenantId: string; order: string };

      if (!session.apiKey || !session.anthropicClient) {
        send(ws, { type: 'error', data: { message: 'API key not set' } });
        return;
      }

      const lieutenant = session.lieutenants.find(lt => lt.id === lieutenantId);
      if (!lieutenant) {
        send(ws, { type: 'error', data: { message: 'Lieutenant not found' } });
        return;
      }

      // Mark as busy
      lieutenant.busy = true;
      sendLieutenants(session);

      // Send order message
      send(ws, {
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

      // Process order
      try {
        const context = buildOrderContext(session, lieutenant);
        const result = await processOrderWithModel(session, lieutenant, order, context);

        lieutenant.busy = false;

        if (result.success && result.output) {
          // Send response
          send(ws, {
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

          // Compile and apply flowcharts
          const compiled = compileDirectives(result.output, lieutenant.troopIds);
          if (session.simulation) {
            applyFlowcharts(compiled, session.simulation.runtimes);
          }

          // Send updated flowchart
          send(ws, {
            type: 'flowchart',
            data: {
              lieutenantId,
              flowcharts: compiled.flowcharts,
            },
          });
        } else {
          send(ws, {
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
        send(ws, {
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
  }
}

// Send visibility-filtered battle state to the player
function sendBattleState(session: GameSession) {
  if (!session.simulation) return;

  const filtered = getFilteredStateForTeam(session.simulation, 'player');

  // Also include currentNodeId from runtimes for flowchart highlighting
  const activeNodes: Record<string, string | null> = {};
  for (const [agentId, runtime] of session.simulation.runtimes) {
    activeNodes[agentId] = runtime.currentNodeId;
  }

  send(session.ws, {
    type: 'state',
    data: {
      ...filtered,
      activeNodes,
    },
  });
}

function sendLieutenants(session: GameSession) {
  send(session.ws, {
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

function buildOrderContext(session: GameSession, lieutenant: Lieutenant): OrderContext {
  const visibleUnits: VisibleUnitInfo[] = lieutenant.troopIds
    .map(id => session.simulation?.battle.agents.get(id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined && a.alive)
    .map(a => ({
      id: a.id,
      position: { x: a.position.x, y: a.position.y },
      health: a.health,
      morale: a.morale,
    }));

  // Aggregate enemy visibility across all of this lieutenant's troops
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

async function processInitialBriefing(session: GameSession, lieutenant: Lieutenant, briefing: string) {
  if (!session.anthropicClient) return;

  const context = buildOrderContext(session, lieutenant);
  const result = await processOrderWithModel(session, lieutenant, briefing, context);

  if (result.success && result.output) {
    // Apply the compiled flowcharts
    const compiled = compileDirectives(result.output, lieutenant.troopIds);
    if (session.simulation) {
      applyFlowcharts(compiled, session.simulation.runtimes);
    }

    // Send lieutenant's response as a message
    send(session.ws, {
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

async function processOrderWithModel(
  session: GameSession,
  lieutenant: Lieutenant,
  order: string,
  context: OrderContext
) {
  const client = session.anthropicClient;
  if (!client) throw new Error('No API client');

  // Override the model in the processOrder call
  const originalCreate = client.messages.create.bind(client.messages);
  client.messages.create = async (params: Parameters<typeof originalCreate>[0]) => {
    return originalCreate({ ...params, model: session.model });
  };

  return processOrder(lieutenant, order, context, client);
}

// Brief enemy lieutenants through the AI commander
async function briefEnemyLieutenants(session: GameSession) {
  if (!session.anthropicClient || !session.aiCommander || !session.simulation) return;

  // Generate initial orders from AI commander
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

  // Notify the player that the enemy is preparing
  send(session.ws, {
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

// Run AI commander decision cycle during battle
async function runAICommanderCycle(session: GameSession) {
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

// Fallback to serving index.html for SPA routing
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Start server
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   WARCHIEF SERVER                                             ║
║                                                               ║
║   http://localhost:${PORT}                                      ║
║   LLM Opponent: ENABLED                                       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
