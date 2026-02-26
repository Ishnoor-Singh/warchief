import type { DetailedBattleSummary, Message, BattleState } from '../types';

interface Props {
  summary: DetailedBattleSummary | null;
  messages: Message[];
  battleHistory: BattleState[];
  onNewBattle: () => void;
}

export function EndScreen({ summary, messages, battleHistory, onNewBattle }: Props) {
  const isVictory = summary?.winner === 'player';

  const handleExportReplay = () => {
    // Build NDJSON replay file
    const lines: string[] = [];
    
    // Add ready info
    lines.push(JSON.stringify({
      type: 'ready',
      data: {
        scenario: 'recorded_battle',
        battlefield: battleHistory[0] ? { width: battleHistory[0].width, height: battleHistory[0].height } : { width: 400, height: 300 },
      }
    }));
    
    // Add all state frames
    for (const state of battleHistory) {
      lines.push(JSON.stringify({ type: 'state', data: state }));
    }
    
    // Add battle end if we have a summary
    if (summary) {
      lines.push(JSON.stringify({
        type: 'battle_end',
        data: { winner: summary.winner, summary }
      }));
    }
    
    // Download as file
    const blob = new Blob([lines.join('\n')], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `battle-${new Date().toISOString().slice(0, 10)}-${summary?.tick || 0}ticks.ndjson`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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

        <div className="end-actions">
          <button className="end-new-battle" onClick={onNewBattle}>
            New Battle
          </button>
          {battleHistory.length > 0 && (
            <button className="end-export-replay" onClick={handleExportReplay}>
              📥 Export Replay ({battleHistory.length} frames)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
