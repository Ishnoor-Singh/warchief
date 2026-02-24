# Warchief

> *You are the only human on the battlefield. Everyone else is an agent.*

## What Is This?

Warchief is a real-time battle strategy game where your only interface is natural language. No clicking units, no build menus, no drag-to-select. You are a battle commander. You communicate — via orders, speeches, and direct messages — to a hierarchy of AI lieutenants, who in turn program and command their troops.

The army lives and dies by how well you communicate, how well you've structured your command chain, and how well your lieutenants interpret your intent.

## The Core Idea

Most strategy games give you omniscient control. You see everything, click everything, manage everything. Warchief inverts this. You have:

- **Limited visibility** — you see only what your lieutenants report to you
- **Imperfect communication** — orders are interpreted, not executed literally
- **A chain of command that actually matters** — the structure you build before battle determines how cleanly your intent propagates

The fog of war is *linguistic*. A poorly worded order, a distracted lieutenant, a gap in a troop's flowchart — these are the failure modes. Victory comes from clarity of thought, good org design, and adaptive communication under pressure.

## The Architecture

```
YOU (human, natural language only)
        ↓  messages, orders, speeches
LIEUTENANTS (LLM agents — reason, plan, write troop logic)
        ↓  structured flowchart directives
TROOPS (flowchart agents — fast, deterministic, programmable)
        ↓
SIMULATION (stats, physics, combat resolution)
```

### Lieutenants

Lieutenants are LLM instances. They receive your orders and translate them into action. Their primary output is **structured flowchart directives** — a domain-specific language that compiles into the event system powering their troops.

A good lieutenant:
- Interprets your intent, not just your words
- Writes clean, comprehensive flowcharts for their squads
- Maintains situational awareness and reports up the chain
- Coordinates laterally with peer lieutenants when pre-authorized

A struggling lieutenant:
- Writes incomplete flowcharts with unhandled edge cases
- Over-reports or under-reports
- Freezes on ambiguous orders

### Troops

Troops are flowchart agents. They are fast, deterministic, and dumb. They execute exactly the logic their lieutenant compiled for them. They have stats (courage, discipline, speed, combat effectiveness) that modulate *how well* they execute — a low-courage unit might break formation even if the flowchart says hold.

### The Event System

The shared vocabulary between lieutenants and troops. Lieutenants write in it, troops run it.

```js
agent.on('enemy_spotted', (enemy) => { ... })
agent.on('under_attack', () => { ... })
agent.on('message', (msg) => { ... })
agent.on('flanked', () => { ... })
agent.moveTo(x, y)
agent.setFormation('wedge')
agent.emit('report', "contact on the left")
agent.requestSupport()
```

### Communication Graph

Before battle, you configure who can talk to who. Lieutenants can be authorized to communicate peer-to-peer, which lets them coordinate without routing through you. An unconfigured army means everything routes through you — you become the bottleneck.

```
YOU
 ├── Lt. A (left) ←→ Lt. B (center)
 │    ├── Squad 1
 │    └── Squad 2
 └── Lt. C (right)
      └── Squad 3
```

## The Pre-Battle Phase

Before battle begins, you have time to:

- **Appoint and brief lieutenants** — tell them their role, the terrain, the plan
- **Configure the communication graph** — who reports to who, who can talk sideways
- **Give speeches** — address squads or the full army, affecting morale
- **Review lieutenant flowcharts** — see what logic they've written for their troops

## The Battle Phase

Time flows. You cannot pause. You communicate in real-time:

- Short orders to specific lieutenants
- Army-wide broadcasts
- Reactive responses to incoming reports

You watch the battlefield through a top-down view. You see what your lieutenants see — aggregated up the chain. The flowcharts of active units are visible as live-executing graphs: the current node glows, branches light up as decisions are made.

## Why This Is Interesting

**Strategy expression is linguistic.** How clearly you think and communicate is the skill. This is different from APM (actions per minute) — it rewards intent, clarity, and good org design.

**Failure is legible.** When something goes wrong, you can see exactly where. The lieutenant's flowchart shows which branch they took. The troop's event log shows what triggered. Post-battle review is a genuine learning experience.

**Lieutenants have personality.** An aggressive lieutenant interprets "take the ridge" as a charge. A cautious one flanks first. You learn your commanders and work with their tendencies.

**Scaling is natural.** 100 units feels like commanding a company. 1000 units feels like commanding an army — you're further from the action, more dependent on your lieutenants' judgment, and a single miscommunication can cascade.

## Tech Stack

- **Frontend:** React, Monaco editor (in-game code editing), Phaser.js or Canvas (battlefield)
- **Backend:** Node.js or Python, sim loop, LLM orchestration
- **LLM:** Claude API for lieutenant agents
- **Simulation:** Custom — 2D top-down, stat-based combat resolution
