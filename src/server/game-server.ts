// Warchief Game Server — PartyKit implementation
// Each PartyKit room is one game session. Replaces the Express+ws server.

import type * as Party from 'partykit/server';
import Anthropic from '@anthropic-ai/sdk';

import { createSimulation, simulationTick, getFilteredStateForTeam, getDetailedBattleSummary, SimulationState, distance, BattleEvent } from './sim/simulation.js';
import { createBasicScenario, createAssaultScenario } from './sim/scenario.js';
import { createLieutenant, processOrder, Lieutenant, LLMClient, OrderContext } from './agents/lieutenant.js';
import { VisibleUnitInfo, VisibleEnemyInfo } from './agents/input-builder.js';
import { compileDirectives, applyFlowcharts } from './agents/compiler.js';
import { createAICommander, generateCommanderOrders, AICommander } from './agents/ai-commander.js';
import { Flowchart, FlowchartNode, createPersonalityFlowchart } from './runtime/flowchart.js';
import { type TroopAgent, type TroopStats } from '../shared/types/index.js';

export type GameMode = 'human_vs_ai' | 'ai_vs_ai';

// Available models
const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', default: true },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (faster)' },
];

// AI Commander order interval (every N ticks)
const AI_COMMANDER_INTERVAL = 50; // Every 5 seconds

export default class GameServer implements Party.Server {
  // --- Game state (replaces GameSession) ---
  apiKey: string | null = null;
  model: string = AVAILABLE_MODELS.find(m => m.default)?.id || AVAILABLE_MODELS[0]!.id;
  simulation: SimulationState | null = null;
  lieutenants: Lieutenant[] = [];
  enemyLieutenants: Lieutenant[] = [];
  aiCommander: AICommander | null = null;
  playerAICommander: AICommander | null = null;
  gameMode: GameMode = 'human_vs_ai';
  anthropicClient: LLMClient | null = null;
  aiCommanderInterval: number = AI_COMMANDER_INTERVAL;
  speed: number = 1;
  timer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {}

  // --- PartyKit lifecycle ---

  onConnect(conn: Party.Connection, _ctx: Party.ConnectionContext) {
    // Send initial state to the newly connected client
    this.sendTo(conn, {
      type: 'connected',
      data: {
        models: AVAILABLE_MODELS,
        selectedModel: this.model,
        needsApiKey: !this.apiKey,
        gameMode: this.gameMode,
      },
    });

    // If a battle is already in progress, sync state to the new connection
    if (this.simulation) {
      this.sendLieutenantsTo(conn);
      this.sendAllLieutenantFlowchartsTo(conn);
      this.sendBattleStateTo(conn);
    }
  }

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const parsed = JSON.parse(message);
      await this.handleMessage(sender, parsed);
    } catch (err) {
      this.sendTo(sender, { type: 'error', data: { message: (err as Error).message } });
    }
  }

  onClose(_conn: Party.Connection) {
    // If no more connections, stop the battle loop to save resources
    const connections = [...this.room.getConnections()];
    if (connections.length === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      if (this.simulation) {
        this.simulation.battle.running = false;
      }
    }
  }

  // Handle HTTP requests (health check, model list)
  async onRequest(req: Party.Request) {
    const url = new URL(req.url);

    if (url.pathname.endsWith('/health')) {
      return new Response(JSON.stringify({ status: 'ok', room: this.room.id }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname.endsWith('/models')) {
      return new Response(JSON.stringify({ models: AVAILABLE_MODELS }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // --- Messaging helpers ---

  private sendTo(conn: Party.Connection, msg: unknown) {
    conn.send(JSON.stringify(msg));
  }

  private broadcast(msg: unknown, exclude?: string[]) {
    this.room.broadcast(JSON.stringify(msg), exclude);
  }

  // --- Battle interval ---

  private createBattleInterval(): ReturnType<typeof setInterval> {
    const intervalMs = Math.round(100 / this.speed);

    return setInterval(() => {
      if (!this.simulation || !this.simulation.battle.running) return;

      simulationTick(this.simulation);

      // Drain and broadcast battle events
      if (this.simulation.pendingBattleEvents.length > 0) {
        const events = this.simulation.pendingBattleEvents.splice(0);
        for (const evt of events) {
          this.broadcast({ type: 'battle_event', data: evt });
        }
      }

      // Send state every 5 ticks (visibility-filtered)
      if (this.simulation.battle.tick % 5 === 0) {
        this.broadcastBattleState();
      }

      // AI Commander decision cycle (non-blocking)
      if (
        this.aiCommander &&
        !this.aiCommander.busy &&
        this.simulation.battle.tick % this.aiCommanderInterval === 0 &&
        this.simulation.battle.tick > 0
      ) {
        this.runAICommanderCycle(this.aiCommander, this.enemyLieutenants).catch(err => {
          console.error('Enemy AI Commander error:', err);
        });
      }

      // Player AI Commander cycle (ai_vs_ai mode)
      if (
        this.playerAICommander &&
        !this.playerAICommander.busy &&
        this.simulation.battle.tick % this.aiCommanderInterval === 0 &&
        this.simulation.battle.tick > 0
      ) {
        this.runAICommanderCycle(this.playerAICommander, this.lieutenants).catch(err => {
          console.error('Player AI Commander error:', err);
        });
      }

      // Check for battle end
      if (this.simulation.battle.winner) {
        if (this.timer) clearInterval(this.timer);

        const summary = getDetailedBattleSummary(this.simulation);
        this.broadcast({
          type: 'battle_end',
          data: { winner: summary.winner, summary },
        });
      }
    }, intervalMs);
  }

  // --- Message handler ---

  private async handleMessage(sender: Party.Connection, message: { type: string; data?: unknown }) {
    switch (message.type) {
      case 'set_api_key': {
        const { apiKey } = message.data as { apiKey: string };

        if (!apiKey || !apiKey.startsWith('sk-')) {
          this.sendTo(sender, { type: 'error', data: { message: 'Invalid API key format' } });
          return;
        }

        try {
          const client = new Anthropic({ apiKey });
          await client.messages.create({
            model: this.model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          });

          this.apiKey = apiKey;
          this.anthropicClient = client as unknown as LLMClient;

          this.sendTo(sender, { type: 'api_key_valid', data: { valid: true } });
        } catch (err) {
          this.sendTo(sender, { type: 'error', data: { message: 'Invalid API key: ' + (err as Error).message } });
        }
        break;
      }

      case 'set_model': {
        const { model } = message.data as { model: string };
        if (AVAILABLE_MODELS.find(m => m.id === model)) {
          this.model = model;
          this.broadcast({ type: 'model_set', data: { model } });
        }
        break;
      }

      case 'set_game_mode': {
        const { mode } = message.data as { mode: GameMode };
        if (mode === 'human_vs_ai' || mode === 'ai_vs_ai') {
          this.gameMode = mode;
          this.broadcast({ type: 'game_mode_set', data: { mode } });
        }
        break;
      }

      case 'init_scenario': {
        const { scenario, gameMode, playerPersonality, enemyPersonality } = message.data as {
          scenario?: 'basic' | 'assault';
          gameMode?: GameMode;
          playerPersonality?: 'aggressive' | 'cautious' | 'balanced';
          enemyPersonality?: 'aggressive' | 'cautious' | 'balanced';
        };

        if (gameMode) {
          this.gameMode = gameMode;
        }

        const scenarioData = (scenario || 'basic') === 'assault' ? createAssaultScenario() : createBasicScenario();

        this.simulation = createSimulation(
          scenarioData.width,
          scenarioData.height,
          scenarioData.agents,
          scenarioData.flowcharts,
          {
            onTroopMessage: (agentId, type, msg) => {
              const agent = this.simulation?.battle.agents.get(agentId);
              if (!agent) return;
              const lt = this.lieutenants.find(l => l.troopIds.includes(agentId))
                || this.enemyLieutenants.find(l => l.troopIds.includes(agentId));

              if (agent.team === 'player') {
                this.broadcast({
                  type: 'message',
                  data: {
                    id: `msg_${Date.now()}_${agentId}`,
                    from: lt?.id || agentId,
                    to: 'commander',
                    content: `[${agentId}] ${msg}`,
                    timestamp: Date.now(),
                    tick: this.simulation?.battle.tick ?? 0,
                    type: type === 'alert' ? 'alert' : 'report',
                  },
                });
              }
            },
          }
        );

        // Create player lieutenants
        this.lieutenants = [
          createLieutenant({
            id: 'lt_alpha',
            name: 'Lt. Adaeze',
            personality: 'aggressive',
            stats: { initiative: 8, discipline: 5, communication: 7 },
            troopIds: Array.from(this.simulation.battle.agents.keys()).filter(id => id.startsWith('p_s1')),
            authorizedPeers: ['lt_bravo'],
          }),
          createLieutenant({
            id: 'lt_bravo',
            name: 'Lt. Chen',
            personality: 'cautious',
            stats: { initiative: 5, discipline: 8, communication: 6 },
            troopIds: Array.from(this.simulation.battle.agents.keys()).filter(id => id.startsWith('p_s2')),
            authorizedPeers: ['lt_alpha', 'lt_charlie'],
          }),
          createLieutenant({
            id: 'lt_charlie',
            name: 'Lt. Morrison',
            personality: 'disciplined',
            stats: { initiative: 6, discipline: 9, communication: 5 },
            troopIds: Array.from(this.simulation.battle.agents.keys()).filter(id => id.startsWith('p_s3')),
            authorizedPeers: ['lt_bravo'],
          }),
        ];

        // Create enemy lieutenants (LLM-powered)
        this.enemyLieutenants = [
          createLieutenant({
            id: 'lt_enemy_1',
            name: 'Lt. Volkov',
            personality: 'aggressive',
            stats: { initiative: 7, discipline: 6, communication: 5 },
            troopIds: Array.from(this.simulation.battle.agents.keys()).filter(id => id.startsWith('e_s1') || id.startsWith('e_s2')),
            authorizedPeers: ['lt_enemy_2'],
          }),
          createLieutenant({
            id: 'lt_enemy_2',
            name: 'Lt. Kira',
            personality: 'cautious',
            stats: { initiative: 5, discipline: 8, communication: 7 },
            troopIds: Array.from(this.simulation.battle.agents.keys()).filter(id => id.startsWith('e_s3')),
            authorizedPeers: ['lt_enemy_1'],
          }),
        ];

        // Apply personality-based default flowcharts for player troops
        const enemyCenter = { x: scenarioData.width - 50, y: scenarioData.height / 2 };
        for (const lt of this.lieutenants) {
          for (const troopId of lt.troopIds) {
            const runtime = this.simulation.runtimes.get(troopId);
            if (runtime) {
              runtime.flowchart = createPersonalityFlowchart(troopId, lt.personality, enemyCenter);
            }
          }
        }

        // Build troop info for each lieutenant
        const troopInfo: Record<string, Array<{
          id: string; squadId: string; position: { x: number; y: number };
          stats: { combat: number; speed: number; courage: number; discipline: number };
        }>> = {};

        for (const lt of this.lieutenants) {
          troopInfo[lt.id] = lt.troopIds.map(tid => {
            const agent = this.simulation!.battle.agents.get(tid) as TroopAgent;
            return {
              id: agent.id,
              squadId: agent.squadId,
              position: { x: agent.position.x, y: agent.position.y },
              stats: agent.stats as TroopStats,
            };
          });
        }

        this.broadcastLieutenants();
        this.broadcastAllLieutenantFlowcharts();

        this.broadcast({
          type: 'scenario_ready',
          data: {
            troopInfo,
            mapSize: { width: scenarioData.width, height: scenarioData.height },
          },
        });
        break;
      }

      case 'pre_battle_brief': {
        const { lieutenantId, message: briefMessage } = message.data as {
          lieutenantId: string;
          message: string;
        };

        if (!this.apiKey || !this.anthropicClient) {
          this.sendTo(sender, { type: 'error', data: { message: 'API key not set' } });
          return;
        }

        if (!this.simulation) {
          this.sendTo(sender, { type: 'error', data: { message: 'Scenario not initialized. Call init_scenario first.' } });
          return;
        }

        const briefLt = this.lieutenants.find(lt => lt.id === lieutenantId);
        if (!briefLt) {
          this.sendTo(sender, { type: 'error', data: { message: 'Lieutenant not found' } });
          return;
        }

        if (briefLt.busy) {
          this.sendTo(sender, { type: 'error', data: { message: `${briefLt.name} is still processing your previous message.` } });
          return;
        }

        briefLt.busy = true;
        this.broadcastLieutenants();

        // Echo the player's message
        this.broadcast({
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
          const context = this.buildOrderContext(briefLt);
          const result = await this.processOrderWithModel(briefLt, briefMessage, context);

          briefLt.busy = false;

          if (result.success && result.output) {
            const compiled = compileDirectives(result.output, briefLt.troopIds);
            applyFlowcharts(compiled, this.simulation!.runtimes);

            const ltFlowchart = this.buildLieutenantFlowchart(briefLt.id, briefLt.troopIds);
            this.broadcast({
              type: 'flowchart',
              data: {
                lieutenantId: briefLt.id,
                flowcharts: { [briefLt.id]: ltFlowchart },
              },
            });

            this.broadcast({
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
            this.broadcast({
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
          this.broadcast({
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

        this.broadcastLieutenants();
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
          this.gameMode = gameMode;
        }

        // If scenario not yet initialized (legacy flow or AI vs AI), do it now
        if (!this.simulation) {
          const scenarioData = createBasicScenario();

          this.simulation = createSimulation(
            scenarioData.width,
            scenarioData.height,
            scenarioData.agents,
            scenarioData.flowcharts,
            {
              onTroopMessage: (agentId, type, msg) => {
                const agent = this.simulation?.battle.agents.get(agentId);
                if (!agent) return;
                const lt = this.lieutenants.find(l => l.troopIds.includes(agentId))
                  || this.enemyLieutenants.find(l => l.troopIds.includes(agentId));

                if (agent.team === 'player') {
                  this.broadcast({
                    type: 'message',
                    data: {
                      id: `msg_${Date.now()}_${agentId}`,
                      from: lt?.id || agentId,
                      to: 'commander',
                      content: `[${agentId}] ${msg}`,
                      timestamp: Date.now(),
                      tick: this.simulation?.battle.tick ?? 0,
                      type: type === 'alert' ? 'alert' : 'report',
                    },
                  });
                }
              },
            }
          );

          this.lieutenants = [
            createLieutenant({
              id: 'lt_alpha',
              name: 'Lt. Adaeze',
              personality: 'aggressive',
              stats: { initiative: 8, discipline: 5, communication: 7 },
              troopIds: Array.from(this.simulation.battle.agents.keys()).filter(id => id.startsWith('p_s1')),
              authorizedPeers: ['lt_bravo'],
            }),
            createLieutenant({
              id: 'lt_bravo',
              name: 'Lt. Chen',
              personality: 'cautious',
              stats: { initiative: 5, discipline: 8, communication: 6 },
              troopIds: Array.from(this.simulation.battle.agents.keys()).filter(id => id.startsWith('p_s2')),
              authorizedPeers: ['lt_alpha', 'lt_charlie'],
            }),
            createLieutenant({
              id: 'lt_charlie',
              name: 'Lt. Morrison',
              personality: 'disciplined',
              stats: { initiative: 6, discipline: 9, communication: 5 },
              troopIds: Array.from(this.simulation.battle.agents.keys()).filter(id => id.startsWith('p_s3')),
              authorizedPeers: ['lt_bravo'],
            }),
          ];

          this.enemyLieutenants = [
            createLieutenant({
              id: 'lt_enemy_1',
              name: 'Lt. Volkov',
              personality: 'aggressive',
              stats: { initiative: 7, discipline: 6, communication: 5 },
              troopIds: Array.from(this.simulation.battle.agents.keys()).filter(id => id.startsWith('e_s1') || id.startsWith('e_s2')),
              authorizedPeers: ['lt_enemy_2'],
            }),
            createLieutenant({
              id: 'lt_enemy_2',
              name: 'Lt. Kira',
              personality: 'cautious',
              stats: { initiative: 5, discipline: 8, communication: 7 },
              troopIds: Array.from(this.simulation.battle.agents.keys()).filter(id => id.startsWith('e_s3')),
              authorizedPeers: ['lt_enemy_1'],
            }),
          ];

          // Apply personality-based default flowcharts
          const enemyCenter = { x: 350, y: 150 };
          for (const lt of this.lieutenants) {
            for (const troopId of lt.troopIds) {
              const runtime = this.simulation.runtimes.get(troopId);
              if (runtime) {
                runtime.flowchart = createPersonalityFlowchart(troopId, lt.personality, enemyCenter);
              }
            }
          }
        }

        // Create AI commander for enemy
        this.aiCommander = createAICommander({
          personality: enemyPersonality || 'balanced',
          lieutenantIds: this.enemyLieutenants.map(lt => lt.id),
          model: this.model,
          team: 'enemy',
          name: 'Enemy Commander',
        });

        // Create player AI commander if in ai_vs_ai mode
        if (this.gameMode === 'ai_vs_ai') {
          this.playerAICommander = createAICommander({
            personality: playerPersonality || 'balanced',
            lieutenantIds: this.lieutenants.map(lt => lt.id),
            model: this.model,
            team: 'player',
            name: 'Player Commander',
          });
        } else {
          this.playerAICommander = null;
        }

        // Process AI briefings
        if (this.apiKey && this.anthropicClient) {
          const briefingPromises: Promise<void>[] = [];

          if (this.gameMode === 'ai_vs_ai' && this.playerAICommander) {
            briefingPromises.push(this.briefTeamLieutenants(this.playerAICommander, this.lieutenants));
          } else if (briefings) {
            for (const lt of this.lieutenants) {
              const briefing = briefings[lt.id];
              if (briefing) {
                briefingPromises.push(this.processInitialBriefing(lt, briefing));
              }
            }
          }

          briefingPromises.push(this.briefTeamLieutenants(this.aiCommander, this.enemyLieutenants));

          await Promise.all(briefingPromises);
        }

        this.broadcastBattleState();
        this.broadcastLieutenants();
        this.broadcastAllLieutenantFlowcharts();

        this.broadcast({ type: 'battle_ready', data: { gameMode: this.gameMode } });
        break;
      }

      case 'start_battle': {
        if (!this.simulation) {
          this.sendTo(sender, { type: 'error', data: { message: 'No battle initialized' } });
          return;
        }

        this.simulation.battle.running = true;
        this.timer = this.createBattleInterval();

        this.broadcast({ type: 'battle_started', data: { gameMode: this.gameMode } });
        break;
      }

      case 'pause_battle': {
        if (this.simulation) {
          this.simulation.battle.running = false;
          if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
          }
          this.broadcast({ type: 'battle_paused', data: {} });
        }
        break;
      }

      case 'resume_battle': {
        if (this.simulation && !this.simulation.battle.running) {
          this.simulation.battle.running = true;
          this.timer = this.createBattleInterval();
          this.broadcast({ type: 'battle_resumed', data: {} });
        }
        break;
      }

      case 'send_order': {
        const { lieutenantId, order } = message.data as { lieutenantId: string; order: string };

        if (this.gameMode === 'ai_vs_ai') {
          this.sendTo(sender, { type: 'error', data: { message: 'Cannot send manual orders in AI vs AI mode' } });
          return;
        }

        if (!this.apiKey || !this.anthropicClient) {
          this.sendTo(sender, { type: 'error', data: { message: 'API key not set' } });
          return;
        }

        const lieutenant = this.lieutenants.find(lt => lt.id === lieutenantId);
        if (!lieutenant) {
          this.sendTo(sender, { type: 'error', data: { message: 'Lieutenant not found' } });
          return;
        }

        lieutenant.busy = true;
        this.broadcastLieutenants();

        // Broadcast the order message
        this.broadcast({
          type: 'message',
          data: {
            id: `msg_${Date.now()}`,
            from: 'commander',
            to: lieutenantId,
            content: order,
            timestamp: Date.now(),
            tick: this.simulation?.battle.tick ?? 0,
            type: 'order',
          },
        });

        try {
          const context = this.buildOrderContext(lieutenant);
          const result = await this.processOrderWithModel(lieutenant, order, context);

          lieutenant.busy = false;

          if (result.success && result.output) {
            this.broadcast({
              type: 'message',
              data: {
                id: `msg_${Date.now()}`,
                from: lieutenantId,
                to: 'commander',
                content: result.output.message_up || 'Understood.',
                timestamp: Date.now(),
                tick: this.simulation?.battle.tick ?? 0,
                type: 'report',
              },
            });

            const compiled = compileDirectives(result.output, lieutenant.troopIds);
            if (this.simulation) {
              applyFlowcharts(compiled, this.simulation.runtimes);

              const ltFlowchart = this.buildLieutenantFlowchart(lieutenantId, lieutenant.troopIds);
              this.broadcast({
                type: 'flowchart',
                data: {
                  lieutenantId,
                  flowcharts: { [lieutenantId]: ltFlowchart },
                },
              });
            }
          } else {
            this.broadcast({
              type: 'message',
              data: {
                id: `msg_${Date.now()}`,
                from: lieutenantId,
                to: 'commander',
                content: `Error processing order: ${result.error}`,
                timestamp: Date.now(),
                tick: this.simulation?.battle.tick ?? 0,
                type: 'alert',
              },
            });
          }
        } catch (err) {
          lieutenant.busy = false;
          this.broadcast({
            type: 'message',
            data: {
              id: `msg_${Date.now()}`,
              from: lieutenantId,
              to: 'commander',
              content: `Error: ${(err as Error).message}`,
              timestamp: Date.now(),
              tick: this.simulation?.battle.tick ?? 0,
              type: 'alert',
            },
          });
        }

        this.broadcastLieutenants();
        break;
      }

      case 'set_speed': {
        const { speed } = message.data as { speed: number };
        if ([0.5, 1, 2].includes(speed)) {
          this.speed = speed;
          this.broadcast({ type: 'speed_set', data: { speed } });

          // Restart the interval with new speed if battle is running
          if (this.timer && this.simulation?.battle.running) {
            clearInterval(this.timer);
            this.timer = this.createBattleInterval();
          }
        }
        break;
      }
    }
  }

  // --- State broadcasting ---

  private buildLieutenantFlowchart(lieutenantId: string, troopIds: string[]): Flowchart {
    const seenNodeIds = new Set<string>();
    const nodes: FlowchartNode[] = [];

    for (const troopId of troopIds) {
      const runtime = this.simulation?.runtimes.get(troopId);
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

  private broadcastAllLieutenantFlowcharts() {
    if (!this.simulation) return;
    for (const lt of this.lieutenants) {
      const flowchart = this.buildLieutenantFlowchart(lt.id, lt.troopIds);
      this.broadcast({
        type: 'flowchart',
        data: {
          lieutenantId: lt.id,
          flowcharts: { [lt.id]: flowchart },
        },
      });
    }
  }

  private sendAllLieutenantFlowchartsTo(conn: Party.Connection) {
    if (!this.simulation) return;
    for (const lt of this.lieutenants) {
      const flowchart = this.buildLieutenantFlowchart(lt.id, lt.troopIds);
      this.sendTo(conn, {
        type: 'flowchart',
        data: {
          lieutenantId: lt.id,
          flowcharts: { [lt.id]: flowchart },
        },
      });
    }
  }

  private broadcastBattleState() {
    if (!this.simulation) return;

    const filtered = this.gameMode === 'ai_vs_ai'
      ? this.getFullStateForObserver()
      : getFilteredStateForTeam(this.simulation, 'player');

    const activeNodes: Record<string, string | null> = {};
    for (const [agentId, runtime] of this.simulation.runtimes) {
      activeNodes[agentId] = runtime.currentNodeId;
    }

    this.broadcast({
      type: 'state',
      data: {
        ...filtered,
        activeNodes,
      },
    });
  }

  private sendBattleStateTo(conn: Party.Connection) {
    if (!this.simulation) return;

    const filtered = this.gameMode === 'ai_vs_ai'
      ? this.getFullStateForObserver()
      : getFilteredStateForTeam(this.simulation, 'player');

    const activeNodes: Record<string, string | null> = {};
    for (const [agentId, runtime] of this.simulation.runtimes) {
      activeNodes[agentId] = runtime.currentNodeId;
    }

    this.sendTo(conn, {
      type: 'state',
      data: {
        ...filtered,
        activeNodes,
      },
    });
  }

  private getFullStateForObserver() {
    if (!this.simulation) return null;

    const agents: Array<{
      id: string; type: string; team: string; position: { x: number; y: number };
      health: number; maxHealth: number; morale: number; currentAction: string | null;
      formation: string; alive: boolean; lieutenantId: string | null;
    }> = [];

    for (const agent of this.simulation.battle.agents.values()) {
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
      tick: this.simulation.battle.tick,
      agents,
      width: this.simulation.battle.width,
      height: this.simulation.battle.height,
      running: this.simulation.battle.running,
      winner: this.simulation.battle.winner,
    };
  }

  private broadcastLieutenants() {
    this.broadcast({
      type: 'lieutenants',
      data: {
        lieutenants: this.lieutenants.map(lt => ({
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

  private sendLieutenantsTo(conn: Party.Connection) {
    this.sendTo(conn, {
      type: 'lieutenants',
      data: {
        lieutenants: this.lieutenants.map(lt => ({
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

  // --- LLM helpers ---

  private buildOrderContext(lieutenant: Lieutenant): OrderContext {
    const visibleUnits: VisibleUnitInfo[] = lieutenant.troopIds
      .map(id => this.simulation?.battle.agents.get(id))
      .filter((a): a is NonNullable<typeof a> => a !== undefined && a.alive)
      .map(a => ({
        id: a.id,
        position: { x: a.position.x, y: a.position.y },
        health: a.health,
        morale: a.morale,
      }));

    const visibleEnemies: VisibleEnemyInfo[] = [];
    const seenEnemyIds = new Set<string>();

    if (this.simulation) {
      for (const troopId of lieutenant.troopIds) {
        const troop = this.simulation.battle.agents.get(troopId);
        if (!troop || !troop.alive) continue;

        for (const agent of this.simulation.battle.agents.values()) {
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

  private async processOrderWithModel(lieutenant: Lieutenant, order: string, context: OrderContext) {
    const client = this.anthropicClient;
    if (!client) throw new Error('No API client');

    const originalCreate = client.messages.create.bind(client.messages);
    client.messages.create = async (params: Parameters<typeof originalCreate>[0]) => {
      return originalCreate({ ...params, model: this.model });
    };

    return processOrder(lieutenant, order, context, client);
  }

  private async processInitialBriefing(lieutenant: Lieutenant, briefing: string) {
    if (!this.anthropicClient) return;

    const context = this.buildOrderContext(lieutenant);
    const result = await this.processOrderWithModel(lieutenant, briefing, context);

    if (result.success && result.output) {
      const compiled = compileDirectives(result.output, lieutenant.troopIds);
      if (this.simulation) {
        applyFlowcharts(compiled, this.simulation.runtimes);

        const ltFlowchart = this.buildLieutenantFlowchart(lieutenant.id, lieutenant.troopIds);
        this.broadcast({
          type: 'flowchart',
          data: {
            lieutenantId: lieutenant.id,
            flowcharts: { [lieutenant.id]: ltFlowchart },
          },
        });
      }

      this.broadcast({
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

  private async briefTeamLieutenants(commander: AICommander, lieutenants: Lieutenant[]) {
    if (!this.anthropicClient || !this.simulation) return;

    const result = await generateCommanderOrders(commander, this.simulation, this.anthropicClient);

    if (result.success && result.orders) {
      for (const commanderOrder of result.orders) {
        const lt = lieutenants.find(l => l.id === commanderOrder.lieutenantId);
        if (lt) {
          const context = this.buildOrderContext(lt);
          const ltResult = await this.processOrderWithModel(lt, commanderOrder.order, context);

          if (ltResult.success && ltResult.output) {
            const compiled = compileDirectives(ltResult.output, lt.troopIds);
            applyFlowcharts(compiled, this.simulation!.runtimes);

            const ltFlowchart = this.buildLieutenantFlowchart(lt.id, lt.troopIds);
            this.broadcast({
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

    const teamLabel = commander.team === 'enemy' ? 'Enemy' : 'Player AI';
    this.broadcast({
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

  private async runAICommanderCycle(commander: AICommander, lieutenants: Lieutenant[]) {
    if (!this.anthropicClient || !this.simulation) return;

    const result = await generateCommanderOrders(commander, this.simulation, this.anthropicClient);

    if (result.success && result.orders) {
      for (const commanderOrder of result.orders) {
        const lt = lieutenants.find(l => l.id === commanderOrder.lieutenantId);
        if (lt && !lt.busy) {
          const context = this.buildOrderContext(lt);
          const ltResult = await this.processOrderWithModel(lt, commanderOrder.order, context);

          if (ltResult.success && ltResult.output) {
            const compiled = compileDirectives(ltResult.output, lt.troopIds);
            if (this.simulation) {
              applyFlowcharts(compiled, this.simulation.runtimes);

              const ltFlowchart = this.buildLieutenantFlowchart(lt.id, lt.troopIds);
              this.broadcast({
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

      // In AI vs AI mode, relay player AI commander messages
      if (commander.team === 'player' && result.orders.length > 0) {
        for (const commanderOrder of result.orders) {
          this.broadcast({
            type: 'message',
            data: {
              id: `msg_${Date.now()}_ai_cmd_${commanderOrder.lieutenantId}`,
              from: 'player_ai',
              to: commanderOrder.lieutenantId,
              content: commanderOrder.order,
              timestamp: Date.now(),
              tick: this.simulation?.battle.tick ?? 0,
              type: 'order',
            },
          });
        }
      }
    }
  }
}

// PartyKit requires a default export that satisfies Party.Worker
GameServer satisfies Party.Worker;
