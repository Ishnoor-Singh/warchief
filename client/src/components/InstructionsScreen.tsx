interface Props {
  onBack: () => void;
  onPlay: () => void;
}

export function InstructionsScreen({ onBack, onPlay }: Props) {
  return (
    <div className="instructions-screen">
      <div className="instructions-content">
        <button className="instructions-back" onClick={onBack}>
          ← Back
        </button>

        <h1 className="instructions-title">How to Play</h1>
        <p className="instructions-subtitle">
          Warchief is not a typical RTS. You never click on units or tell them where to go directly.
          Instead, you command through a chain of communication.
        </p>

        <div className="instructions-sections">
          {/* Core concept */}
          <section className="instruction-section">
            <h2>The Chain of Command</h2>
            <div className="instruction-chain">
              <div className="chain-step">
                <span className="chain-label">You</span>
                <span className="chain-desc">Issue orders in natural language</span>
              </div>
              <span className="chain-arrow">→</span>
              <div className="chain-step">
                <span className="chain-label">Lieutenants</span>
                <span className="chain-desc">Interpret and create battle logic</span>
              </div>
              <span className="chain-arrow">→</span>
              <div className="chain-step">
                <span className="chain-label">Troops</span>
                <span className="chain-desc">Execute flowchart instructions</span>
              </div>
              <span className="chain-arrow">→</span>
              <div className="chain-step">
                <span className="chain-label">Battlefield</span>
                <span className="chain-desc">Real-time simulation</span>
              </div>
            </div>
          </section>

          {/* Game flow */}
          <section className="instruction-section">
            <h2>Game Flow</h2>
            <div className="instruction-steps">
              <div className="instruction-step">
                <span className="step-number">1</span>
                <div>
                  <h3>Setup</h3>
                  <p>Connect your Anthropic API key. Your lieutenants are powered by Claude — choose a model that fits your style.</p>
                </div>
              </div>
              <div className="instruction-step">
                <span className="step-number">2</span>
                <div>
                  <h3>The War Room</h3>
                  <p>Meet your lieutenants in the War Room. Review their personalities, stats, and assigned troops. Have a conversation with each — ask questions, give orders, discuss strategy. They'll respond and prepare their troops accordingly. Choose your game mode: command yourself or watch two AI commanders fight.</p>
                </div>
              </div>
              <div className="instruction-step">
                <span className="step-number">3</span>
                <div>
                  <h3>Battle</h3>
                  <p>The simulation runs in real-time. Watch the battlefield, read reports from your lieutenants, and issue new orders as the situation evolves. Your lieutenants will update their troop flowcharts based on your commands.</p>
                </div>
              </div>
              <div className="instruction-step">
                <span className="step-number">4</span>
                <div>
                  <h3>Victory or Defeat</h3>
                  <p>The battle ends when one side's forces are eliminated. Review the battle summary, key moments, and casualty reports.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Lieutenants */}
          <section className="instruction-section">
            <h2>Your Lieutenants</h2>
            <p className="section-intro">Each lieutenant has a distinct personality that affects how they interpret your orders.</p>
            <div className="lieutenant-cards">
              <div className="lt-info-card">
                <h3>Aggressive</h3>
                <p>Favors bold, direct action. Will interpret ambiguous orders toward attack. High initiative, lower discipline.</p>
              </div>
              <div className="lt-info-card">
                <h3>Cautious</h3>
                <p>Prioritizes troop survival. Prefers defensive positioning and careful advances. Reports frequently.</p>
              </div>
              <div className="lt-info-card">
                <h3>Disciplined</h3>
                <p>Follows orders precisely. Maintains formation above all else. High discipline, acts only when told.</p>
              </div>
            </div>
            <p className="section-note">
              Lieutenants also have stats — <strong>initiative</strong>, <strong>discipline</strong>, and <strong>communication</strong> — that modulate their behavior beyond their personality type.
            </p>
          </section>

          {/* Tips */}
          <section className="instruction-section">
            <h2>Command Tips</h2>
            <ul className="tips-list">
              <li>Be clear but leave room for interpretation — your lieutenants are smarter than relay bots.</li>
              <li>Watch the flowchart panel to see how your orders translate into troop logic.</li>
              <li>Aggressive lieutenants may overcommit. Cautious ones may be slow to act. Plan accordingly.</li>
              <li>Your view of the battlefield is only what your troops can see — you don't have omniscient vision.</li>
              <li>If a lieutenant isn't responding, they may be busy processing. LLM calls are async.</li>
              <li>Use the pause button if you need time to think and reassess the situation.</li>
            </ul>
          </section>

          {/* Formations */}
          <section className="instruction-section">
            <h2>Formations</h2>
            <p className="section-intro">Your troops can adopt different formations, each with tactical advantages.</p>
            <div className="formations-grid">
              <div className="formation-item">
                <span className="formation-name">Line</span>
                <span className="formation-desc">Wide front, good for holding ground</span>
              </div>
              <div className="formation-item">
                <span className="formation-name">Wedge</span>
                <span className="formation-desc">Pointed assault, breaks through lines</span>
              </div>
              <div className="formation-item">
                <span className="formation-name">Scatter</span>
                <span className="formation-desc">Spread out, reduces area damage</span>
              </div>
              <div className="formation-item">
                <span className="formation-name">Pincer</span>
                <span className="formation-desc">Enveloping maneuver, flanks enemy</span>
              </div>
              <div className="formation-item">
                <span className="formation-name">Defensive Circle</span>
                <span className="formation-desc">360° defense, strong when surrounded</span>
              </div>
              <div className="formation-item">
                <span className="formation-name">Column</span>
                <span className="formation-desc">Fast movement, quick repositioning</span>
              </div>
            </div>
          </section>
        </div>

        <div className="instructions-footer">
          <button className="landing-play-btn" onClick={onPlay}>
            ENTER THE WAR ROOM
          </button>
        </div>
      </div>
    </div>
  );
}
