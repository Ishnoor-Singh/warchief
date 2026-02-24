import type { DetailedBattleSummary, Message } from '../types';

interface Props {
  summary: DetailedBattleSummary | null;
  messages: Message[];
  onNewBattle: () => void;
}

export function EndScreen({ summary, messages, onNewBattle }: Props) {
  const isVictory = summary?.winner === 'player';

  // Get key moments from messages (alerts and important reports)
  const keyMoments = messages
    .filter(m => m.type === 'alert' || (m.type === 'report' && m.from !== 'commander'))
    .slice(-6);

  return (
    <div className="end-screen">
      <div className="end-content">
        <h1 className={`end-title ${isVictory ? 'victory' : 'defeat'}`}>
          {isVictory ? 'VICTORY' : 'DEFEAT'}
        </h1>

        <p className="end-subtitle">
          {isVictory
            ? 'Your forces have overwhelmed the enemy commander.'
            : 'The enemy commander has outmaneuvered your forces.'}
        </p>

        {summary && (
          <div className="end-stats">
            <div className="end-stat-group">
              <h3>Your Forces</h3>
              <div className="end-stat">
                <span className="stat-label">Surviving</span>
                <span className="stat-value player">{summary.player.alive} / {summary.player.total}</span>
              </div>
              <div className="end-stat">
                <span className="stat-label">Casualties</span>
                <span className="stat-value">{summary.player.dead}</span>
              </div>
              <div className="end-stat-bar">
                <div
                  className="end-stat-fill player"
                  style={{ width: `${summary.player.total > 0 ? (summary.player.alive / summary.player.total) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div className="end-stat-group">
              <h3>Enemy Forces</h3>
              <div className="end-stat">
                <span className="stat-label">Surviving</span>
                <span className="stat-value enemy">{summary.enemy.alive} / {summary.enemy.total}</span>
              </div>
              <div className="end-stat">
                <span className="stat-label">Casualties</span>
                <span className="stat-value">{summary.enemy.dead}</span>
              </div>
              <div className="end-stat-bar">
                <div
                  className="end-stat-fill enemy"
                  style={{ width: `${summary.enemy.total > 0 ? (summary.enemy.alive / summary.enemy.total) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div className="end-duration">
              Battle duration: {summary.durationSeconds.toFixed(1)}s ({summary.tick} ticks)
            </div>
          </div>
        )}

        {keyMoments.length > 0 && (
          <div className="end-moments">
            <h3>Key Moments</h3>
            {keyMoments.map(msg => (
              <div key={msg.id} className={`end-moment ${msg.type}`}>
                <span className="moment-from">{msg.from}</span>
                <span className="moment-content">{msg.content}</span>
              </div>
            ))}
          </div>
        )}

        <button className="end-new-battle" onClick={onNewBattle}>
          New Battle
        </button>
      </div>
    </div>
  );
}
