import type { Lieutenant } from '../types';

interface Props {
  lieutenants: Lieutenant[];
  briefings: Record<string, string>;
  onBriefingChange: (lieutenantId: string, briefing: string) => void;
  onStartBattle: () => void;
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

export function PreBattleScreen({ lieutenants, briefings, onBriefingChange, onStartBattle }: Props) {
  return (
    <div className="pre-battle">
      <h2>⚔️ Pre-Battle Briefing</h2>
      <p style={{ color: '#808090', marginBottom: 32 }}>
        Brief your lieutenants before the battle begins. They will interpret your orders based on their personality.
      </p>

      <div className="briefing-cards">
        {lieutenants.map((lt) => (
          <div key={lt.id} className="briefing-card">
            <h3>{lt.name}</h3>
            <p className={`personality ${lt.personality}`}>
              {lt.personality}
            </p>
            <p style={{ fontSize: 12, color: '#808090', marginBottom: 12 }}>
              {PERSONALITY_DESCRIPTIONS[lt.personality]}
            </p>
            <textarea
              className="briefing-textarea"
              placeholder={BRIEFING_PLACEHOLDERS[lt.personality] || 'Enter briefing...'}
              value={briefings[lt.id] || ''}
              onChange={e => onBriefingChange(lt.id, e.target.value)}
            />
          </div>
        ))}
      </div>

      <button className="start-battle-btn" onClick={onStartBattle}>
        ⚔️ BEGIN BATTLE
      </button>
    </div>
  );
}
