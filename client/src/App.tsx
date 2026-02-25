import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
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
import type { BattleState, Lieutenant, Message, Flowchart, DetailedBattleSummary, GameMode, BattleEvent, TroopInfo } from './types';
import type { Id } from '../../convex/_generated/dataModel';
import './App.css';

type GamePhase = 'landing' | 'instructions' | 'setup' | 'pre-battle' | 'battle' | 'post-battle';

interface Model {
  id: string;
  name: string;
  default?: boolean;
}

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
  const [gameId, setGameId] = useState<Id<"games"> | null>(null);
  const [selectedLieutenant, setSelectedLieutenant] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [apiKeyValid, setApiKeyValid] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  // Game mode state
  const [gameMode, setGameMode] = useState<GameMode>('human_vs_ai');
  const [playerPersonality, setPlayerPersonality] = useState<'aggressive' | 'cautious' | 'balanced'>('balanced');
  const [enemyPersonality, setEnemyPersonality] = useState<'aggressive' | 'cautious' | 'balanced'>('balanced');

  // Pre-battle scenario state
  const [troopInfo, setTroopInfo] = useState<Record<string, TroopInfo[]>>({});
  const [scenarioReady, setScenarioReady] = useState(false);
  const [battleSummary, setBattleSummary] = useState<DetailedBattleSummary | null>(null);

  // Track previous battle state for VFX diffing
  const prevBattleStateRef = useRef<BattleState>(emptyBattleState);

  // ─── Convex Queries (reactive) ──────────────────────────────────────────────

  const gameData = useQuery(api.games.getGame, gameId ? { gameId } : "skip");
  const lieutenantsData = useQuery(api.games.getLieutenants, gameId ? { gameId } : "skip");
  const flowchartsData = useQuery(api.games.getFlowcharts, gameId ? { gameId } : "skip");
  const messagesData = useQuery(api.games.getMessages, gameId ? { gameId } : "skip");
  const battleEventsData = useQuery(api.games.getBattleEvents, gameId ? { gameId } : "skip");

  // ─── Convex Mutations ───────────────────────────────────────────────────────

  const createGameMutation = useMutation(api.games.createGame);
  const setModelMutation = useMutation(api.games.setModel);
  const setGameModeMutation = useMutation(api.games.setGameMode);
  const initScenarioMutation = useMutation(api.games.initScenario);
  const initBattleMutation = useMutation(api.games.initBattle);
  const startBattleMutation = useMutation(api.games.startBattle);
  const pauseBattleMutation = useMutation(api.games.pauseBattle);
  const resumeBattleMutation = useMutation(api.games.resumeBattle);
  const setSpeedMutation = useMutation(api.games.setSpeed);

  // ─── Convex Actions ─────────────────────────────────────────────────────────

  const validateApiKeyAction = useAction(api.llm.validateApiKey);
  const sendBriefAction = useAction(api.llm.sendBrief);
  const sendOrderAction = useAction(api.llm.sendOrder);

  // ─── Derived State ──────────────────────────────────────────────────────────

  const models: Model[] = gameData?.models || [];
  const selectedModel = gameData?.model || '';

  // Convert Convex query data to component-compatible formats
  const battleState: BattleState = useMemo(() => {
    if (!gameData?.clientBattleState) return emptyBattleState;
    const cbs = gameData.clientBattleState;
    return {
      tick: cbs.tick,
      agents: cbs.agents || [],
      width: cbs.width,
      height: cbs.height,
      running: cbs.running,
      winner: cbs.winner,
      visibilityZones: 'visibilityZones' in cbs ? cbs.visibilityZones : undefined,
      activeNodes: gameData.activeNodes,
    };
  }, [gameData?.clientBattleState, gameData?.activeNodes]);

  // Track previous battle state for VFX
  useEffect(() => {
    prevBattleStateRef.current = battleState;
  }, [battleState]);

  const lieutenants: Lieutenant[] = useMemo(() => {
    return (lieutenantsData || []).map(lt => ({
      id: lt.id,
      name: lt.name,
      personality: lt.personality as Lieutenant['personality'],
      troopIds: lt.troopIds,
      busy: lt.busy,
      stats: lt.stats,
    }));
  }, [lieutenantsData]);

  // Auto-select first lieutenant
  useEffect(() => {
    if (!selectedLieutenant && lieutenants.length > 0) {
      setSelectedLieutenant(lieutenants[0]!.id);
    }
  }, [lieutenants, selectedLieutenant]);

  const messages: Message[] = useMemo(() => {
    return (messagesData || []).map(m => ({
      id: m.messageId,
      from: m.from,
      to: m.to,
      content: m.content,
      timestamp: m.timestamp,
      tick: m.tick,
      type: m.messageType as Message['type'],
    }));
  }, [messagesData]);

  const flowcharts: Record<string, Flowchart> = useMemo(() => {
    if (!flowchartsData) return {};
    const result: Record<string, Flowchart> = {};
    for (const [key, value] of Object.entries(flowchartsData)) {
      result[key] = value as Flowchart;
    }
    return result;
  }, [flowchartsData]);

  const battleEvents: BattleEvent[] = useMemo(() => {
    return (battleEventsData || []).map(e => ({
      type: e.eventType as BattleEvent['type'],
      tick: e.tick,
      team: e.team as BattleEvent['team'],
      message: e.message,
      position: e.position,
    }));
  }, [battleEventsData]);

  // Sync phase from server
  useEffect(() => {
    if (gameData?.phase === 'post-battle' && phase === 'battle') {
      // Compute summary from battle state
      const agents = battleState.agents;
      let playerAlive = 0, playerDead = 0, enemyAlive = 0, enemyDead = 0;
      for (const a of agents) {
        if (a.type !== 'troop') continue;
        if (a.team === 'player') {
          if (a.alive) playerAlive++; else playerDead++;
        } else {
          if (a.alive) enemyAlive++; else enemyDead++;
        }
      }
      setBattleSummary({
        tick: battleState.tick,
        durationSeconds: battleState.tick / 10,
        winner: battleState.winner,
        player: { alive: playerAlive, dead: playerDead, total: playerAlive + playerDead },
        enemy: { alive: enemyAlive, dead: enemyDead, total: enemyAlive + enemyDead },
      });
      setPhase('post-battle');
    }
  }, [gameData?.phase, phase, battleState]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSetApiKey = useCallback(async (apiKey: string) => {
    setIsValidating(true);
    setSetupError(null);

    try {
      // Create game if we don't have one yet
      let id = gameId;
      if (!id) {
        id = await createGameMutation();
        setGameId(id);
      }

      await validateApiKeyAction({ gameId: id, apiKey });
      setIsValidating(false);
      setApiKeyValid(true);
      setSetupError(null);
      setPhase('pre-battle');
    } catch (err) {
      setIsValidating(false);
      setSetupError((err as Error).message);
    }
  }, [gameId, createGameMutation, validateApiKeyAction]);

  const handleSetModel = useCallback(async (model: string) => {
    if (gameId) {
      await setModelMutation({ gameId, model });
    }
  }, [gameId, setModelMutation]);

  const handleGameModeChange = useCallback(async (mode: GameMode) => {
    setGameMode(mode);
    if (gameId) {
      await setGameModeMutation({ gameId, mode });
    }
  }, [gameId, setGameModeMutation]);

  // Initialize scenario when entering pre-battle phase
  const scenarioInitRef = useRef(false);
  useEffect(() => {
    if (phase === 'pre-battle' && apiKeyValid && !scenarioReady && !scenarioInitRef.current && gameId) {
      scenarioInitRef.current = true;
      initScenarioMutation({ gameId, scenario: 'basic' }).then((result) => {
        if (result) {
          setTroopInfo(result.troopInfo);
          setScenarioReady(true);
        }
      });
    }
  }, [phase, apiKeyValid, scenarioReady, gameId, initScenarioMutation]);

  const handleSendBrief = useCallback(async (lieutenantId: string, message: string) => {
    if (gameId) {
      // Fire and forget - the action will update state reactively
      sendBriefAction({ gameId, lieutenantId, message });
    }
  }, [gameId, sendBriefAction]);

  const handleStartBattle = useCallback(async () => {
    if (!gameId) return;
    setIsInitializing(true);

    try {
      await initBattleMutation({
        gameId,
        gameMode,
        playerPersonality,
        enemyPersonality,
      });

      await startBattleMutation({ gameId });
      setIsInitializing(false);
      setPhase('battle');
    } catch (err) {
      setIsInitializing(false);
      console.error('Failed to start battle:', err);
    }
  }, [gameId, gameMode, playerPersonality, enemyPersonality, initBattleMutation, startBattleMutation]);

  const handlePauseBattle = useCallback(async () => {
    if (!gameId) return;
    if (isPaused) {
      await resumeBattleMutation({ gameId });
      setIsPaused(false);
    } else {
      await pauseBattleMutation({ gameId });
      setIsPaused(true);
    }
  }, [gameId, isPaused, pauseBattleMutation, resumeBattleMutation]);

  const handleSetSpeed = useCallback(async (newSpeed: number) => {
    if (gameId) {
      await setSpeedMutation({ gameId, speed: newSpeed });
      setSpeed(newSpeed);
    }
  }, [gameId, setSpeedMutation]);

  const handleSendOrder = useCallback(async (lieutenantId: string, order: string) => {
    if (gameId) {
      sendOrderAction({ gameId, lieutenantId, order });
    }
  }, [gameId, sendOrderAction]);

  const handleNewBattle = useCallback(async () => {
    // Create a fresh game
    const id = await createGameMutation();
    setGameId(id);
    setPhase('pre-battle');
    setFlowchartsLocal({});
    setBattleSummary(null);
    setSpeed(1);
    setTroopInfo({});
    setScenarioReady(false);
    scenarioInitRef.current = false;
    setApiKeyValid(false);
    setPhase('setup');
  }, [createGameMutation]);

  // Placeholder for local flowchart state override (to avoid errors)
  const [, setFlowchartsLocal] = useState<Record<string, Flowchart>>({});

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

  // Connection status (Convex is always connected when queries work)
  const connectionStatus = gameData !== undefined ? '\u{1F7E2}' : '\u{1F7E1}';
  const status = gameData !== undefined ? 'connected' : 'connecting';

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
