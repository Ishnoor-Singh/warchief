# CLAUDE.md

This file is for Claude Code instances working on Warchief. Read this before touching any code.

**IMPORTANT:** Keep this file and `docs/` updated when you change game mechanics, stats, or formulas. The documentation in `docs/` and `client/src/components/InstructionsScreen.tsx` must always match the code. If you change a number, update it everywhere.

## What You're Building

A real-time battle strategy game where the player commands an army entirely through natural language. The player talks to LLM-powered lieutenants, who write structured flowchart logic for their troops. The troops execute that logic in a running simulation.

The player never directly controls units. They only communicate.

## Architecture Overview

```
Player (text) → Lieutenant LLMs → Structured flowchart output → Troop agents → Simulation
```

Three distinct layers:
1. **Communication layer** — LLM inference, message routing, org graph
2. **Flowchart runtime** — event system, flowchart compiler, agent execution
3. **Simulation layer** — 2D physics, combat stats, visibility/fog of war, terrain, morale

Keep these layers clean. They should communicate through defined interfaces only.

## Repository Structure

```
/client          React frontend
  /components    All React UI components (battlefield, panels, screens)
  /types         Client-side TypeScript types

/src/server
  /sim           Simulation loop, combat resolution, scenarios
  /agents        Lieutenant LLM instances, AI commander, agent state
    - coordinator.ts    Game coordinator (reinvocation orchestration)
    - reinvocation.ts   Lieutenant re-invocation trigger system
  /runtime       Flowchart compiler + event runtime
  /comms         Agent communication infrastructure
    - message-bus.ts    Typed, prioritized pub-sub for agent-to-agent comms
  /engine        Core game engine modules:
    - vec2.ts           Vector math
    - unit-types.ts     Unit definitions, presets, factories
    - combat.ts         Base damage, death, squad tracking, win condition
    - combat-modifiers.ts  Formation modifiers, flanking, charge momentum
    - morale.ts         Morale routing, panic cascades, recovery
    - terrain.ts        Terrain features (hill, forest, river), modifiers
    - formations.ts     Formation slot positioning
    - movement.ts       Agent movement, pursuit, arrival
    - spatial.ts        Spatial indexing (Matter.js backed)
    - conditions.ts     Safe condition evaluation (no eval)
    - stalemate.ts      Stalemate detection and escalation

/src/shared
  /types         Shared TypeScript types
  /events        Event vocabulary definitions

/docs            Game mechanics documentation (KEEP UPDATED)
  - combat-mechanics.md   Damage formula, modifiers, application order
  - morale-and-routing.md Morale system, routing checks, panic cascades
  - terrain.md            Terrain types, modifiers, combos
  - unit-stats.md         All unit stats, presets, stat tables
  - formations.md         Formation types, combat modifiers, tactical tips
```

## Documentation Requirements

When you change any game mechanic, stat value, or formula, you MUST update:
1. The relevant file in `docs/`
2. `client/src/components/InstructionsScreen.tsx` (public-facing in-game guide)
3. This file (`CLAUDE.md`) if the change affects architecture or high-level design

## The Event System

This is the core primitive. Every troop agent runs on this. Lieutenants write in this vocabulary. It must be stable — do not change event names or action signatures without updating all dependent schemas and prompts.

### Events (inputs to an agent)
```ts
enemy_spotted: { enemyId: string, position: Vec2, distance: number }
under_attack: { attackerId: string, damage: number }
flanked: { direction: 'left' | 'right' | 'rear' }  // fires on side/rear attacks
message: { from: string, content: string }
ally_down: { unitId: string, position: Vec2 }
casualty_threshold: { lossPercent: number }
order_received: { order: string, from: string }
tick: { tick: number }
arrived: { position: Vec2 }
no_enemies_visible: {}
```

### Actions (outputs from an agent)
```ts
moveTo(position: Vec2)
setFormation(type: FormationType)
engage(targetId: string)
fallback(position: Vec2)
hold()
requestSupport(message: string)
emit('report', message: string)
emit('alert', message: string)
```

### Formation Types
`line | wedge | scatter | pincer | defensive_circle | column`

## Simulation Loop

Runs at 10 ticks/second. Each tick:
1. Update visibility and queue `enemy_spotted` / `no_enemies_visible` events (every 10 ticks)
2. Process flowchart events for each agent (skip routing units)
3. Maintain formations (reposition non-engaged troops around their lieutenant)
4. Move agents toward targets (with terrain speed modifiers)
5. Separate overlapping units
6. Resolve combat (with formation, flanking, terrain, and charge modifiers)
7. Check morale and trigger routing
8. Recover morale for out-of-combat units
9. Check win condition
10. Track moving agents (for charge momentum detection)
11. **Stalemate detection and escalation**
12. Fire callbacks

LLM calls are async and non-blocking. Lieutenants continue running their current flowchart until new output arrives.

## Message Bus

Central typed pub-sub system for all agent-to-agent communication (`/src/server/comms/message-bus.ts`).

```
Troop → Lieutenant: support_request, troop_report, troop_alert
Lieutenant ↔ Lieutenant: peer_message
Simulation → All: stalemate_warning (broadcast)
```

Messages are prioritized (higher = processed first). Broadcasts (`to: null`) deliver to all subscribers except the sender. The bus is drained per-agent when building lieutenant context for LLM calls.

## Stalemate Detection

Tracks ticks since last combat damage (`/src/server/engine/stalemate.ts`):
- **Warning (100 ticks / 10s)**: broadcasts `stalemate_warning` to all lieutenants via message bus
- **Force advance (200 ticks / 20s)**: forces all troops to advance toward map center

Any combat damage resets the tracker.

## Lieutenant Re-invocation

Lieutenants are not fire-and-forget. The re-invocation system (`/src/server/agents/reinvocation.ts`) tracks significant events and triggers LLM re-calls:

| Trigger | Threshold | Cooldown |
|---------|-----------|----------|
| Troop casualties | 3 deaths | 50 ticks (5s) |
| Support requests | 2 requests | 50 ticks (5s) |
| Peer message arrival | 1 message | 50 ticks (5s) |
| Stalemate warning | 1 event | 50 ticks (5s) |
| Idle (no LLM call) | 150 ticks (15s) | N/A |

The game coordinator (`/src/server/agents/coordinator.ts`) orchestrates this — tracking events, determining which lieutenants need re-invocation, and building enriched context with peer state and bus messages.

## Lieutenant Prompt Context

When a lieutenant LLM is called, the prompt includes:
- Identity, personality, stats
- Current orders
- Units under command (position, health, morale)
- Visible enemies
- **Peer Status**: each authorized peer's position, troop count, morale, and current action
- **Incoming Messages**: pending bus messages (support requests, peer comms, alerts)
- Terrain description
- Recent message history
- Event/action vocabulary + output schema

## Combat System

### Base Damage
```
damage = BASE_DAMAGE (10) × (attacker_combat / defender_combat) × (1 ± 20% variance)
```
Minimum 1 damage. See `docs/combat-mechanics.md` for full details.

### Modifier Application Order
1. Base damage (stat ratio + variance)
2. Formation attack/defense multipliers
3. Flanking multiplier (1.0x front, 1.3x side, 1.6x rear)
4. Terrain defense multiplier (defender's position)
5. Charge bonus (additive, first hit only)
6. Minimum 1 damage floor

### Formation Combat Modifiers
| Formation | Attack | Defense |
|-----------|--------|---------|
| line | 1.0x | 1.0x |
| wedge | 1.3x | 0.8x |
| defensive_circle | 0.7x | 1.4x |
| scatter | 0.85x | 1.15x |
| pincer | 1.2x | 0.9x |
| column | 0.6x | 0.7x |

### Terrain Modifiers
| Terrain | Defense | Speed | Visibility | Concealment |
|---------|---------|-------|------------|-------------|
| hill | 0.75x (less dmg) | 0.85x | +20 | 1.0x |
| forest | 0.80x (less dmg) | 0.70x | -10 | 0.5x |
| river | 1.40x (MORE dmg) | 0.45x | 0 | 1.0x |

### Morale & Routing
- Morale: 0-100, starts at 100
- Ally death within 50 units: -5 morale
- Routing panic within 40 units: -8 morale
- Routing check when morale < 40: `chance = (1 - morale/40) × (1 - courage/12)`
- Routing units flee toward spawn, spread panic, ignore flowchart
- Recovery: +0.5/tick when out of combat. Routing stops at morale 50.

## Stats

### Troop stats
- `combat` (1-10): attack/defense effectiveness
- `speed`: movement rate in units/tick. Affected by terrain.
- `courage` (1-10): resistance to routing when morale drops
- `discipline` (1-10): how precisely they execute flowchart logic

### Lieutenant stats
- `initiative` (1-10): likelihood of acting without explicit orders
- `discipline` (1-10): how literally they interpret orders
- `communication` (1-10): quality/frequency of reports upward
- `personality`: aggressive | cautious | disciplined | impulsive

### Unit Presets
| Preset | Combat | Speed | Courage | Discipline |
|--------|--------|-------|---------|------------|
| infantry | 5 | 2 | 5 | 5 |
| scout | 3 | 4 | 4 | 4 |
| vanguard | 8 | 1.5 | 7 | 6 |
| archer | 4 | 2 | 4 | 8 |
| berserker | 9 | 3 | 3 | 2 |
| guardian | 6 | 1.5 | 9 | 8 |
| militia | 3 | 2 | 3 | 3 |

## Visibility

Each agent has a visibility radius. Troops: 60 units. Lieutenants: 150 units.

Terrain modifies visibility:
- Hills: +20 bonus to viewer
- Forests: 0.5x concealment (harder to spot units in forests)

The player's battlefield view is an aggregate of all lieutenant visibility zones — not omniscient.

## Lieutenant Output Schema

Lieutenants output structured JSON only. This is what gets compiled into the runtime. Validate all output before compiling.

```ts
type LieutenantOutput = {
  directives: FlowchartDirective[]
  self_directives?: FlowchartDirective[]
  message_up?: string
  message_peers?: { to: string, content: string }[]
}
```

## Key Design Rules

1. **The player never directly controls units.** All commands go through the communication layer.
2. **Lieutenants interpret, they don't relay.** They should exercise judgment, not just forward orders.
3. **Flowcharts must have fallbacks.** Any unhandled event should fall to a default behavior (hold position, report up).
4. **Keep LLM calls minimal.** Only call lieutenant LLMs when they have new input. Troops never call LLMs.
5. **Fail gracefully.** Malformed lieutenant output → validate, reject, request retry with error context. Don't crash the sim.
6. **Stats are meaningful.** Every stat affects gameplay. Courage prevents routing, combat affects damage, speed affects charge bonus and movement.
7. **Terrain matters.** Hills, forests, and rivers create tactical depth. Scenarios should use terrain features.
8. **Morale creates drama.** Routing cascades should be possible — they create memorable moments and reward good positioning.

## What Not To Build Yet

- Multiplayer (single player vs AI commander for MVP)
- Economy or resource management
- Unit production or base building
- More than 3 lieutenants, ~100 units total
- Procedural terrain (use fixed map scenarios for MVP)
