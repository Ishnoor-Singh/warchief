import { useState, useCallback } from 'react';
import { BattlefieldCanvas } from './components/BattlefieldCanvas';
import { MessagePanel } from './components/MessagePanel';
import { FlowchartPanel } from './components/FlowchartPanel';
import { PreBattleScreen } from './components/PreBattleScreen';
import { SetupScreen } from './components/SetupScreen';
import { useWebSocket } from './hooks/useWebSocket';
import type { BattleState, Lieutenant, Message, Flowchart } from './types';
import './App.css';

type GamePhase = 'setup' | 'pre-battle' | 'battle' | 'post-battle';

interface Model {
  id: string;
  name: string;
  default?: boolean;
}

// WebSocket URL - use current host in production
const WS_URL = import.meta.env.DEV 
  ? 'ws://localhost:3000/ws' 
  : `ws://${window.location.host}/ws`;

const emptyBattleState: BattleState = {
  tick: 0,
  agents: [],
  width: 400,
  height: 300,
  running: false,
  winner: null,
};

function App() {
  const [phase, setPhase] = useState<GamePhase>('setup');
  const [battleState, setBattleState] = useState<BattleState>(emptyBattleState);
  const [lieutenants, setLieutenants] = useState<Lieutenant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [flowcharts, setFlowcharts] = useState<Record<string, Flowchart>>({});
  const [selectedLieutenant, setSelectedLieutenant] = useState<string | null>(null);
  const [briefings, setBriefings] = useState<Record<string, string>>({});
  
  // Setup state
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [apiKeyValid, setApiKeyValid] = useState(false);

  // Handle WebSocket messages
  const handleWSMessage = useCallback((msg: unknown) => {
    const message = msg as { type: string; data: unknown };
    
    switch (message.type) {
      case 'connected': {
        const data = message.data as { models: Model[]; selectedModel: string };
        setModels(data.models);
        setSelectedModel(data.selectedModel);
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
        setSetupError(data.message);
        break;
      }
      
      case 'model_set': {
        const data = message.data as { model: string };
        setSelectedModel(data.model);
        break;
      }
      
      case 'lieutenants': {
        const data = message.data as { lieutenants: Lieutenant[] };
        setLieutenants(data.lieutenants);
        if (!selectedLieutenant && data.lieutenants.length > 0) {
          setSelectedLieutenant(data.lieutenants[0]!.id);
        }
        break;
      }
      
      case 'state': {
        const data = message.data as BattleState;
        setBattleState(data);
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
      
      case 'battle_ready': {
        break;
      }
      
      case 'battle_started': {
        setPhase('battle');
        break;
      }
      
      case 'battle_paused': {
        setBattleState(prev => ({ ...prev, running: false }));
        break;
      }
      
      case 'battle_end': {
        const data = message.data as { winner: 'player' | 'enemy'; summary: string };
        setBattleState(prev => ({ ...prev, winner: data.winner, running: false }));
        setPhase('post-battle');
        break;
      }
    }
  }, [selectedLieutenant]);

  const { status, send } = useWebSocket(WS_URL, handleWSMessage);

  // API Key handling
  const handleSetApiKey = useCallback((apiKey: string) => {
    setIsValidating(true);
    setSetupError(null);
    send({ type: 'set_api_key', data: { apiKey } });
  }, [send]);

  const handleSetModel = useCallback((model: string) => {
    send({ type: 'set_model', data: { model } });
  }, [send]);

  // Battle controls
  const handleStartBattle = useCallback(() => {
    send({ type: 'init_battle', data: { scenario: 'basic', briefings } });
    setTimeout(() => {
      send({ type: 'start_battle', data: {} });
    }, 500);
  }, [send, briefings]);

  const handleSendOrder = useCallback((lieutenantId: string, order: string) => {
    send({ type: 'send_order', data: { lieutenantId, order } });
  }, [send]);

  const handleBriefingChange = useCallback((lieutenantId: string, briefing: string) => {
    setBriefings(prev => ({ ...prev, [lieutenantId]: briefing }));
  }, []);

  const handleNewBattle = useCallback(() => {
    setPhase('pre-battle');
    setMessages([]);
    setFlowcharts({});
    setBattleState(emptyBattleState);
  }, []);

  // Connection status indicator
  const connectionStatus = status === 'connected' ? '🟢' : status === 'connecting' ? '🟡' : '🔴';

  return (
    <div className="app">
      <header className="app-header">
        <h1>⚔️ WARCHIEF</h1>
        <div className="header-info">
          <span className="connection-status" title={status}>
            {connectionStatus}
          </span>
          {phase === 'battle' && (
            <>
              <span className="tick">Tick: {battleState.tick}</span>
              <span className={`status ${battleState.running ? 'running' : 'paused'}`}>
                {battleState.running ? '● LIVE' : '◯ PAUSED'}
              </span>
            </>
          )}
          {apiKeyValid && (
            <span className="model-badge">{models.find(m => m.id === selectedModel)?.name || selectedModel}</span>
          )}
        </div>
      </header>

      {phase === 'setup' ? (
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
            { id: 'lt_alpha', name: 'Lt. Adaeze', personality: 'aggressive', troopIds: [], busy: false },
            { id: 'lt_bravo', name: 'Lt. Chen', personality: 'cautious', troopIds: [], busy: false },
            { id: 'lt_charlie', name: 'Lt. Morrison', personality: 'disciplined', troopIds: [], busy: false },
          ]}
          briefings={briefings}
          onBriefingChange={handleBriefingChange}
          onStartBattle={handleStartBattle}
        />
      ) : (
        <main className="battle-layout">
          <div className="left-panel">
            <BattlefieldCanvas
              battleState={battleState}
              selectedLieutenant={selectedLieutenant}
            />
          </div>
          
          <div className="right-panel">
            <div className="lieutenants-bar">
              {lieutenants.map(lt => (
                <button
                  key={lt.id}
                  className={`lieutenant-tab ${selectedLieutenant === lt.id ? 'selected' : ''} ${lt.busy ? 'busy' : ''}`}
                  onClick={() => setSelectedLieutenant(lt.id)}
                >
                  <span className="lt-name">{lt.name}</span>
                  <span className={`lt-personality ${lt.personality}`}>{lt.personality}</span>
                  {lt.busy && <span className="lt-busy">⏳</span>}
                </button>
              ))}
            </div>

            <MessagePanel
              messages={messages}
              lieutenants={lieutenants}
              selectedLieutenant={selectedLieutenant}
              onSendOrder={handleSendOrder}
            />

            <FlowchartPanel
              flowchart={selectedLieutenant ? flowcharts[selectedLieutenant] : undefined}
              lieutenantName={lieutenants.find(lt => lt.id === selectedLieutenant)?.name}
            />
          </div>
        </main>
      )}

      {phase === 'post-battle' && battleState.winner && (
        <div className="victory-overlay">
          <div className="victory-content">
            <h2>{battleState.winner === 'player' ? '🏆 VICTORY' : '💀 DEFEAT'}</h2>
            <p>Battle lasted {battleState.tick} ticks ({(battleState.tick / 10).toFixed(1)}s)</p>
            <button onClick={handleNewBattle}>New Battle</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
