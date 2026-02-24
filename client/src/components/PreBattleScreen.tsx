import type { Lieutenant, Message, GameMode } from '../types';

interface Props {
  lieutenants: Lieutenant[];
  briefings: Record<string, string>;
  onBriefingChange: (lieutenantId: string, briefing: string) => void;
  onStartBattle: () => void;
  isInitializing?: boolean;
  messages?: Message[];
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

export function PreBattleScreen({
  lieutenants, briefings, onBriefingChange, onStartBattle, isInitializing, messages,
  gameMode, onGameModeChange, playerPersonality, enemyPersonality,
  onPlayerPersonalityChange, onEnemyPersonalityChange,
}: Props) {
  // Filter to only show intel/report messages from briefing phase
  const briefingMessages = messages?.filter(m => m.from !== 'commander') || [];

  return (
    <div className="pre-battle">
      <h2>Pre-Battle Briefing</h2>

      {/* Game Mode Toggle */}
      <div className="game-mode-selector" style={{ display: 'flex', gap: 12, marginBottom: 24, justifyContent: 'center' }}>
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

      {gameMode === 'human_vs_ai' ? (
        <>
          <p style={{ color: '#808090', marginBottom: 16 }}>
            Brief your lieutenants. They will interpret your orders based on their personality and stats.
          </p>
          <p style={{ color: '#ff8844', fontSize: 13, marginBottom: 32 }}>
            Your opponent is an LLM commander who will also be briefing their lieutenants.
          </p>

          {/* Enemy personality selector */}
          <div style={{ marginBottom: 24, textAlign: 'center' }}>
            <label style={{ color: '#808090', fontSize: 13, marginRight: 8 }}>Enemy Commander Style:</label>
            <select
              value={enemyPersonality}
              onChange={e => onEnemyPersonalityChange(e.target.value as 'aggressive' | 'cautious' | 'balanced')}
              disabled={isInitializing}
              style={{
                background: '#1a1a2a', color: '#ccc', border: '1px solid #333',
                borderRadius: 4, padding: '4px 8px', fontSize: 13,
              }}
            >
              <option value="aggressive">Aggressive</option>
              <option value="cautious">Cautious</option>
              <option value="balanced">Balanced</option>
            </select>
          </div>

          <div className="briefing-cards">
            {lieutenants.map((lt) => (
              <div key={lt.id} className="briefing-card">
                <h3>{lt.name}</h3>
                <p className={`personality ${lt.personality}`}>
                  {lt.personality}
                </p>
                <p style={{ fontSize: 12, color: '#808090', marginBottom: 8 }}>
                  {PERSONALITY_DESCRIPTIONS[lt.personality]}
                </p>

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

                <textarea
                  className="briefing-textarea"
                  placeholder={BRIEFING_PLACEHOLDERS[lt.personality] || 'Enter briefing...'}
                  value={briefings[lt.id] || ''}
                  onChange={e => onBriefingChange(lt.id, e.target.value)}
                  disabled={isInitializing}
                />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p style={{ color: '#808090', marginBottom: 16 }}>
            Watch two AI commanders battle it out. Configure their personalities below.
          </p>

          <div className="ai-vs-ai-config" style={{ display: 'flex', gap: 32, justifyContent: 'center', marginBottom: 32, flexWrap: 'wrap' }}>
            {/* Player AI Commander */}
            <div style={{
              border: '2px solid #4488ff', borderRadius: 8, padding: 20, minWidth: 240,
              background: '#0a1020',
            }}>
              <h3 style={{ color: '#4488ff', margin: '0 0 8px', fontSize: 16 }}>Player Commander (AI)</h3>
              <p style={{ color: '#808090', fontSize: 12, marginBottom: 12 }}>
                Commands: Lt. Adaeze, Lt. Chen, Lt. Morrison
              </p>
              <label style={{ color: '#808090', fontSize: 13, display: 'block', marginBottom: 4 }}>Personality:</label>
              <select
                value={playerPersonality}
                onChange={e => onPlayerPersonalityChange(e.target.value as 'aggressive' | 'cautious' | 'balanced')}
                disabled={isInitializing}
                style={{
                  background: '#1a1a2a', color: '#4488ff', border: '1px solid #4488ff',
                  borderRadius: 4, padding: '6px 12px', fontSize: 14, width: '100%',
                }}
              >
                <option value="aggressive">Aggressive</option>
                <option value="cautious">Cautious</option>
                <option value="balanced">Balanced</option>
              </select>
              <p style={{ color: '#606070', fontSize: 11, marginTop: 8 }}>
                {COMMANDER_PERSONALITY_DESCRIPTIONS[playerPersonality]}
              </p>
            </div>

            {/* VS divider */}
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, color: '#444', fontWeight: 700 }}>
              VS
            </div>

            {/* Enemy AI Commander */}
            <div style={{
              border: '2px solid #ff4444', borderRadius: 8, padding: 20, minWidth: 240,
              background: '#200a0a',
            }}>
              <h3 style={{ color: '#ff4444', margin: '0 0 8px', fontSize: 16 }}>Enemy Commander (AI)</h3>
              <p style={{ color: '#808090', fontSize: 12, marginBottom: 12 }}>
                Commands: Lt. Volkov, Lt. Kira
              </p>
              <label style={{ color: '#808090', fontSize: 13, display: 'block', marginBottom: 4 }}>Personality:</label>
              <select
                value={enemyPersonality}
                onChange={e => onEnemyPersonalityChange(e.target.value as 'aggressive' | 'cautious' | 'balanced')}
                disabled={isInitializing}
                style={{
                  background: '#2a1a1a', color: '#ff4444', border: '1px solid #ff4444',
                  borderRadius: 4, padding: '6px 12px', fontSize: 14, width: '100%',
                }}
              >
                <option value="aggressive">Aggressive</option>
                <option value="cautious">Cautious</option>
                <option value="balanced">Balanced</option>
              </select>
              <p style={{ color: '#606070', fontSize: 11, marginTop: 8 }}>
                {COMMANDER_PERSONALITY_DESCRIPTIONS[enemyPersonality]}
              </p>
            </div>
          </div>
        </>
      )}

      {briefingMessages.length > 0 && (
        <div className="briefing-responses">
          {briefingMessages.map(msg => (
            <div key={msg.id} className={`briefing-msg ${msg.type}`}>
              <strong>{msg.from === 'intel' ? 'Intel' : msg.from}</strong>: {msg.content}
            </div>
          ))}
        </div>
      )}

      <button
        className="start-battle-btn"
        onClick={onStartBattle}
        disabled={isInitializing}
      >
        {isInitializing
          ? 'Briefing lieutenants...'
          : gameMode === 'ai_vs_ai'
            ? 'START AI BATTLE'
            : 'BEGIN BATTLE'
        }
      </button>
    </div>
  );
}
