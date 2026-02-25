import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { BattlefieldCanvas } from './components/BattlefieldCanvas';
import { MessagePanel } from './components/MessagePanel';
import { FlowchartPanel } from './components/FlowchartPanel';
import { PreBattleScreen } from './components/PreBattleScreen';
import { SetupScreen } from './components/SetupScreen';
import { EndScreen } from './components/EndScreen';
import { LandingScreen } from './components/LandingScreen';
import { InstructionsScreen } from './components/InstructionsScreen';
import { ArmyStrengthHUD } from './components/ArmyStrengthHUD';
import { BattleEventTicker } from './components/BattleEventTicker';
import { useWebSocket } from './hooks/useWebSocket';
import type { BattleState, Lieutenant, Message, Flowchart, DetailedBattleSummary, GameMode, BattleEvent, TroopInfo } from './types';
import './App.css';

type GamePhase = 'landing' | 'instructions' | 'setup' | 'pre-battle' | 'battle' | 'post-battle';

interface Model {
  id: string;
  name: string;
  default?: boolean;
}

// WebSocket URL - use current host in production, wss:// for HTTPS
const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3000/ws'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const emptyBattleState: BattleState = {
  tick: 0,
  agents: [],
  width: 400,
  height: 300,
  running: false,
  winner: null,
};

function App() {
  const [phase, setPhase] = useState<GamePhase>('landing');
  const [battleState, setBattleState] = useState<BattleState>(emptyBattleState);
  const [lieutenants, setLieutenants] = useState<Lieutenant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [flowcharts, setFlowcharts] = useState<Record<string, Flowchart>>({});
  const [selectedLieutenant, setSelectedLieutenant] = useState<string | null>(null);
  const [battleSummary, setBattleSummary] = useState<DetailedBattleSummary | null>(null);
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([]);
  const [speed, setSpeed] = useState(1);

  // Setup state
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [apiKeyValid, setApiKeyValid] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Game mode state
  const [gameMode, setGameMode] = useState<GameMode>('human_vs_ai');
  const [playerPersonality, setPlayerPersonality] = useState<'aggressive' | 'cautious' | 'balanced'>('balanced');
  const [enemyPersonality, setEnemyPersonality] = useState<'aggressive' | 'cautious' | 'balanced'>('balanced');

  // Pre-battle scenario state
  const [troopInfo, setTroopInfo] = useState<Record<string, TroopInfo[]>>({});
  const [scenarioReady, setScenarioReady] = useState(false);

  // Ref to hold send function so handleWSMessage doesn't depend on it
  const sendRef = useRef<(message: unknown) => void>(() => {});
  // Track if we're waiting for battle_ready to auto-start
  const pendingBattleStart = useRef(false);
  // Track game mode for use in callbacks
  const gameModeRef = useRef<GameMode>(gameMode);
  gameModeRef.current = gameMode;
  // Track previous battle state for VFX diffing
  const prevBattleStateRef = useRef<BattleState>(emptyBattleState);

  // Handle WebSocket messages
  const handleWSMessage = useCallback((msg: unknown) => {
    const message = msg as { type: string; data: unknown };

    switch (message.type) {
      case 'connected': {
        const data = message.data as { models: Model[]; selectedModel: string; gameMode?: GameMode };
        setModels(data.models);
        setSelectedModel(data.selectedModel);
        if (data.gameMode) setGameMode(data.gameMode);
        break;
      }

      case 'api_key_valid': {
        setIsValidating(false);
        setApiKeyValid(true);
        setSetupError(null);
        setPhase('pre-battle');
        break;
      }

      case 'error': {
        const data = message.data as { message: string };
        setIsValidating(false);
        setIsInitializing(false);
        setSetupError(data.message);
        break;
      }

      case 'model_set': {
        const data = message.data as { model: string };
        setSelectedModel(data.model);
        break;
      }

      case 'game_mode_set': {
        const data = message.data as { mode: GameMode };
        setGameMode(data.mode);
        break;
      }

      case 'lieutenants': {
        const data = message.data as { lieutenants: Lieutenant[] };
        setLieutenants(data.lieutenants);
        // Auto-select first lieutenant if none selected
        setSelectedLieutenant(prev => {
          if (!prev && data.lieutenants.length > 0) return data.lieutenants[0]!.id;
          return prev;
        });
        break;
      }

      case 'scenario_ready': {
        const data = message.data as {
          troopInfo: Record<string, TroopInfo[]>;
          mapSize: { width: number; height: number };
        };
        setTroopInfo(data.troopInfo);
        setScenarioReady(true);
        break;
      }

      case 'state': {
        const data = message.data as BattleState;
        setBattleState(prev => {
          prevBattleStateRef.current = prev;
          return data;
        });
        break;
      }

      case 'message': {
        const data = message.data as Message;
        setMessages(prev => [...prev, data]);
        break;
      }

      case 'flowchart': {
        const data = message.data as { lieutenantId: string; flowcharts: Record<string, Flowchart> };
        setFlowcharts(prev => ({ ...prev, ...data.flowcharts }));
        break;
      }

      case 'battle_event': {
        const data = message.data as BattleEvent;
        setBattleEvents(prev => [...prev, data]);
        break;
      }

      case 'speed_set': {
        const data = message.data as { speed: number };
        setSpeed(data.speed);
        break;
      }

      case 'battle_ready': {
        setIsInitializing(false);
        // Auto-start battle once briefing is complete
        if (pendingBattleStart.current) {
          pendingBattleStart.current = false;
          sendRef.current({ type: 'start_battle', data: {} });
        }
        break;
      }

      case 'battle_started': {
        const data = message.data as { gameMode?: GameMode };
        if (data?.gameMode) setGameMode(data.gameMode);
        setPhase('battle');
        break;
      }

      case 'battle_paused': {
        setIsPaused(true);
        setBattleState(prev => ({ ...prev, running: false }));
        break;
      }

      case 'battle_end': {
        const data = message.data as { winner: 'player' | 'enemy'; summary: DetailedBattleSummary };
        setBattleState(prev => ({ ...prev, winner: data.winner, running: false }));
        setBattleSummary(data.summary);
        setPhase('post-battle');
        break;
      }

      case 'battle_resumed': {
        setIsPaused(false);
        setBattleState(prev => ({ ...prev, running: true }));
        break;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { status, send } = useWebSocket(WS_URL, handleWSMessage);

  // Keep sendRef in sync so handleWSMessage can call it without a dependency
  sendRef.current = send;

  // Initialize scenario when entering pre-battle phase
  const scenarioInitRef = useRef(false);
  useEffect(() => {
    if (phase === 'pre-battle' && apiKeyValid && !scenarioReady && !scenarioInitRef.current) {
      scenarioInitRef.current = true;
      send({ type: 'init_scenario', data: { scenario: 'basic' } });
    }
  }, [phase, apiKeyValid, scenarioReady, send]);

  // API Key handling
  const handleSetApiKey = useCallback((apiKey: string) => {
    setIsValidating(true);
    setSetupError(null);
    send({ type: 'set_api_key', data: { apiKey } });
  }, [send]);

  const handleSetModel = useCallback((model: string) => {
    send({ type: 'set_model', data: { model } });
  }, [send]);

  const handleGameModeChange = useCallback((mode: GameMode) => {
    setGameMode(mode);
    send({ type: 'set_game_mode', data: { mode } });
  }, [send]);

  // Pre-battle conversational briefing
  const handleSendBrief = useCallback((lieutenantId: string, message: string) => {
    send({ type: 'pre_battle_brief', data: { lieutenantId, message } });
  }, [send]);

  // Battle controls
  const handleStartBattle = useCallback(() => {
    setIsInitializing(true);
    pendingBattleStart.current = true;
    setBattleEvents([]);
    send({
      type: 'init_battle',
      data: {
        gameMode: gameModeRef.current,
        playerPersonality,
        enemyPersonality,
      },
    });
    // start_battle will be sent automatically when battle_ready arrives
  }, [send, playerPersonality, enemyPersonality]);

  const handlePauseBattle = useCallback(() => {
    if (isPaused) {
      send({ type: 'resume_battle', data: {} });
      setIsPaused(false);
      setBattleState(prev => ({ ...prev, running: true }));
    } else {
      send({ type: 'pause_battle', data: {} });
      setIsPaused(true);
    }
  }, [send, isPaused]);

  const handleSetSpeed = useCallback((newSpeed: number) => {
    send({ type: 'set_speed', data: { speed: newSpeed } });
    setSpeed(newSpeed);
  }, [send]);

  const handleSendOrder = useCallback((lieutenantId: string, order: string) => {
    send({ type: 'send_order', data: { lieutenantId, order } });
  }, [send]);

  const handleNewBattle = useCallback(() => {
    setPhase('pre-battle');
    setMessages([]);
    setFlowcharts({});
    setBattleState(emptyBattleState);
    setBattleSummary(null);
    setBattleEvents([]);
    setSpeed(1);
    setTroopInfo({});
    setScenarioReady(false);
    scenarioInitRef.current = false;
  }, []);

  // Compute troop counts per lieutenant
  const troopCounts = useMemo(() => {
    const counts: Record<string, { alive: number; total: number }> = {};
    for (const lt of lieutenants) {
      const ltTroops = battleState.agents.filter(
        a => a.type === 'troop' && a.lieutenantId === lt.id
      );
      counts[lt.id] = {
        alive: ltTroops.filter(a => a.alive).length,
        total: ltTroops.length,
      };
    }
    return counts;
  }, [lieutenants, battleState.agents]);

  // Connection status indicator
  const connectionStatus = status === 'connected' ? '\u{1F7E2}' : status === 'connecting' ? '\u{1F7E1}' : '\u{1F534}';

  const isAiVsAi = gameMode === 'ai_vs_ai';

  return (
    <div className="app">
      <header className={`app-header ${phase === 'landing' || phase === 'instructions' ? 'minimal' : ''}`}>
        <h1 className="header-logo" onClick={() => setPhase('landing')} style={{ cursor: 'pointer' }}>WARCHIEF</h1>
        <div className="header-info">
          {phase !== 'landing' && phase !== 'instructions' && (
            <span className="connection-status" title={status}>
              {connectionStatus}
            </span>
          )}
          {phase === 'battle' && (
            <>
              <span className="tick">Tick: {battleState.tick}</span>
              <span className={`status ${battleState.running ? 'running' : 'paused'}`}>
                {battleState.running ? '\u25CF LIVE' : '\u25CB PAUSED'}
              </span>
              <div className="speed-controls">
                {[0.5, 1, 2].map(s => (
                  <button
                    key={s}
                    className={`speed-btn ${speed === s ? 'active' : ''}`}
                    onClick={() => handleSetSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <button className="pause-button" onClick={handlePauseBattle}>
                {isPaused ? '\u25B6 Resume' : '\u23F8 Pause'}
              </button>
            </>
          )}
          {apiKeyValid && (
            <span className="model-badge">{models.find(m => m.id === selectedModel)?.name || selectedModel}</span>
          )}
          {phase === 'battle' && (
            <span className="vs-badge">
              {isAiVsAi ? 'AI vs AI' : 'vs LLM Commander'}
            </span>
          )}
        </div>
      </header>

      {phase === 'landing' ? (
        <LandingScreen
          onPlay={() => setPhase('setup')}
          onHowToPlay={() => setPhase('instructions')}
        />
      ) : phase === 'instructions' ? (
        <InstructionsScreen
          onBack={() => setPhase('landing')}
          onPlay={() => setPhase('setup')}
        />
      ) : phase === 'setup' ? (
        <SetupScreen
          models={models}
          selectedModel={selectedModel}
          onSetApiKey={handleSetApiKey}
          onSetModel={handleSetModel}
          isValidating={isValidating}
          error={setupError}
        />
      ) : phase === 'pre-battle' ? (
        <PreBattleScreen
          lieutenants={lieutenants.length > 0 ? lieutenants : [
            { id: 'lt_alpha', name: 'Lt. Adaeze', personality: 'aggressive', troopIds: [], busy: false, stats: { initiative: 8, discipline: 5, communication: 7 } },
            { id: 'lt_bravo', name: 'Lt. Chen', personality: 'cautious', troopIds: [], busy: false, stats: { initiative: 5, discipline: 8, communication: 6 } },
            { id: 'lt_charlie', name: 'Lt. Morrison', personality: 'disciplined', troopIds: [], busy: false, stats: { initiative: 6, discipline: 9, communication: 5 } },
          ]}
          onSendBrief={handleSendBrief}
          onStartBattle={handleStartBattle}
          isInitializing={isInitializing}
          messages={messages}
          troopInfo={troopInfo}
          scenarioReady={scenarioReady}
          gameMode={gameMode}
          onGameModeChange={handleGameModeChange}
          playerPersonality={playerPersonality}
          enemyPersonality={enemyPersonality}
          onPlayerPersonalityChange={setPlayerPersonality}
          onEnemyPersonalityChange={setEnemyPersonality}
        />
      ) : phase === 'post-battle' ? (
        <EndScreen
          summary={battleSummary}
          messages={messages}
          onNewBattle={handleNewBattle}
        />
      ) : (
        <main className="battle-layout">
          <div className="left-panel">
            <ArmyStrengthHUD agents={battleState.agents} />
            <BattlefieldCanvas
              battleState={battleState}
              prevBattleState={prevBattleStateRef.current}
              selectedLieutenant={selectedLieutenant}
              lieutenants={lieutenants}
            />
            <BattleEventTicker events={battleEvents} />
          </div>

          <div className="right-panel">
            <div className="lieutenants-bar">
              {lieutenants.map(lt => {
                const hasFlowchart = flowcharts[lt.id] && flowcharts[lt.id]!.nodes.length > 0;
                const counts = troopCounts[lt.id];
                return (
                  <button
                    key={lt.id}
                    className={`lieutenant-tab ${selectedLieutenant === lt.id ? 'selected' : ''} ${lt.busy ? 'busy' : ''}`}
                    onClick={() => setSelectedLieutenant(lt.id)}
                  >
                    <span className="lt-name">{lt.name}</span>
                    <span className={`lt-personality ${lt.personality}`}>{lt.personality}</span>
                    {counts && counts.total > 0 && (
                      <div className="lt-troop-count">
                        <div className="lt-troop-bar">
                          <div
                            className="lt-troop-fill"
                            style={{ width: `${(counts.alive / counts.total) * 100}%` }}
                          />
                        </div>
                        <span className="lt-troop-numbers">{counts.alive}/{counts.total}</span>
                      </div>
                    )}
                    {lt.busy && <span className="lt-busy">...</span>}
                    {hasFlowchart && <span className="lt-flowchart-indicator" title="Has active flowchart">FC</span>}
                  </button>
                );
              })}
            </div>

            <MessagePanel
              messages={messages}
              lieutenants={lieutenants}
              selectedLieutenant={selectedLieutenant}
              onSendOrder={handleSendOrder}
              isObserverMode={isAiVsAi}
            />

            <FlowchartPanel
              flowchart={selectedLieutenant ? flowcharts[selectedLieutenant] : undefined}
              lieutenantName={lieutenants.find(lt => lt.id === selectedLieutenant)?.name}
              activeNodes={battleState.activeNodes}
              selectedLieutenant={selectedLieutenant}
            />
          </div>
        </main>
      )}
    </div>
  );
}

export default App;
