interface Props {
  onBack: () => void;
  onPlay: () => void;
}

export function InstructionsScreen({ onBack, onPlay }: Props) {
  return (
    <div className="instructions-screen">
      <div className="instructions-content">
        <button className="instructions-back" onClick={onBack}>
          &larr; Back
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
              <span className="chain-arrow">&rarr;</span>
              <div className="chain-step">
                <span className="chain-label">Lieutenants</span>
                <span className="chain-desc">Interpret and create battle logic</span>
              </div>
              <span className="chain-arrow">&rarr;</span>
              <div className="chain-step">
                <span className="chain-label">Troops</span>
                <span className="chain-desc">Execute flowchart instructions</span>
              </div>
              <span className="chain-arrow">&rarr;</span>
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
                  <p>Connect your Anthropic API key. Your lieutenants are powered by Claude &mdash; choose a model that fits your style.</p>
                </div>
              </div>
              <div className="instruction-step">
                <span className="step-number">2</span>
                <div>
                  <h3>The War Room</h3>
                  <p>Choose your scenario (Open Field, Hill Assault, or River Crossing), pick your game mode, and meet your lieutenants. Review their personalities, stats, and assigned troops. Have a conversation with each &mdash; ask questions, give orders, discuss strategy. They'll respond and prepare their troops accordingly.</p>
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
                  <p>The battle ends when one side drops below 20% strength. Review the battle summary, key moments, and casualty reports.</p>
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
              Lieutenants also have stats &mdash; <strong>initiative</strong>, <strong>discipline</strong>, and <strong>communication</strong> &mdash; that modulate their behavior beyond their personality type.
            </p>
          </section>

          {/* Combat Mechanics */}
          <section className="instruction-section">
            <h2>Combat Mechanics</h2>
            <p className="section-intro">Combat in Warchief is driven by stats, positioning, formations, and terrain. Understanding these systems is the key to victory.</p>

            <div className="mechanics-example">
              <h3>Base Combat</h3>
              <p>Units in range deal damage each tick based on their combat stats. Higher combat stat = more damage dealt.</p>
              <div className="example-box">
                <div className="example-scenario">
                  <span className="example-label">Example:</span> Your Vanguard (combat 8) fights an enemy Infantry (combat 5)
                </div>
                <div className="example-calc">
                  Damage = 10 &times; (8 / 5) = <strong>16 per tick</strong>
                </div>
                <div className="example-result">
                  The Vanguard deals 60% more damage than baseline!
                </div>
              </div>
            </div>

            <div className="mechanics-example">
              <h3>Flanking</h3>
              <p>Attacks from the side deal <strong>1.3&times;</strong> damage. Attacks from the rear deal <strong>1.6&times;</strong> damage. Front attacks are normal.</p>
              <div className="example-box">
                <div className="example-scenario">
                  <span className="example-label">Example:</span> Scouts sneak behind enemy lines and attack from the rear
                </div>
                <div className="example-calc">
                  Damage = base &times; 1.6 = <strong>60% bonus damage</strong>
                </div>
                <div className="example-result">
                  Tell your lieutenant: "Send Charlie's scouts around the south flank and hit them from behind."
                </div>
              </div>
            </div>

            <div className="mechanics-example">
              <h3>Charge Momentum</h3>
              <p>Units that are <strong>moving when they enter combat</strong> deal bonus first-hit damage. Faster units charge harder.</p>
              <div className="example-box">
                <div className="example-scenario">
                  <span className="example-label">Example:</span> Berserkers (speed 3) charge into battle
                </div>
                <div className="example-calc">
                  Charge bonus = 10 &times; 3 &times; 0.15 = <strong>+4.5 damage on first hit</strong>
                </div>
                <div className="example-result">
                  Use wedge formation for maximum charge impact. Guardians (speed 1.5) barely charge at all.
                </div>
              </div>
            </div>
          </section>

          {/* Morale & Routing */}
          <section className="instruction-section">
            <h2>Morale &amp; Routing</h2>
            <p className="section-intro">Troops have morale (0-100). When morale collapses, they rout &mdash; fleeing the battlefield and spreading panic to nearby allies.</p>

            <div className="mechanics-example">
              <h3>How Morale Drops</h3>
              <ul className="tips-list">
                <li>Nearby ally dies: <strong>-5 morale</strong> (within 50 units)</li>
                <li>Nearby ally routs: <strong>-8 morale</strong> (within 40 units)</li>
              </ul>
            </div>

            <div className="mechanics-example">
              <h3>The Routing Check</h3>
              <p>When morale drops below <strong>40</strong>, there's a chance the unit breaks:</p>
              <div className="example-box">
                <div className="example-scenario">
                  <span className="example-label">Formula:</span> rout_chance = (1 - morale/40) &times; (1 - courage/12)
                </div>
                <div className="example-calc">
                  Militia (courage 3) at morale 10: rout chance = <strong>56%</strong> per tick
                </div>
                <div className="example-calc">
                  Guardian (courage 9) at morale 10: rout chance = <strong>19%</strong> per tick
                </div>
                <div className="example-result">
                  High-courage units (Vanguard, Guardian) anchor your line. Low-courage units (Berserker, Militia) crumble under pressure.
                </div>
              </div>
            </div>

            <div className="mechanics-example">
              <h3>The Panic Cascade</h3>
              <p>Routing is contagious. One unit breaking can cause a chain reaction:</p>
              <div className="example-box">
                <div className="example-scenario">
                  <span className="example-label">Scenario:</span> 3 militia in a cluster, all at 35 morale
                </div>
                <div className="example-calc">
                  Militia A routs &rarr; Militia B loses 8 morale (now 27) &rarr; B routs &rarr; C loses 8 morale (now 27) &rarr; C routs
                </div>
                <div className="example-result">
                  The entire flank collapses in seconds. Keep high-courage units mixed in to prevent cascades.
                </div>
              </div>
            </div>

            <div className="mechanics-example">
              <h3>Recovery</h3>
              <p>Out-of-combat units recover <strong>+0.5 morale per tick</strong> (5/sec). Routing units that recover above 50 morale rejoin the fight.</p>
            </div>
          </section>

          {/* Scenarios */}
          <section className="instruction-section">
            <h2>Scenarios</h2>
            <p className="section-intro">Choose your battlefield before the fight begins.</p>
            <div className="terrain-grid">
              <div className="terrain-card">
                <h3 style={{ color: '#66bb6a' }}>Open Field</h3>
                <p><strong>Difficulty:</strong> Standard</p>
                <p>Two balanced armies face each other. No terrain advantages. Pure tactical positioning and communication.</p>
              </div>
              <div className="terrain-card">
                <h3 style={{ color: '#ff9800' }}>Hill Assault</h3>
                <p><strong>Difficulty:</strong> Hard</p>
                <p>Attack a fortified hilltop. More attackers, but defenders are stronger and hold the high ground.</p>
              </div>
              <div className="terrain-card">
                <h3 style={{ color: '#f44336' }}>River Crossing</h3>
                <p><strong>Difficulty:</strong> Expert</p>
                <p>Cross a river to engage defenders. Forests provide flanking routes. Mixed unit types require diverse tactics.</p>
              </div>
            </div>
          </section>

          {/* Terrain */}
          <section className="instruction-section">
            <h2>Terrain</h2>
            <p className="section-intro">The battlefield isn't flat. Hills, forests, and rivers change everything.</p>

            <div className="terrain-grid">
              <div className="terrain-card">
                <h3 style={{ color: '#b49b32' }}>Hill</h3>
                <p><strong>Defense:</strong> -25% damage taken</p>
                <p><strong>Speed:</strong> 15% slower</p>
                <p><strong>Vision:</strong> +20 range</p>
                <p className="terrain-tip">Hold the high ground. The defense bonus stacks with formations.</p>
              </div>
              <div className="terrain-card">
                <h3 style={{ color: '#328c32' }}>Forest</h3>
                <p><strong>Defense:</strong> -20% damage taken</p>
                <p><strong>Speed:</strong> 30% slower</p>
                <p><strong>Concealment:</strong> 50% harder to spot</p>
                <p className="terrain-tip">Perfect for ambushes. Move scouts through forests to flank.</p>
              </div>
              <div className="terrain-card">
                <h3 style={{ color: '#3c78c8' }}>River</h3>
                <p><strong>Defense:</strong> +40% MORE damage taken</p>
                <p><strong>Speed:</strong> 55% slower</p>
                <p className="terrain-tip">Kill zone. Cross quickly or find another way around.</p>
              </div>
            </div>

            <div className="mechanics-example">
              <h3>Terrain Combos</h3>
              <div className="example-box">
                <div className="example-scenario">
                  <span className="example-label">Best defense:</span> Defensive circle on a hilltop
                </div>
                <div className="example-calc">
                  Damage taken = base &times; 0.75 (hill) / 1.4 (circle) = <strong>54% of normal</strong>
                </div>
                <div className="example-scenario">
                  <span className="example-label">Worst idea:</span> Column crossing a river under fire
                </div>
                <div className="example-calc">
                  Damage taken = base &times; 1.4 (river) / 0.7 (column) = <strong>200% of normal</strong>
                </div>
              </div>
            </div>
          </section>

          {/* Formations */}
          <section className="instruction-section">
            <h2>Formations</h2>
            <p className="section-intro">Formations now have real combat impact. Choosing the right formation for the situation is crucial.</p>
            <div className="formations-grid">
              <div className="formation-item">
                <span className="formation-name">Line</span>
                <span className="formation-stats">ATK 1.0x / DEF 1.0x</span>
                <span className="formation-desc">Balanced front, good for holding ground</span>
              </div>
              <div className="formation-item">
                <span className="formation-name">Wedge</span>
                <span className="formation-stats" style={{ color: '#ff6b6b' }}>ATK 1.3x / DEF 0.8x</span>
                <span className="formation-desc">Offensive. Breaks through lines, great for charges</span>
              </div>
              <div className="formation-item">
                <span className="formation-name">Defensive Circle</span>
                <span className="formation-stats" style={{ color: '#4aff6a' }}>ATK 0.7x / DEF 1.4x</span>
                <span className="formation-desc">Strongest defense. Hold position at all costs</span>
              </div>
              <div className="formation-item">
                <span className="formation-name">Scatter</span>
                <span className="formation-stats" style={{ color: '#4aff6a' }}>ATK 0.85x / DEF 1.15x</span>
                <span className="formation-desc">Evasive. Harder to hit, good under pressure</span>
              </div>
              <div className="formation-item">
                <span className="formation-name">Pincer</span>
                <span className="formation-stats" style={{ color: '#ff6b6b' }}>ATK 1.2x / DEF 0.9x</span>
                <span className="formation-desc">Flanking. Envelops enemies from both sides</span>
              </div>
              <div className="formation-item">
                <span className="formation-name">Column</span>
                <span className="formation-stats" style={{ color: '#ff4a4a' }}>ATK 0.6x / DEF 0.7x</span>
                <span className="formation-desc">MOVEMENT ONLY. Never fight in column formation</span>
              </div>
            </div>
          </section>

          {/* Unit Types */}
          <section className="instruction-section">
            <h2>Unit Types</h2>
            <p className="section-intro">Each unit type has distinct stat tradeoffs. Build your strategy around their strengths.</p>
            <div className="unit-types-grid">
              <div className="unit-card">
                <h3>Infantry</h3>
                <div className="unit-stat-bars">
                  <div className="stat-row"><span>Combat</span><div className="stat-bar"><div className="stat-fill" style={{width:'50%', background:'#ff6b6b'}} /></div><span>5</span></div>
                  <div className="stat-row"><span>Speed</span><div className="stat-bar"><div className="stat-fill" style={{width:'50%', background:'#4aff6a'}} /></div><span>2</span></div>
                  <div className="stat-row"><span>Courage</span><div className="stat-bar"><div className="stat-fill" style={{width:'50%', background:'#ffd700'}} /></div><span>5</span></div>
                </div>
                <p>Balanced all-rounder. Reliable in any role.</p>
              </div>
              <div className="unit-card">
                <h3>Vanguard</h3>
                <div className="unit-stat-bars">
                  <div className="stat-row"><span>Combat</span><div className="stat-bar"><div className="stat-fill" style={{width:'80%', background:'#ff6b6b'}} /></div><span>8</span></div>
                  <div className="stat-row"><span>Speed</span><div className="stat-bar"><div className="stat-fill" style={{width:'37%', background:'#4aff6a'}} /></div><span>1.5</span></div>
                  <div className="stat-row"><span>Courage</span><div className="stat-bar"><div className="stat-fill" style={{width:'70%', background:'#ffd700'}} /></div><span>7</span></div>
                </div>
                <p>Heavy front-line fighter. Slow but devastating.</p>
              </div>
              <div className="unit-card">
                <h3>Berserker</h3>
                <div className="unit-stat-bars">
                  <div className="stat-row"><span>Combat</span><div className="stat-bar"><div className="stat-fill" style={{width:'90%', background:'#ff6b6b'}} /></div><span>9</span></div>
                  <div className="stat-row"><span>Speed</span><div className="stat-bar"><div className="stat-fill" style={{width:'75%', background:'#4aff6a'}} /></div><span>3</span></div>
                  <div className="stat-row"><span>Courage</span><div className="stat-bar"><div className="stat-fill" style={{width:'30%', background:'#ffd700'}} /></div><span>3</span></div>
                </div>
                <p>Glass cannon. Massive damage but will rout under pressure.</p>
              </div>
              <div className="unit-card">
                <h3>Guardian</h3>
                <div className="unit-stat-bars">
                  <div className="stat-row"><span>Combat</span><div className="stat-bar"><div className="stat-fill" style={{width:'60%', background:'#ff6b6b'}} /></div><span>6</span></div>
                  <div className="stat-row"><span>Speed</span><div className="stat-bar"><div className="stat-fill" style={{width:'37%', background:'#4aff6a'}} /></div><span>1.5</span></div>
                  <div className="stat-row"><span>Courage</span><div className="stat-bar"><div className="stat-fill" style={{width:'90%', background:'#ffd700'}} /></div><span>9</span></div>
                </div>
                <p>Immovable anchor. Will hold the line when everyone else breaks.</p>
              </div>
              <div className="unit-card">
                <h3>Scout</h3>
                <div className="unit-stat-bars">
                  <div className="stat-row"><span>Combat</span><div className="stat-bar"><div className="stat-fill" style={{width:'30%', background:'#ff6b6b'}} /></div><span>3</span></div>
                  <div className="stat-row"><span>Speed</span><div className="stat-bar"><div className="stat-fill" style={{width:'100%', background:'#4aff6a'}} /></div><span>4</span></div>
                  <div className="stat-row"><span>Courage</span><div className="stat-bar"><div className="stat-fill" style={{width:'40%', background:'#ffd700'}} /></div><span>4</span></div>
                </div>
                <p>Fast flanker. Weak in direct combat but great for surprise attacks.</p>
              </div>
              <div className="unit-card">
                <h3>Militia</h3>
                <div className="unit-stat-bars">
                  <div className="stat-row"><span>Combat</span><div className="stat-bar"><div className="stat-fill" style={{width:'30%', background:'#ff6b6b'}} /></div><span>3</span></div>
                  <div className="stat-row"><span>Speed</span><div className="stat-bar"><div className="stat-fill" style={{width:'50%', background:'#4aff6a'}} /></div><span>2</span></div>
                  <div className="stat-row"><span>Courage</span><div className="stat-bar"><div className="stat-fill" style={{width:'30%', background:'#ffd700'}} /></div><span>3</span></div>
                </div>
                <p>Expendable reserves. Below average in everything.</p>
              </div>
            </div>
          </section>

          {/* Lieutenant Awareness */}
          <section className="instruction-section">
            <h2>Lieutenant Awareness</h2>
            <p className="section-intro">Your lieutenants are more than order-followers. They observe, remember, and communicate proactively.</p>

            <div className="mechanics-example">
              <h3>Working Memory</h3>
              <p>Lieutenants remember what happens during battle. They track enemy positions, threat assessments, and tactical observations across orders. This means they make better decisions as the battle progresses &mdash; they don't start from scratch each time you speak to them.</p>
            </div>

            <div className="mechanics-example">
              <h3>Proactive Reports</h3>
              <p>Lieutenants will message you without being asked. They'll warn about dangerous situations, report on progress, push back on risky orders, and share tactical observations. <strong>Read their messages carefully</strong> &mdash; they see things you might miss.</p>
            </div>

            <div className="mechanics-example">
              <h3>Battlefield Events</h3>
              <p>Lieutenants automatically react to what happens around them:</p>
              <ul className="tips-list">
                <li><strong>Formation broken</strong> &mdash; when too many troops are lost or scattered, the lieutenant may regroup or switch formations</li>
                <li><strong>Morale dropping</strong> &mdash; when squad morale is dangerously low, the lieutenant can order retreats or defensive positions before a cascade</li>
                <li><strong>Enemy retreating</strong> &mdash; when visible enemies rout, lieutenants can opportunistically pursue</li>
                <li><strong>Terrain transitions</strong> &mdash; when troops enter or leave hills, forests, or rivers, formations and tactics can adjust automatically</li>
              </ul>
            </div>
          </section>

          {/* Tips */}
          <section className="instruction-section">
            <h2>Command Tips</h2>
            <ul className="tips-list">
              <li>Be clear but leave room for interpretation &mdash; your lieutenants are smarter than relay bots.</li>
              <li>Watch the flowchart panel to see how your orders translate into troop logic.</li>
              <li>Aggressive lieutenants may overcommit. Cautious ones may be slow to act. Plan accordingly.</li>
              <li>Your view of the battlefield is only what your troops can see &mdash; you don't have omniscient vision.</li>
              <li><strong>Position matters.</strong> Flanking deals 30-60% bonus damage. Get scouts behind the enemy.</li>
              <li><strong>Terrain is everything.</strong> Hold hills, use forests for cover, and never fight in rivers.</li>
              <li><strong>Watch morale.</strong> A yellow pulsing unit is about to break. Low-courage troops near the front will cascade.</li>
              <li><strong>Formation choice matters.</strong> Switch to wedge for charges, circle for defense, and never fight in column.</li>
              <li><strong>Listen to your lieutenants.</strong> They'll proactively warn you about threats and share tactical observations.</li>
              <li>Use the pause button if you need time to think and reassess the situation.</li>
            </ul>
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
