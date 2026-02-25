import type { AgentState } from '../types';

interface Props {
  agents: AgentState[];
}

export function ArmyStrengthHUD({ agents }: Props) {
  const troops = agents.filter(a => a.type === 'troop');

  const playerTotal = troops.filter(a => a.team === 'player').length;
  const playerAlive = troops.filter(a => a.team === 'player' && a.alive).length;
  const enemyTotal = troops.filter(a => a.team === 'enemy').length;
  const enemyAlive = troops.filter(a => a.team === 'enemy' && a.alive).length;

  const playerPct = playerTotal > 0 ? Math.round((playerAlive / playerTotal) * 100) : 0;
  const enemyPct = enemyTotal > 0 ? Math.round((enemyAlive / enemyTotal) * 100) : 0;

  return (
    <div className="army-strength-hud">
      <div className="strength-side player">
        <span className="strength-label">YOUR FORCES</span>
        <div className="strength-bar-track">
          <div
            className="strength-bar-fill player"
            style={{ width: `${playerPct}%` }}
          />
        </div>
        <span className="strength-numbers">{playerAlive}/{playerTotal} ({playerPct}%)</span>
      </div>

      <div className="strength-vs">VS</div>

      <div className="strength-side enemy">
        <span className="strength-label">ENEMY</span>
        <div className="strength-bar-track">
          <div
            className="strength-bar-fill enemy"
            style={{ width: `${enemyPct}%` }}
          />
        </div>
        <span className="strength-numbers">{enemyAlive}/{enemyTotal} ({enemyPct}%)</span>
      </div>
    </div>
  );
}
