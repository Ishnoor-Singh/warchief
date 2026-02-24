import { useState, useEffect, useCallback } from 'react';
import { BattlefieldCanvas } from './components/BattlefieldCanvas';
import { MessagePanel } from './components/MessagePanel';
import { FlowchartPanel } from './components/FlowchartPanel';
import { PreBattleScreen } from './components/PreBattleScreen';
import type { BattleState, Lieutenant, Message, Flowchart } from './types';
import './App.css';

type GamePhase = 'pre-battle' | 'battle' | 'post-battle';

// Mock data for development (will be replaced by WebSocket)
const mockLieutenants: Lieutenant[] = [
  { id: 'lt_alpha', name: 'Lt. Adaeze', personality: 'aggressive', troopIds: [], busy: false },
  { id: 'lt_bravo', name: 'Lt. Chen', personality: 'cautious', troopIds: [], busy: false },
  { id: 'lt_charlie', name: 'Lt. Morrison', personality: 'disciplined', troopIds: [], busy: false },
];

const mockBattleState: BattleState = {
  tick: 0,
  agents: [],
  width: 400,
  height: 300,
  running: false,
  winner: null,
};

function App() {
  const [phase, setPhase] = useState<GamePhase>('pre-battle');
  const [battleState, setBattleState] = useState<BattleState>(mockBattleState);
  const [lieutenants, setLieutenants] = useState<Lieutenant[]>(mockLieutenants);
  const [messages, setMessages] = useState<Message[]>([]);
  const [flowcharts, _setFlowcharts] = useState<Record<string, Flowchart>>({});
  const [selectedLieutenant, setSelectedLieutenant] = useState<string | null>(null);
  const [briefings, setBriefings] = useState<Record<string, string>>({});

  // WebSocket connection (to be implemented)
  useEffect(() => {
    // TODO: Connect to server WebSocket
    // For now, we'll use mock data
  }, []);

  const handleSendOrder = useCallback((lieutenantId: string, order: string) => {
    const newMessage: Message = {
      id: `msg_${Date.now()}`,
      from: 'commander',
      to: lieutenantId,
      content: order,
      timestamp: Date.now(),
      type: 'order',
    };
    setMessages(prev => [...prev, newMessage]);

    // Mark lieutenant as busy
    setLieutenants(prev => prev.map(lt => 
      lt.id === lieutenantId ? { ...lt, busy: true } : lt
    ));

    // TODO: Send via WebSocket
    // Simulate response after delay
    setTimeout(() => {
      const response: Message = {
        id: `msg_${Date.now()}`,
        from: lieutenantId,
        to: 'commander',
        content: `Understood. Executing: "${order}"`,
        timestamp: Date.now(),
        type: 'report',
      };
      setMessages(prev => [...prev, response]);
      setLieutenants(prev => prev.map(lt => 
        lt.id === lieutenantId ? { ...lt, busy: false } : lt
      ));
    }, 1500);
  }, []);

  const handleStartBattle = useCallback(() => {
    setPhase('battle');
    setBattleState(prev => ({ ...prev, running: true }));
    // TODO: Send start command via WebSocket
  }, []);

  const handleBriefingChange = useCallback((lieutenantId: string, briefing: string) => {
    setBriefings(prev => ({ ...prev, [lieutenantId]: briefing }));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>⚔️ WARCHIEF</h1>
        <div className="header-info">
          {phase === 'battle' && (
            <>
              <span className="tick">Tick: {battleState.tick}</span>
              <span className={`status ${battleState.running ? 'running' : 'paused'}`}>
                {battleState.running ? '● LIVE' : '◯ PAUSED'}
              </span>
            </>
          )}
        </div>
      </header>

      {phase === 'pre-battle' ? (
        <PreBattleScreen
          lieutenants={lieutenants}
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
            <p>Battle lasted {battleState.tick} ticks</p>
            <button onClick={() => setPhase('pre-battle')}>New Battle</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
