import type { Lieutenant, Message } from '../types';

interface Props {
  lieutenants: Lieutenant[];
  briefings: Record<string, string>;
  onBriefingChange: (lieutenantId: string, briefing: string) => void;
  onStartBattle: () => void;
  isInitializing?: boolean;
  messages?: Message[];
}

const PERSONALITY_DESCRIPTIONS: Record<string, string> = {
  aggressive: 'Favors bold, direct action. Interprets ambiguous orders toward attack.',
  cautious: 'Favors careful action. Prioritizes troop survival over speed.',
  disciplined: 'Follows orders precisely. Maintains formation above initiative.',
  impulsive: 'Acts quickly on instinct. May anticipate or exceed orders.',
};

const BRIEFING_PLACEHOLDERS: Record<string, string> = {
  aggressive: "You're on the left flank. Take the ridge fast. Don't wait for support.",
  cautious: "Hold the center. Watch for flanking maneuvers. Report enemy movements.",
  disciplined: "You have the right flank. Maintain formation. Advance only on my signal.",
};

export function PreBattleScreen({ lieutenants, briefings, onBriefingChange, onStartBattle, isInitializing, messages }: Props) {
  // Filter to only show intel/report messages from briefing phase
  const briefingMessages = messages?.filter(m => m.from !== 'commander') || [];

  return (
    <div className="pre-battle">
      <h2>Pre-Battle Briefing</h2>
      <p style={{ color: '#808090', marginBottom: 16 }}>
        Brief your lieutenants. They will interpret your orders based on their personality and stats.
      </p>
      <p style={{ color: '#ff8844', fontSize: 13, marginBottom: 32 }}>
        Your opponent is an LLM commander who will also be briefing their lieutenants.
      </p>

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
        {isInitializing ? 'Briefing lieutenants...' : 'BEGIN BATTLE'}
      </button>
    </div>
  );
}
