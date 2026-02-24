// Warchief Server - WebSocket + HTTP server for the game
// Serves frontend and handles real-time battle simulation

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

import { createSimulation, startSimulation, stopSimulation, getBattleSummary, SimulationState, simulationTick } from './sim/simulation.js';
import { createBasicScenario, createAssaultScenario } from './sim/scenario.js';
import { createLieutenant, processOrder, Lieutenant, LLMClient, OrderContext } from './agents/lieutenant.js';
import { VisibleUnitInfo } from './agents/input-builder.js';
import { compileDirectives, applyFlowcharts } from './agents/compiler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;

// Game state per connection
interface GameSession {
  ws: WebSocket;
  apiKey: string | null;
  model: string;
  simulation: SimulationState | null;
  lieutenants: Lieutenant[];
  timer: NodeJS.Timeout | null;
  anthropicClient: LLMClient | null;
}

const sessions = new Map<WebSocket, GameSession>();

// Available models
const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', default: true },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (faster)' },
];

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
    timer: null,
    anthropicClient: null,
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
      
      // Create simulation
      session.simulation = createSimulation(
        scenarioData.width,
        scenarioData.height,
        scenarioData.agents,
        scenarioData.flowcharts
      );
      
      // Create lieutenants
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
      
      // Process initial briefings if API key is set
      if (session.apiKey && session.anthropicClient) {
        for (const lt of session.lieutenants) {
          const briefing = briefings[lt.id];
          if (briefing) {
            await processInitialBriefing(session, lt, briefing);
          }
        }
      }
      
      // Send initial state
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
          
          // Send state every 5 ticks
          if (session.simulation.battle.tick % 5 === 0) {
            sendBattleState(session);
          }
          
          // Check for battle end
          if (session.simulation.battle.winner) {
            if (session.timer) clearInterval(session.timer);
            send(ws, { 
              type: 'battle_end', 
              data: { 
                winner: session.simulation.battle.winner,
                summary: getBattleSummary(session.simulation),
              } 
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
            type: 'alert',
          },
        });
      }
      
      sendLieutenants(session);
      break;
    }
  }
}

function sendBattleState(session: GameSession) {
  if (!session.simulation) return;
  
  const { battle } = session.simulation;
  
  send(session.ws, {
    type: 'state',
    data: {
      tick: battle.tick,
      agents: Array.from(battle.agents.values()).map(a => ({
        id: a.id,
        type: a.type,
        team: a.team,
        position: a.position,
        health: a.health,
        maxHealth: a.maxHealth,
        morale: a.morale,
        currentAction: a.currentAction,
        formation: a.formation,
        alive: a.alive,
      })),
      width: battle.width,
      height: battle.height,
      running: battle.running,
      winner: battle.winner,
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
  
  return {
    currentOrders: '',
    visibleUnits,
    terrain: 'Open battlefield with ridge formations',
  };
}

async function processInitialBriefing(session: GameSession, lieutenant: Lieutenant, briefing: string) {
  if (!session.anthropicClient) return;
  
  const context = buildOrderContext(session, lieutenant);
  await processOrderWithModel(session, lieutenant, briefing, context);
}

async function processOrderWithModel(
  session: GameSession,
  lieutenant: Lieutenant,
  order: string,
  context: OrderContext
) {
  // Create a client with the user's API key and selected model
  const client = session.anthropicClient;
  if (!client) throw new Error('No API client');
  
  // Override the model in the processOrder call
  const originalCreate = client.messages.create.bind(client.messages);
  client.messages.create = async (params: Parameters<typeof originalCreate>[0]) => {
    return originalCreate({ ...params, model: session.model });
  };
  
  return processOrder(lieutenant, order, context, client);
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
║   ⚔️  WARCHIEF SERVER                                         ║
║                                                               ║
║   http://localhost:${PORT}                                      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
