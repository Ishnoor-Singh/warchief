interface Props {
  onPlay: () => void;
  onHowToPlay: () => void;
}

export function LandingScreen({ onPlay, onHowToPlay }: Props) {
  return (
    <div className="landing-screen">
      <div className="landing-content">
        <div className="landing-emblem">⚔️</div>
        <h1 className="landing-title">WARCHIEF</h1>
        <p className="landing-tagline">
          Command your army through words alone.
        </p>
        <p className="landing-description">
          A real-time battle strategy game where you issue orders in natural language
          to AI-powered lieutenants. They interpret your intent, write battle logic
          for their troops, and execute it on the battlefield. You never touch a unit
          — you only communicate.
        </p>

        <div className="landing-actions">
          <button className="landing-play-btn" onClick={onPlay}>
            ENTER THE WAR ROOM
          </button>
          <button className="landing-how-btn" onClick={onHowToPlay}>
            How to Play
          </button>
        </div>

        <div className="landing-features">
          <div className="landing-feature">
            <span className="feature-icon">🗣️</span>
            <div>
              <h3>Natural Language Orders</h3>
              <p>Speak to your lieutenants in plain English. They decide how to carry it out.</p>
            </div>
          </div>
          <div className="landing-feature">
            <span className="feature-icon">🧠</span>
            <div>
              <h3>AI Lieutenants</h3>
              <p>Each lieutenant has a personality — aggressive, cautious, disciplined. They interpret, not relay.</p>
            </div>
          </div>
          <div className="landing-feature">
            <span className="feature-icon">📊</span>
            <div>
              <h3>Live Flowchart Logic</h3>
              <p>Watch your lieutenants' battle plans unfold in real-time as structured flowcharts.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
