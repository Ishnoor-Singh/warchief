import { useState, useRef, useEffect } from 'react';
import type { Lieutenant, Message, GameMode, TroopInfo, Flowchart, FlowchartNode, LieutenantStats, TroopStats } from '../types';
import { MapPreview } from './MapPreview';
import { FlowchartEditor } from './FlowchartEditor';

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
  flowcharts: Record<string, Flowchart>;
  mapSize: { width: number; height: number };
  onUpdateLtConfig: (ltId: string, personality?: Lieutenant['personality'], stats?: Partial<LieutenantStats>) => void;
  onUpdateSquadStats: (squadId: string, stats: Partial<TroopStats>) => void;
  onUpdateFlowchartNode: (ltId: string, operation: 'add' | 'update' | 'delete', node?: FlowchartNode, nodeId?: string) => void;
  scenario: 'basic' | 'assault' | 'river_crossing';
  onScenarioChange: (scenario: 'basic' | 'assault' | 'river_crossing') => void;
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
  impulsive: "Rush forward and engage on contact. Keep moving.",
};

// ── Stat number editor ────────────────────────────────────────────────
function StatInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="stat-input-group">
      <button
        className="stat-nudge"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
      >−</button>
      <span className="stat-input-val">{value}</span>
      <button
        className="stat-nudge"
        onClick={() => onChange(Math.min(10, value + 1))}
        disabled={value >= 10}
      >+</button>
    </div>
  );
}

// ── Lieutenant card with inline stat editing ─────────────────────────
function LieutenantCard({
  lt,
  onUpdateConfig,
}: {
  lt: Lieutenant;
  onUpdateConfig: (ltId: string, personality?: Lieutenant['personality'], stats?: Partial<LieutenantStats>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftStats, setDraftStats] = useState<LieutenantStats>(lt.stats ?? { initiative: 5, discipline: 5, communication: 5 });
  const [draftPersonality, setDraftPersonality] = useState<Lieutenant['personality']>(lt.personality);

  function startEdit() {
    setDraftStats(lt.stats ?? { initiative: 5, discipline: 5, communication: 5 });
    setDraftPersonality(lt.personality);
    setEditing(true);
  }

  function saveEdit() {
    onUpdateConfig(lt.id, draftPersonality, draftStats);
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  return (
    <div className="war-room-lt-card">
      <div className="lt-card-header">
        <h3>{lt.name}</h3>
        {!editing && (
          <button className="lt-card-edit-btn" onClick={startEdit} title="Edit stats and personality">
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <>
          <div className="lt-edit-field">
            <label className="lt-edit-label">Personality</label>
            <select
              className="lt-edit-select"
              value={draftPersonality}
              onChange={e => setDraftPersonality(e.target.value as Lieutenant['personality'])}
            >
              <option value="aggressive">Aggressive</option>
              <option value="cautious">Cautious</option>
              <option value="disciplined">Disciplined</option>
              <option value="impulsive">Impulsive</option>
            </select>
            <div className="lt-edit-hint">{PERSONALITY_DESCRIPTIONS[draftPersonality]}</div>
          </div>

          <div className="lt-edit-field">
            <label className="lt-edit-label">Initiative <span className="lt-stat-desc">— likelihood of acting without orders</span></label>
            <StatInput value={draftStats.initiative} onChange={v => setDraftStats(s => ({ ...s, initiative: v }))} />
          </div>
          <div className="lt-edit-field">
            <label className="lt-edit-label">Discipline <span className="lt-stat-desc">— how literally orders are followed</span></label>
            <StatInput value={draftStats.discipline} onChange={v => setDraftStats(s => ({ ...s, discipline: v }))} />
          </div>
          <div className="lt-edit-field">
            <label className="lt-edit-label">Communication <span className="lt-stat-desc">— frequency and quality of reports</span></label>
            <StatInput value={draftStats.communication} onChange={v => setDraftStats(s => ({ ...s, communication: v }))} />
          </div>

          <div className="lt-edit-actions">
            <button className="lt-edit-save" onClick={saveEdit}>Apply</button>
            <button className="lt-edit-cancel" onClick={cancelEdit}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p className={`personality ${lt.personality}`}>{lt.personality}</p>
          <p className="personality-desc">{PERSONALITY_DESCRIPTIONS[lt.personality]}</p>

          {lt.stats && (
            <div className="lt-stats">
              <div className="stat-bar">
                <span className="stat-label">Initiative</span>
                <div className="stat-track">
                  <div className="stat-fill" style={{ width: `${(lt.stats.initiative / 10) * 100}%` }} />
                </div>
                <span className="stat-value">{lt.stats.initiative}</span>
              </div>
              <div className="stat-bar">
                <span className="stat-label">Discipline</span>
                <div className="stat-track">
                  <div className="stat-fill discipline" style={{ width: `${(lt.stats.discipline / 10) * 100}%` }} />
                </div>
                <span className="stat-value">{lt.stats.discipline}</span>
              </div>
              <div className="stat-bar">
                <span className="stat-label">Comms</span>
                <div className="stat-track">
                  <div className="stat-fill comms" style={{ width: `${(lt.stats.communication / 10) * 100}%` }} />
                </div>
                <span className="stat-value">{lt.stats.communication}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Squad info with inline stat editing ──────────────────────────────
function SquadInfoRow({
  squadId,
  troops,
  onUpdateStats,
}: {
  squadId: string;
  troops: TroopInfo[];
  onUpdateStats: (squadId: string, stats: Partial<TroopStats>) => void;
}) {
  const [editing, setEditing] = useState(false);

  const avgStats: TroopStats = {
    combat: Math.round(troops.reduce((s, t) => s + t.stats.combat, 0) / troops.length * 10) / 10,
    speed: Math.round(troops.reduce((s, t) => s + t.stats.speed, 0) / troops.length * 10) / 10,
    courage: Math.round(troops.reduce((s, t) => s + t.stats.courage, 0) / troops.length * 10) / 10,
    discipline: Math.round(troops.reduce((s, t) => s + t.stats.discipline, 0) / troops.length * 10) / 10,
  };

  const avgPos = {
    x: Math.round(troops.reduce((s, t) => s + t.position.x, 0) / troops.length),
    y: Math.round(troops.reduce((s, t) => s + t.position.y, 0) / troops.length),
  };

  // Derive compass direction from x coordinate (map is ~400 wide)
  const compass = avgPos.x < 100 ? 'W (near)' : avgPos.x < 200 ? 'W-center' : avgPos.x < 300 ? 'E-center' : 'E (far)';

  const [draft, setDraft] = useState<TroopStats>({ ...avgStats });

  function startEdit() {
    setDraft({ ...avgStats });
    setEditing(true);
  }

  function saveEdit() {
    onUpdateStats(squadId, draft);
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  return (
    <div className="squad-info">
      <div className="squad-header">
        <span className="squad-name">{squadId}</span>
        <span className="squad-size">{troops.length} units</span>
        <span className="squad-pos" title={`Map coords: (${avgPos.x}, ${avgPos.y})`}>
          {compass}
        </span>
        {!editing && (
          <button className="squad-edit-btn" onClick={startEdit} title="Edit squad stats">Edit</button>
        )}
      </div>

      {editing ? (
        <div className="squad-edit-stats">
          {(['combat', 'speed', 'courage', 'discipline'] as const).map(stat => (
            <div key={stat} className="squad-edit-row">
              <span className="squad-stat-label">{stat.slice(0, 3).toUpperCase()}</span>
              <StatInput value={draft[stat]} onChange={v => setDraft(d => ({ ...d, [stat]: v }))} />
            </div>
          ))}
          <div className="squad-edit-actions">
            <button className="lt-edit-save small" onClick={saveEdit}>Apply</button>
            <button className="lt-edit-cancel small" onClick={cancelEdit}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="squad-stats">
          {(['combat', 'speed', 'courage', 'discipline'] as const).map(stat => (
            <div key={stat} className="squad-stat">
              <span className="squad-stat-label">{stat.slice(0, 3).toUpperCase()}</span>
              <div className="squad-stat-bar">
                <div className={`squad-stat-fill ${stat}`} style={{ width: `${(avgStats[stat] / 10) * 100}%` }} />
              </div>
              <span className="squad-stat-value">{avgStats[stat]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TroopInfoPanel({
  troops,
  onUpdateStats,
}: {
  troops: TroopInfo[];
  onUpdateStats: (squadId: string, stats: Partial<TroopStats>) => void;
}) {
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
      {Array.from(squads.entries()).map(([squadId, squadTroops]) => (
        <SquadInfoRow
          key={squadId}
          squadId={squadId}
          troops={squadTroops}
          onUpdateStats={onUpdateStats}
        />
      ))}
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

  const ltMessages = messages.filter(m => m.from === lieutenant.id || m.to === lieutenant.id);

  return (
    <div className="briefing-chat">
      <div className="briefing-chat-messages">
        {ltMessages.length === 0 && (
          <div className="briefing-chat-empty">
            Send a message to brief {lieutenant.name}. You can have a back-and-forth conversation to refine your orders.
            <br /><br />
            <span style={{ color: '#666', fontSize: 12 }}>
              Tip: after briefing, check the Flowchart tab to see and edit the generated rules.
            </span>
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

const SCENARIO_INFO: Record<string, { name: string; description: string; difficulty: string }> = {
  basic: {
    name: 'Open Field',
    description: 'Two armies face each other across open terrain. Balanced forces, no terrain advantages.',
    difficulty: 'Standard',
  },
  assault: {
    name: 'Hill Assault',
    description: 'Attack a fortified hilltop position. Fewer but stronger defenders. Terrain favors the enemy.',
    difficulty: 'Hard',
  },
  river_crossing: {
    name: 'River Crossing',
    description: 'Cross a river to engage defenders on high ground. Forests provide flanking cover. Mixed unit types.',
    difficulty: 'Expert',
  },
};

export function PreBattleScreen({
  lieutenants, onSendBrief, onStartBattle, isInitializing, messages,
  troopInfo, scenarioReady,
  gameMode, onGameModeChange, playerPersonality, enemyPersonality,
  onPlayerPersonalityChange, onEnemyPersonalityChange,
  flowcharts, mapSize,
  onUpdateLtConfig, onUpdateSquadStats, onUpdateFlowchartNode,
  scenario, onScenarioChange,
}: Props) {
  const [selectedLt, setSelectedLt] = useState<string>(lieutenants[0]?.id || 'lt_alpha');
  const [rightTab, setRightTab] = useState<'brief' | 'flowchart'>('brief');
  const allMessages = messages || [];

  const activeLt = lieutenants.find(lt => lt.id === selectedLt) || lieutenants[0];

  return (
    <div className="pre-battle-v2">
      <div className="pre-battle-header">
        <h2>War Room</h2>
        <p className="pre-battle-subtitle">
          Review your forces, edit configurations, and brief your lieutenants before battle.
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

      {/* Scenario Picker */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        {(Object.entries(SCENARIO_INFO) as [string, typeof SCENARIO_INFO[string]][]).map(([key, info]) => (
          <button
            key={key}
            onClick={() => onScenarioChange(key as 'basic' | 'assault' | 'river_crossing')}
            disabled={isInitializing}
            style={{
              padding: '10px 16px',
              border: scenario === key ? '2px solid #66bb6a' : '2px solid #333',
              background: scenario === key ? '#0a2010' : '#111',
              color: scenario === key ? '#66bb6a' : '#888',
              borderRadius: 8,
              cursor: isInitializing ? 'not-allowed' : 'pointer',
              textAlign: 'left',
              maxWidth: 200,
              minWidth: 160,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{info.name}</div>
            <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.3 }}>{info.description}</div>
            <div style={{ fontSize: 10, marginTop: 4, color: scenario === key ? '#aaffaa' : '#666' }}>
              Difficulty: {info.difficulty}
            </div>
          </button>
        ))}
      </div>

      {/* Enemy personality selector */}
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
              {/* Left column: lieutenant config + map + troops */}
              <div className="war-room-info">
                <LieutenantCard lt={activeLt} onUpdateConfig={onUpdateLtConfig} />

                {/* Minimap */}
                {scenarioReady && troopInfo && Object.keys(troopInfo).length > 0 && (
                  <div className="war-room-map-section">
                    <MapPreview
                      mapWidth={mapSize.width}
                      mapHeight={mapSize.height}
                      troopInfo={troopInfo}
                      lieutenants={lieutenants}
                    />
                  </div>
                )}

                {/* Troop info */}
                <div className="war-room-troops-section">
                  <h4>Forces Under Command</h4>
                  {troopInfo && troopInfo[activeLt.id] ? (
                    <TroopInfoPanel
                      troops={troopInfo[activeLt.id]}
                      onUpdateStats={onUpdateSquadStats}
                    />
                  ) : (
                    <div className="troop-info-loading">Loading troop data...</div>
                  )}
                </div>
              </div>

              {/* Right column: tabbed Brief / Flowchart */}
              <div className="war-room-comms">
                <div className="war-room-right-tabs">
                  <button
                    className={`wr-tab ${rightTab === 'brief' ? 'active' : ''}`}
                    onClick={() => setRightTab('brief')}
                  >
                    Briefing
                  </button>
                  <button
                    className={`wr-tab ${rightTab === 'flowchart' ? 'active' : ''}`}
                    onClick={() => setRightTab('flowchart')}
                  >
                    Flowchart
                    {flowcharts[activeLt.id]?.nodes?.length ? (
                      <span className="wr-tab-badge">{flowcharts[activeLt.id].nodes.length}</span>
                    ) : null}
                  </button>
                </div>

                {rightTab === 'brief' ? (
                  <BriefingChat
                    lieutenant={activeLt}
                    messages={allMessages}
                    onSend={(msg) => onSendBrief(activeLt.id, msg)}
                    placeholder={BRIEFING_PLACEHOLDERS[activeLt.personality] || 'Give your orders...'}
                    disabled={isInitializing || !scenarioReady}
                  />
                ) : (
                  <div className="war-room-flowchart-pane">
                    <FlowchartEditor
                      flowchart={flowcharts[activeLt.id]}
                      lieutenantName={activeLt.name}
                      mapWidth={mapSize.width}
                      mapHeight={mapSize.height}
                      onUpdateNode={(op, node, nodeId) =>
                        onUpdateFlowchartNode(activeLt.id, op, node, nodeId)
                      }
                    />
                  </div>
                )}
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
