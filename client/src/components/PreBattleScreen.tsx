import { useState, useRef, useEffect } from 'react';
import type { Lieutenant, Message, GameMode, TroopInfo } from '../types';

interface Props {
  lieutenants: Lieutenant[];
  onSendBrief: (lieutenantId: string, message: string) => void;
  onStartBattle: () => void;
  isInitializing?: boolean;
  messages?: Message[];
  troopInfo?: Record<string, TroopInfo[]>;
  scenarioReady?: boolean;
  gameMode: GameMode;
  onGameModeChange: (mode: GameMode) => void;
  playerPersonality: 'aggressive' | 'cautious' | 'balanced';
  enemyPersonality: 'aggressive' | 'cautious' | 'balanced';
  onPlayerPersonalityChange: (p: 'aggressive' | 'cautious' | 'balanced') => void;
  onEnemyPersonalityChange: (p: 'aggressive' | 'cautious' | 'balanced') => void;
}

const PERSONALITY_DESCRIPTIONS: Record<string, string> = {
  aggressive: 'Favors bold, direct action. Interprets ambiguous orders toward attack.',
  cautious: 'Favors careful action. Prioritizes troop survival over speed.',
  disciplined: 'Follows orders precisely. Maintains formation above initiative.',
  impulsive: 'Acts quickly on instinct. May anticipate or exceed orders.',
};

const COMMANDER_PERSONALITY_DESCRIPTIONS: Record<string, string> = {
  aggressive: 'Overwhelming force, fast attacks, accepts casualties for position.',
  cautious: 'Defensive positioning, counter-attacks, preserves forces.',
  balanced: 'Adapts to situation, presses advantages, falls back when outmatched.',
};

const BRIEFING_PLACEHOLDERS: Record<string, string> = {
  aggressive: "You're on the left flank. Take the ridge fast. Don't wait for support.",
  cautious: "Hold the center. Watch for flanking maneuvers. Report enemy movements.",
  disciplined: "You have the right flank. Maintain formation. Advance only on my signal.",
};

function TroopInfoPanel({ troops }: { troops: TroopInfo[] }) {
  // Group troops by squad
  const squads = new Map<string, TroopInfo[]>();
  for (const troop of troops) {
    const existing = squads.get(troop.squadId) || [];
    existing.push(troop);
    squads.set(troop.squadId, existing);
  }

  return (
    <div className="troop-info-panel">
      <div className="troop-info-header">
        <span className="troop-count">{troops.length} troops</span>
        <span className="squad-count">{squads.size} {squads.size === 1 ? 'squad' : 'squads'}</span>
      </div>
      {Array.from(squads.entries()).map(([squadId, squadTroops]) => {
        // Average stats for the squad
        const avgStats = {
          combat: Math.round(squadTroops.reduce((s, t) => s + t.stats.combat, 0) / squadTroops.length * 10) / 10,
          speed: Math.round(squadTroops.reduce((s, t) => s + t.stats.speed, 0) / squadTroops.length * 10) / 10,
          courage: Math.round(squadTroops.reduce((s, t) => s + t.stats.courage, 0) / squadTroops.length * 10) / 10,
          discipline: Math.round(squadTroops.reduce((s, t) => s + t.stats.discipline, 0) / squadTroops.length * 10) / 10,
        };
        const avgPos = {
          x: Math.round(squadTroops.reduce((s, t) => s + t.position.x, 0) / squadTroops.length),
          y: Math.round(squadTroops.reduce((s, t) => s + t.position.y, 0) / squadTroops.length),
        };

        return (
          <div key={squadId} className="squad-info">
            <div className="squad-header">
              <span className="squad-name">{squadId}</span>
              <span className="squad-size">{squadTroops.length} units</span>
              <span className="squad-pos">pos ({avgPos.x}, {avgPos.y})</span>
            </div>
            <div className="squad-stats">
              <div className="squad-stat">
                <span className="squad-stat-label">CMB</span>
                <div className="squad-stat-bar">
                  <div className="squad-stat-fill combat" style={{ width: `${(avgStats.combat / 10) * 100}%` }} />
                </div>
                <span className="squad-stat-value">{avgStats.combat}</span>
              </div>
              <div className="squad-stat">
                <span className="squad-stat-label">SPD</span>
                <div className="squad-stat-bar">
                  <div className="squad-stat-fill speed" style={{ width: `${(avgStats.speed / 10) * 100}%` }} />
                </div>
                <span className="squad-stat-value">{avgStats.speed}</span>
              </div>
              <div className="squad-stat">
                <span className="squad-stat-label">CRG</span>
                <div className="squad-stat-bar">
                  <div className="squad-stat-fill courage" style={{ width: `${(avgStats.courage / 10) * 100}%` }} />
                </div>
                <span className="squad-stat-value">{avgStats.courage}</span>
              </div>
              <div className="squad-stat">
                <span className="squad-stat-label">DSC</span>
                <div className="squad-stat-bar">
                  <div className="squad-stat-fill discipline" style={{ width: `${(avgStats.discipline / 10) * 100}%` }} />
                </div>
                <span className="squad-stat-value">{avgStats.discipline}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BriefingChat({
  lieutenant,
  messages,
  onSend,
  placeholder,
  disabled,
}: {
  lieutenant: Lieutenant;
  messages: Message[];
  onSend: (message: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled || lieutenant.busy) return;
    onSend(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Filter messages for this lieutenant
  const ltMessages = messages.filter(
    m => m.from === lieutenant.id || m.to === lieutenant.id
  );

  return (
    <div className="briefing-chat">
      <div className="briefing-chat-messages">
        {ltMessages.length === 0 && (
          <div className="briefing-chat-empty">
            Send a message to brief {lieutenant.name}. You can have a back-and-forth conversation to refine your orders.
          </div>
        )}
        {ltMessages.map(msg => (
          <div key={msg.id} className={`briefing-chat-msg ${msg.from === 'commander' ? 'outgoing' : 'incoming'} ${msg.type}`}>
            <div className="briefing-chat-msg-from">
              {msg.from === 'commander' ? 'You' : lieutenant.name}
            </div>
            <div className="briefing-chat-msg-content">{msg.content}</div>
          </div>
        ))}
        {lieutenant.busy && (
          <div className="briefing-chat-msg incoming thinking">
            <div className="briefing-chat-msg-from">{lieutenant.name}</div>
            <div className="briefing-chat-msg-content typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="briefing-chat-input-row">
        <input
          type="text"
          className="briefing-chat-input"
          placeholder={placeholder}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || lieutenant.busy}
        />
        <button
          className="briefing-chat-send"
          onClick={handleSend}
          disabled={disabled || lieutenant.busy || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

export function PreBattleScreen({
  lieutenants, onSendBrief, onStartBattle, isInitializing, messages,
  troopInfo, scenarioReady,
  gameMode, onGameModeChange, playerPersonality, enemyPersonality,
  onPlayerPersonalityChange, onEnemyPersonalityChange,
}: Props) {
  const [selectedLt, setSelectedLt] = useState<string>(lieutenants[0]?.id || 'lt_alpha');
  const allMessages = messages || [];

  const activeLt = lieutenants.find(lt => lt.id === selectedLt) || lieutenants[0];

  return (
    <div className="pre-battle-v2">
      <div className="pre-battle-header">
        <h2>War Room</h2>
        <p className="pre-battle-subtitle">
          Review your forces and brief your lieutenants before battle.
        </p>
      </div>

      {/* Game Mode Toggle */}
      <div className="game-mode-selector" style={{ display: 'flex', gap: 12, marginBottom: 20, justifyContent: 'center' }}>
        <button
          className={`mode-btn ${gameMode === 'human_vs_ai' ? 'active' : ''}`}
          onClick={() => onGameModeChange('human_vs_ai')}
          disabled={isInitializing}
          style={{
            padding: '8px 20px',
            border: gameMode === 'human_vs_ai' ? '2px solid #4488ff' : '2px solid #333',
            background: gameMode === 'human_vs_ai' ? '#1a2a44' : '#111',
            color: gameMode === 'human_vs_ai' ? '#4488ff' : '#666',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Human vs AI
        </button>
        <button
          className={`mode-btn ${gameMode === 'ai_vs_ai' ? 'active' : ''}`}
          onClick={() => onGameModeChange('ai_vs_ai')}
          disabled={isInitializing}
          style={{
            padding: '8px 20px',
            border: gameMode === 'ai_vs_ai' ? '2px solid #ff8844' : '2px solid #333',
            background: gameMode === 'ai_vs_ai' ? '#2a1a0a' : '#111',
            color: gameMode === 'ai_vs_ai' ? '#ff8844' : '#666',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          AI vs AI
        </button>
      </div>

      {/* Enemy personality selector (both modes use it) */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ color: '#808090', fontSize: 13 }}>Enemy Commander:</label>
          <select
            value={enemyPersonality}
            onChange={e => onEnemyPersonalityChange(e.target.value as 'aggressive' | 'cautious' | 'balanced')}
            disabled={isInitializing}
            style={{
              background: '#1a1a2a', color: '#ff6b6b', border: '1px solid #333',
              borderRadius: 4, padding: '4px 8px', fontSize: 13,
            }}
          >
            <option value="aggressive">Aggressive</option>
            <option value="cautious">Cautious</option>
            <option value="balanced">Balanced</option>
          </select>
        </div>
        {gameMode === 'ai_vs_ai' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ color: '#808090', fontSize: 13 }}>Player AI Commander:</label>
            <select
              value={playerPersonality}
              onChange={e => onPlayerPersonalityChange(e.target.value as 'aggressive' | 'cautious' | 'balanced')}
              disabled={isInitializing}
              style={{
                background: '#1a1a2a', color: '#4488ff', border: '1px solid #4488ff',
                borderRadius: 4, padding: '4px 8px', fontSize: 13,
              }}
            >
              <option value="aggressive">Aggressive</option>
              <option value="cautious">Cautious</option>
              <option value="balanced">Balanced</option>
            </select>
          </div>
        )}
      </div>

      {gameMode === 'human_vs_ai' ? (
        <div className="war-room-layout">
          {/* Lieutenant tabs */}
          <div className="war-room-lt-tabs">
            {lieutenants.map(lt => (
              <button
                key={lt.id}
                className={`war-room-lt-tab ${selectedLt === lt.id ? 'selected' : ''} ${lt.busy ? 'busy' : ''}`}
                onClick={() => setSelectedLt(lt.id)}
              >
                <span className="war-room-lt-name">{lt.name}</span>
                <span className={`war-room-lt-personality ${lt.personality}`}>{lt.personality}</span>
                {lt.busy && <span className="war-room-lt-busy">...</span>}
              </button>
            ))}
          </div>

          {activeLt && (
            <div className="war-room-main">
              {/* Left column: lieutenant info + troops */}
              <div className="war-room-info">
                <div className="war-room-lt-card">
                  <h3>{activeLt.name}</h3>
                  <p className={`personality ${activeLt.personality}`}>
                    {activeLt.personality}
                  </p>
                  <p className="personality-desc">
                    {PERSONALITY_DESCRIPTIONS[activeLt.personality]}
                  </p>

                  {activeLt.stats && (
                    <div className="lt-stats">
                      <div className="stat-bar">
                        <span className="stat-label">Initiative</span>
                        <div className="stat-track">
                          <div className="stat-fill" style={{ width: `${(activeLt.stats.initiative / 10) * 100}%` }} />
                        </div>
                        <span className="stat-value">{activeLt.stats.initiative}</span>
                      </div>
                      <div className="stat-bar">
                        <span className="stat-label">Discipline</span>
                        <div className="stat-track">
                          <div className="stat-fill discipline" style={{ width: `${(activeLt.stats.discipline / 10) * 100}%` }} />
                        </div>
                        <span className="stat-value">{activeLt.stats.discipline}</span>
                      </div>
                      <div className="stat-bar">
                        <span className="stat-label">Comms</span>
                        <div className="stat-track">
                          <div className="stat-fill comms" style={{ width: `${(activeLt.stats.communication / 10) * 100}%` }} />
                        </div>
                        <span className="stat-value">{activeLt.stats.communication}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Troop info */}
                <div className="war-room-troops-section">
                  <h4>Forces Under Command</h4>
                  {troopInfo && troopInfo[activeLt.id] ? (
                    <TroopInfoPanel troops={troopInfo[activeLt.id]} />
                  ) : (
                    <div className="troop-info-loading">Loading troop data...</div>
                  )}
                </div>
              </div>

              {/* Right column: conversation */}
              <div className="war-room-comms">
                <h4>Briefing</h4>
                <BriefingChat
                  lieutenant={activeLt}
                  messages={allMessages}
                  onSend={(msg) => onSendBrief(activeLt.id, msg)}
                  placeholder={BRIEFING_PLACEHOLDERS[activeLt.personality] || 'Give your orders...'}
                  disabled={isInitializing || !scenarioReady}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <p style={{ color: '#808090', marginBottom: 16, textAlign: 'center' }}>
            Watch two AI commanders battle it out. Configure their personalities above, then start.
          </p>

          <div className="ai-vs-ai-config" style={{ display: 'flex', gap: 32, justifyContent: 'center', marginBottom: 32, flexWrap: 'wrap' }}>
            <div style={{
              border: '2px solid #4488ff', borderRadius: 8, padding: 20, minWidth: 240,
              background: '#0a1020',
            }}>
              <h3 style={{ color: '#4488ff', margin: '0 0 8px', fontSize: 16 }}>Player Commander (AI)</h3>
              <p style={{ color: '#808090', fontSize: 12, marginBottom: 4 }}>
                Commands: Lt. Adaeze, Lt. Chen, Lt. Morrison
              </p>
              <p style={{ color: '#606070', fontSize: 11 }}>
                {COMMANDER_PERSONALITY_DESCRIPTIONS[playerPersonality]}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, color: '#444', fontWeight: 700 }}>
              VS
            </div>

            <div style={{
              border: '2px solid #ff4444', borderRadius: 8, padding: 20, minWidth: 240,
              background: '#200a0a',
            }}>
              <h3 style={{ color: '#ff4444', margin: '0 0 8px', fontSize: 16 }}>Enemy Commander (AI)</h3>
              <p style={{ color: '#808090', fontSize: 12, marginBottom: 4 }}>
                Commands: Lt. Volkov, Lt. Kira
              </p>
              <p style={{ color: '#606070', fontSize: 11 }}>
                {COMMANDER_PERSONALITY_DESCRIPTIONS[enemyPersonality]}
              </p>
            </div>
          </div>
        </>
      )}

      <button
        className="start-battle-btn"
        onClick={onStartBattle}
        disabled={isInitializing}
      >
        {isInitializing
          ? 'Deploying forces...'
          : gameMode === 'ai_vs_ai'
            ? 'START AI BATTLE'
            : 'BEGIN BATTLE'
        }
      </button>
    </div>
  );
}
