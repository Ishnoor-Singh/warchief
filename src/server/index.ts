// Warchief Server - WebSocket + HTTP server for the game
// Serves frontend and handles real-time battle simulation

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

import { createSimulation, simulationTick, getFilteredStateForTeam, getDetailedBattleSummary, SimulationState, distance, BattleEvent } from './sim/simulation.js';
import { createBasicScenario, createAssaultScenario } from './sim/scenario.js';
import { createLieutenant, processOrder, Lieutenant, LLMClient, OrderContext } from './agents/lieutenant.js';
import { VisibleUnitInfo, VisibleEnemyInfo } from './agents/input-builder.js';
import { compileDirectives, applyFlowcharts } from './agents/compiler.js';
import { createAICommander, generateCommanderOrders, AICommander } from './agents/ai-commander.js';
import { Flowchart, FlowchartNode, FlowchartRuntime, createPersonalityFlowchart } from './runtime/flowchart.js';
import { type TroopAgent, type TroopStats } from '../shared/types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;

export type GameMode = 'human_vs_ai' | 'ai_vs_ai';

// Game state per connection
interface GameSession {
  ws: WebSocket;
  apiKey: string | null;
  model: string;
  simulation: SimulationState | null;
  lieutenants: Lieutenant[];             // Player's lieutenants
  enemyLieutenants: Lieutenant[];        // Enemy LLM lieutenants
  aiCommander: AICommander | null;       // Enemy AI commander
  playerAICommander: AICommander | null; // Player AI commander (ai_vs_ai mode)
  gameMode: GameMode;
  timer: NodeJS.Timeout | null;
  anthropicClient: LLMClient | null;
  aiCommanderInterval: number;           // How often AI commander acts (in ticks)
  speed: number;                         // Simulation speed multiplier (0.5, 1, 2)
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

// Check for server-side API key
const SERVER_API_KEY = process.env.ANTHROPIC_API_KEY || null;
let serverAnthropicClient: Anthropic | null = null;
if (SERVER_API_KEY) {
  serverAnthropicClient = new Anthropic({ apiKey: SERVER_API_KEY });
  console.log('Using server-side ANTHROPIC_API_KEY');
}

wss.on('connection', (ws) => {
  console.log('Client connected');

  const session: GameSession = {
    ws,
    apiKey: SERVER_API_KEY,
    model: AVAILABLE_MODELS.find(m => m.default)?.id || AVAILABLE_MODELS[0]!.id,
    simulation: null,
    lieutenants: [],
    enemyLieutenants: [],
    aiCommander: null,
    playerAICommander: null,
    gameMode: 'human_vs_ai',
    timer: null,
    anthropicClient: serverAnthropicClient,
    aiCommanderInterval: AI_COMMANDER_INTERVAL,
    speed: 1,
  };

  sessions.set(ws, session);

  // Send initial state
  send(ws, {
    type: 'connected',
    data: {
      models: AVAILABLE_MODELS,
      selectedModel: session.model,
      needsApiKey: !SERVER_API_KEY,
      hasServerKey: !!SERVER_API_KEY,
      gameMode: session.gameMode,
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

// Shared simulation loop used by start_battle, resume_battle, and set_speed
function createBattleInterval(session: GameSession): NodeJS.Timeout {
  const intervalMs = Math.round(100 / session.speed);

  return setInterval(() => {
    if (!session.simulation || !session.simulation.battle.running) return;

    simulationTick(session.simulation);

    // Drain and send battle events
    if (session.simulation.pendingBattleEvents.length > 0) {
      const events = session.simulation.pendingBattleEvents.splice(0);
      for (const evt of events) {
        send(session.ws, { type: 'battle_event', data: evt });
      }
    }

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
      runAICommanderCycle(session, session.aiCommander, session.enemyLieutenants).catch(err => {
        console.error('Enemy AI Commander error:', err);
      });
    }

    // Player AI Commander cycle (ai_vs_ai mode)
    if (
      session.playerAICommander &&
      !session.playerAICommander.busy &&
      session.simulation.battle.tick % session.aiCommanderInterval === 0 &&
      session.simulation.battle.tick > 0
    ) {
      runAICommanderCycle(session, session.playerAICommander, session.lieutenants).catch(err => {
        console.error('Player AI Commander error:', err);
      });
    }

    // Check for battle end
    if (session.simulation.battle.winner) {
      if (session.timer) clearInterval(session.timer);

      const summary = getDetailedBattleSummary(session.simulation);
      send(session.ws, {
        type: 'battle_end',
        data: { winner: summary.winner, summary },
      });
    }
  }, intervalMs);
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

    case 'set_game_mode': {
      const { mode } = message.data as { mode: GameMode };
      if (mode === 'human_vs_ai' || mode === 'ai_vs_ai') {
        session.gameMode = mode;
        send(ws, { type: 'game_mode_set', data: { mode } });
      }
      break;
    }

    case 'init_scenario': {
      // Initialize the scenario, create lieutenants and troops, but don't start the battle.
      // This allows the player to see troop info and have conversational briefings.
      const { scenario, gameMode, playerPersonality, enemyPersonality } = message.data as {
        scenario?: 'basic' | 'assault';
        gameMode?: GameMode;
        playerPersonality?: 'aggressive' | 'cautious' | 'balanced';
        enemyPersonality?: 'aggressive' | 'cautious' | 'balanced';
      };

      if (gameMode) {
        session.gameMode = gameMode;
      }

      // Create scenario
      const scenarioData = (scenario || 'basic') === 'assault' ? createAssaultScenario() : createBasicScenario();

      // Create simulation with message routing callbacks
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

      // Apply personality-based default flowcharts for all player lieutenants' troops
      const enemyCenter = { x: scenarioData.width - 50, y: scenarioData.height / 2 };
      for (const lt of session.lieutenants) {
        for (const troopId of lt.troopIds) {
          const runtime = session.simulation.runtimes.get(troopId);
          if (runtime) {
            runtime.flowchart = createPersonalityFlowchart(troopId, lt.personality, enemyCenter);
          }
        }
      }

      // Build troop info for each lieutenant to send to client
      const troopInfo: Record<string, Array<{
        id: string; squadId: string; position: { x: number; y: number };
        stats: { combat: number; speed: number; courage: number; discipline: number };
      }>> = {};

      for (const lt of session.lieutenants) {
        troopInfo[lt.id] = lt.troopIds.map(tid => {
          const agent = session.simulation!.battle.agents.get(tid) as TroopAgent;
          return {
            id: agent.id,
            squadId: agent.squadId,
            position: { x: agent.position.x, y: agent.position.y },
            stats: agent.stats as TroopStats,
          };
        });
      }

      // Send lieutenant and troop info to client
      sendLieutenants(session);
      sendAllLieutenantFlowcharts(session);

      send(ws, {
        type: 'scenario_ready',
        data: {
          troopInfo,
          mapSize: { width: scenarioData.width, height: scenarioData.height },
        },
      });
      break;
    }

    case 'pre_battle_brief': {
      // Conversational briefing: send a message to a lieutenant and get a response
      // without starting the battle. Supports multiple rounds.
      const { lieutenantId, message: briefMessage } = message.data as {
        lieutenantId: string;
        message: string;
      };

      if (!session.apiKey || !session.anthropicClient) {
        send(ws, { type: 'error', data: { message: 'API key not set' } });
        return;
      }

      if (!session.simulation) {
        send(ws, { type: 'error', data: { message: 'Scenario not initialized. Call init_scenario first.' } });
        return;
      }

      const briefLt = session.lieutenants.find(lt => lt.id === lieutenantId);
      if (!briefLt) {
        send(ws, { type: 'error', data: { message: 'Lieutenant not found' } });
        return;
      }

      if (briefLt.busy) {
        send(ws, { type: 'error', data: { message: `${briefLt.name} is still processing your previous message.` } });
        return;
      }

      // Mark as busy
      briefLt.busy = true;
      sendLieutenants(session);

      // Echo the player's message back to them
      send(ws, {
        type: 'message',
        data: {
          id: `msg_${Date.now()}_cmd`,
          from: 'commander',
          to: lieutenantId,
          content: briefMessage,
          timestamp: Date.now(),
          tick: 0,
          type: 'order',
        },
      });

      try {
        const context = buildOrderContext(session, briefLt);
        const result = await processOrderWithModel(session, briefLt, briefMessage, context);

        briefLt.busy = false;

        if (result.success && result.output) {
          // Apply flowcharts from this briefing round (including self_directives for the lieutenant)
          const compiled = compileDirectives(result.output, briefLt.troopIds, briefLt.id);
          applyFlowcharts(compiled, session.simulation!.runtimes);

          // Send updated flowchart
          const ltFlowchart = buildLieutenantFlowchart(briefLt.id, briefLt.troopIds, session.simulation!.runtimes);
          send(ws, {
            type: 'flowchart',
            data: {
              lieutenantId: briefLt.id,
              flowcharts: { [briefLt.id]: ltFlowchart },
            },
          });

          // Send lieutenant's response
          send(ws, {
            type: 'message',
            data: {
              id: `msg_${Date.now()}_${briefLt.id}`,
              from: lieutenantId,
              to: 'commander',
              content: result.output.message_up || 'Understood, commander.',
              timestamp: Date.now(),
              tick: 0,
              type: 'report',
            },
          });
        } else {
          send(ws, {
            type: 'message',
            data: {
              id: `msg_${Date.now()}_${briefLt.id}`,
              from: lieutenantId,
              to: 'commander',
              content: `I didn't quite follow that, commander. Could you clarify? (${result.error})`,
              timestamp: Date.now(),
              tick: 0,
              type: 'alert',
            },
          });
        }
      } catch (err) {
        briefLt.busy = false;
        send(ws, {
          type: 'message',
          data: {
            id: `msg_${Date.now()}_${briefLt.id}`,
            from: lieutenantId,
            to: 'commander',
            content: `Communication error: ${(err as Error).message}`,
            timestamp: Date.now(),
            tick: 0,
            type: 'alert',
          },
        });
      }

      sendLieutenants(session);
      break;
    }

    case 'init_battle': {
      const { briefings, gameMode, playerPersonality, enemyPersonality } = message.data as {
        briefings?: Record<string, string>;
        gameMode?: GameMode;
        playerPersonality?: 'aggressive' | 'cautious' | 'balanced';
        enemyPersonality?: 'aggressive' | 'cautious' | 'balanced';
      };

      if (gameMode) {
        session.gameMode = gameMode;
      }

      // If scenario not yet initialized (legacy flow or AI vs AI), do it now
      if (!session.simulation) {
        // Create scenario
        const scenarioData = createBasicScenario();

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

        // Apply personality-based default flowcharts
        const enemyCenter = { x: 350, y: 150 };
        for (const lt of session.lieutenants) {
          for (const troopId of lt.troopIds) {
            const runtime = session.simulation.runtimes.get(troopId);
            if (runtime) {
              runtime.flowchart = createPersonalityFlowchart(troopId, lt.personality, enemyCenter);
            }
          }
        }
      }

      // Create AI commander for enemy
      session.aiCommander = createAICommander({
        personality: enemyPersonality || 'balanced',
        lieutenantIds: session.enemyLieutenants.map(lt => lt.id),
        model: session.model,
        team: 'enemy',
        name: 'Enemy Commander',
      });

      // Create player AI commander if in ai_vs_ai mode
      if (session.gameMode === 'ai_vs_ai') {
        session.playerAICommander = createAICommander({
          personality: playerPersonality || 'balanced',
          lieutenantIds: session.lieutenants.map(lt => lt.id),
          model: session.model,
          team: 'player',
          name: 'Player Commander',
        });
      } else {
        session.playerAICommander = null;
      }

      // Process AI briefings (enemy always, player only in ai_vs_ai)
      if (session.apiKey && session.anthropicClient) {
        const briefingPromises: Promise<void>[] = [];

        if (session.gameMode === 'ai_vs_ai' && session.playerAICommander) {
          briefingPromises.push(briefTeamLieutenants(session, session.playerAICommander, session.lieutenants));
        } else if (briefings) {
          // Apply any final briefings that haven't been sent conversationally
          for (const lt of session.lieutenants) {
            const briefing = briefings[lt.id];
            if (briefing) {
              briefingPromises.push(processInitialBriefing(session, lt, briefing));
            }
          }
        }

        // Brief enemy lieutenants via AI commander
        briefingPromises.push(briefTeamLieutenants(session, session.aiCommander, session.enemyLieutenants));

        await Promise.all(briefingPromises);
      }

      // Send initial state (visibility-filtered)
      sendBattleState(session);
      sendLieutenants(session);
      sendAllLieutenantFlowcharts(session);

      send(ws, { type: 'battle_ready', data: { gameMode: session.gameMode } });
      break;
    }

    case 'start_battle': {
      if (!session.simulation) {
        send(ws, { type: 'error', data: { message: 'No battle initialized' } });
        return;
      }

      session.simulation.battle.running = true;
      session.timer = createBattleInterval(session);

      send(ws, { type: 'battle_started', data: { gameMode: session.gameMode } });
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
        session.timer = createBattleInterval(session);
        send(ws, { type: 'battle_resumed', data: {} });
      }
      break;
    }

    case 'send_order': {
      const { lieutenantId, order } = message.data as { lieutenantId: string; order: string };

      if (session.gameMode === 'ai_vs_ai') {
        send(ws, { type: 'error', data: { message: 'Cannot send manual orders in AI vs AI mode' } });
        return;
      }

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

          // Compile and apply flowcharts (including self_directives for the lieutenant)
          const compiled = compileDirectives(result.output, lieutenant.troopIds, lieutenant.id);
          if (session.simulation) {
            applyFlowcharts(compiled, session.simulation.runtimes);

            // Send lieutenant-level aggregated flowchart
            const ltFlowchart = buildLieutenantFlowchart(lieutenantId, lieutenant.troopIds, session.simulation.runtimes);
            send(ws, {
              type: 'flowchart',
              data: {
                lieutenantId,
                flowcharts: { [lieutenantId]: ltFlowchart },
              },
            });
          }
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

    case 'set_speed': {
      const { speed } = message.data as { speed: number };
      if ([0.5, 1, 2].includes(speed)) {
        session.speed = speed;
        send(ws, { type: 'speed_set', data: { speed } });

        // Restart the interval with new speed if battle is running
        if (session.timer && session.simulation?.battle.running) {
          clearInterval(session.timer);
          session.timer = createBattleInterval(session);
        }
      }
      break;
    }

    case 'update_lieutenant_config': {
      const { lieutenantId, personality, stats } = message.data as {
        lieutenantId: string;
        personality?: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
        stats?: { initiative?: number; discipline?: number; communication?: number };
      };

      const lt = session.lieutenants.find(l => l.id === lieutenantId);
      if (!lt) {
        send(ws, { type: 'error', data: { message: 'Lieutenant not found' } });
        return;
      }

      const personalityChanged = personality && personality !== lt.personality;
      if (personality) lt.personality = personality;
      if (stats) {
        if (stats.initiative !== undefined) lt.stats.initiative = Math.max(1, Math.min(10, stats.initiative));
        if (stats.discipline !== undefined) lt.stats.discipline = Math.max(1, Math.min(10, stats.discipline));
        if (stats.communication !== undefined) lt.stats.communication = Math.max(1, Math.min(10, stats.communication));
      }

      // If personality changed, recreate the default flowchart for all troops
      if (personalityChanged && session.simulation) {
        const enemyCenter = { x: session.simulation.battle.width - 50, y: session.simulation.battle.height / 2 };
        for (const troopId of lt.troopIds) {
          const runtime = session.simulation.runtimes.get(troopId);
          if (runtime) {
            runtime.flowchart = createPersonalityFlowchart(troopId, lt.personality, enemyCenter);
          }
        }
        const ltFlowchart = buildLieutenantFlowchart(lt.id, lt.troopIds, session.simulation.runtimes);
        send(ws, { type: 'flowchart', data: { lieutenantId: lt.id, flowcharts: { [lt.id]: ltFlowchart } } });
      }

      sendLieutenants(session);
      break;
    }

    case 'update_squad_stats': {
      const { squadId, stats } = message.data as {
        squadId: string;
        stats: { combat?: number; speed?: number; courage?: number; discipline?: number };
      };

      if (!session.simulation) {
        send(ws, { type: 'error', data: { message: 'Scenario not initialized' } });
        return;
      }

      const clamp = (v: number) => Math.max(1, Math.min(10, v));

      for (const agent of session.simulation.battle.agents.values()) {
        if (agent.type === 'troop' && (agent as TroopAgent).squadId === squadId) {
          const troop = agent as TroopAgent;
          if (stats.combat !== undefined) troop.stats.combat = clamp(stats.combat);
          if (stats.speed !== undefined) troop.stats.speed = clamp(stats.speed);
          if (stats.courage !== undefined) troop.stats.courage = clamp(stats.courage);
          if (stats.discipline !== undefined) troop.stats.discipline = clamp(stats.discipline);
        }
      }

      // Rebuild and resend troop info
      const troopInfo: Record<string, Array<{
        id: string; squadId: string; position: { x: number; y: number };
        stats: { combat: number; speed: number; courage: number; discipline: number };
      }>> = {};
      for (const lt of session.lieutenants) {
        troopInfo[lt.id] = lt.troopIds.map(tid => {
          const agent = session.simulation!.battle.agents.get(tid) as TroopAgent;
          return { id: agent.id, squadId: agent.squadId, position: agent.position, stats: agent.stats as import('../shared/types/index.js').TroopStats };
        });
      }
      send(ws, { type: 'scenario_ready', data: { troopInfo, mapSize: { width: session.simulation.battle.width, height: session.simulation.battle.height } } });
      break;
    }

    case 'update_flowchart_node': {
      const { lieutenantId, operation, node, nodeId } = message.data as {
        lieutenantId: string;
        operation: 'add' | 'update' | 'delete';
        node?: { id: string; on: string; condition?: string; action: { type: string; [key: string]: unknown }; priority?: number };
        nodeId?: string;
      };

      if (!session.simulation) {
        send(ws, { type: 'error', data: { message: 'Scenario not initialized' } });
        return;
      }

      const ltToUpdate = session.lieutenants.find(l => l.id === lieutenantId);
      if (!ltToUpdate) {
        send(ws, { type: 'error', data: { message: 'Lieutenant not found' } });
        return;
      }

      for (const troopId of ltToUpdate.troopIds) {
        const runtime: FlowchartRuntime | undefined = session.simulation!.runtimes.get(troopId);
        if (!runtime) continue;

        if (operation === 'add' && node) {
          // Use base node id across all troops so deduplication in buildLieutenantFlowchart works
          runtime.flowchart.nodes.push(node as unknown as FlowchartNode);
        } else if (operation === 'update' && node) {
          const idx = runtime.flowchart.nodes.findIndex((n: FlowchartNode) => n.id === node.id);
          if (idx >= 0) {
            runtime.flowchart.nodes[idx] = node as unknown as FlowchartNode;
          }
        } else if (operation === 'delete' && nodeId) {
          runtime.flowchart.nodes = runtime.flowchart.nodes.filter((n: FlowchartNode) => n.id !== nodeId);
        }
      }

      const updatedFlowchart = buildLieutenantFlowchart(ltToUpdate.id, ltToUpdate.troopIds, session.simulation.runtimes);
      send(ws, { type: 'flowchart', data: { lieutenantId: ltToUpdate.id, flowcharts: { [ltToUpdate.id]: updatedFlowchart } } });
      break;
    }
  }
}

// Aggregate per-unit flowcharts into a single lieutenant-level summary flowchart.
// Deduplicates nodes by ID so the player sees one consolidated view of each lieutenant's logic.
function buildLieutenantFlowchart(
  lieutenantId: string,
  troopIds: string[],
  runtimes: Map<string, { flowchart: Flowchart }>
): Flowchart {
  const seenNodeIds = new Set<string>();
  const nodes: FlowchartNode[] = [];

  for (const troopId of troopIds) {
    const runtime = runtimes.get(troopId);
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

// Send current flowcharts for all player lieutenants
function sendAllLieutenantFlowcharts(session: GameSession) {
  if (!session.simulation) return;
  for (const lt of session.lieutenants) {
    const flowchart = buildLieutenantFlowchart(lt.id, lt.troopIds, session.simulation.runtimes);
    send(session.ws, {
      type: 'flowchart',
      data: {
        lieutenantId: lt.id,
        flowcharts: { [lt.id]: flowchart },
      },
    });
  }
}

// Send battle state to the player
function sendBattleState(session: GameSession) {
  if (!session.simulation) return;

  // Show full battlefield (fog of war disabled for clarity)
  const filtered = getFullStateForObserver(session.simulation);

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

// Get full battle state for observer mode (AI vs AI) - no fog of war
function getFullStateForObserver(sim: SimulationState) {
  const agents: Array<{
    id: string; type: string; team: string; position: { x: number; y: number };
    health: number; maxHealth: number; morale: number; currentAction: string | null;
    formation: string; alive: boolean; lieutenantId: string | null;
  }> = [];

  for (const agent of sim.battle.agents.values()) {
    agents.push({
      id: agent.id,
      type: agent.type,
      team: agent.team,
      position: { x: agent.position.x, y: agent.position.y },
      health: agent.health,
      maxHealth: agent.maxHealth,
      morale: agent.morale,
      currentAction: agent.currentAction,
      formation: agent.formation,
      alive: agent.alive,
      lieutenantId: agent.lieutenantId,
    });
  }

  return {
    tick: sim.battle.tick,
    agents,
    width: sim.battle.width,
    height: sim.battle.height,
    running: sim.battle.running,
    winner: sim.battle.winner,
  };
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

  // Aggregate enemy visibility across all of this lieutenant's troops and the
  // lieutenant's own simulation agent (which has a higher visibility radius).
  const visibleEnemies: VisibleEnemyInfo[] = [];
  const seenEnemyIds = new Set<string>();

  if (session.simulation) {
    // Build the list of observers: the lieutenant's own sim agent + their troops
    const observerIds = [lieutenant.id, ...lieutenant.troopIds];

    for (const observerId of observerIds) {
      const observer = session.simulation.battle.agents.get(observerId);
      if (!observer || !observer.alive) continue;

      for (const agent of session.simulation.battle.agents.values()) {
        if (agent.team === observer.team || !agent.alive) continue;
        if (seenEnemyIds.has(agent.id)) continue;

        const dist = distance(observer.position, agent.position);
        if (dist <= observer.visibilityRadius) {
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
    // Apply the compiled flowcharts (including self_directives for the lieutenant)
    const compiled = compileDirectives(result.output, lieutenant.troopIds, lieutenant.id);
    if (session.simulation) {
      applyFlowcharts(compiled, session.simulation.runtimes);

      // Send lieutenant-level flowchart
      const ltFlowchart = buildLieutenantFlowchart(lieutenant.id, lieutenant.troopIds, session.simulation.runtimes);
      send(session.ws, {
        type: 'flowchart',
        data: {
          lieutenantId: lieutenant.id,
          flowcharts: { [lieutenant.id]: ltFlowchart },
        },
      });
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

// Brief lieutenants through an AI commander (works for either team)
async function briefTeamLieutenants(session: GameSession, commander: AICommander, lieutenants: Lieutenant[]) {
  if (!session.anthropicClient || !session.simulation) return;

  // Generate initial orders from AI commander
  const result = await generateCommanderOrders(commander, session.simulation, session.anthropicClient);

  if (result.success && result.orders) {
    for (const commanderOrder of result.orders) {
      const lt = lieutenants.find(l => l.id === commanderOrder.lieutenantId);
      if (lt) {
        const context = buildOrderContext(session, lt);
        const ltResult = await processOrderWithModel(session, lt, commanderOrder.order, context);

        if (ltResult.success && ltResult.output) {
          const compiled = compileDirectives(ltResult.output, lt.troopIds, lt.id);
          applyFlowcharts(compiled, session.simulation!.runtimes);

          // Send updated lieutenant-level flowchart
          const ltFlowchart = buildLieutenantFlowchart(lt.id, lt.troopIds, session.simulation!.runtimes);
          send(session.ws, {
            type: 'flowchart',
            data: {
              lieutenantId: lt.id,
              flowcharts: { [lt.id]: ltFlowchart },
            },
          });
        }
      }
    }
  }

  // Notify the observer
  const teamLabel = commander.team === 'enemy' ? 'Enemy' : 'Player AI';
  send(session.ws, {
    type: 'message',
    data: {
      id: `msg_${Date.now()}_intel_${commander.team}`,
      from: 'intel',
      to: 'commander',
      content: `Intelligence report: ${teamLabel} forces are organizing. Their commander is issuing orders.`,
      timestamp: Date.now(),
      tick: 0,
      type: 'alert',
    },
  });
}

// Run AI commander decision cycle during battle (works for either team)
async function runAICommanderCycle(session: GameSession, commander: AICommander, lieutenants: Lieutenant[]) {
  if (!session.anthropicClient || !session.simulation) return;

  const result = await generateCommanderOrders(commander, session.simulation, session.anthropicClient);

  if (result.success && result.orders) {
    for (const commanderOrder of result.orders) {
      const lt = lieutenants.find(l => l.id === commanderOrder.lieutenantId);
      if (lt && !lt.busy) {
        const context = buildOrderContext(session, lt);
        const ltResult = await processOrderWithModel(session, lt, commanderOrder.order, context);

        if (ltResult.success && ltResult.output) {
          const compiled = compileDirectives(ltResult.output, lt.troopIds, lt.id);
          if (session.simulation) {
            applyFlowcharts(compiled, session.simulation.runtimes);

            // Send updated lieutenant-level flowchart to client
            const ltFlowchart = buildLieutenantFlowchart(lt.id, lt.troopIds, session.simulation.runtimes);
            send(session.ws, {
              type: 'flowchart',
              data: {
                lieutenantId: lt.id,
                flowcharts: { [lt.id]: ltFlowchart },
              },
            });
          }
        }
      }
    }

    // In AI vs AI mode, relay player AI commander messages to the client
    if (commander.team === 'player' && result.orders.length > 0) {
      for (const commanderOrder of result.orders) {
        send(session.ws, {
          type: 'message',
          data: {
            id: `msg_${Date.now()}_ai_cmd_${commanderOrder.lieutenantId}`,
            from: 'player_ai',
            to: commanderOrder.lieutenantId,
            content: commanderOrder.order,
            timestamp: Date.now(),
            tick: session.simulation?.battle.tick ?? 0,
            type: 'order',
          },
        });
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
