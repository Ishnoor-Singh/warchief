# CLAUDE.md

This file is for Claude Code instances working on Warchief. Read this before touching any code.

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
3. **Simulation layer** — 2D physics, combat stats, visibility/fog of war

Keep these layers clean. They should communicate through defined interfaces only.

## Repository Structure

```
/convex                 Convex backend (serverless functions + DB schema)
  /schema.ts            Database schema
  /games.ts             Game mutations + queries
  /tick.ts              Simulation tick (scheduled internal mutation)
  /llm.ts               LLM actions (Anthropic API calls)
  /gameLogic/            Pure game logic (no Convex dependency)
    /types.ts            Core types
    /events.ts           Event vocabulary
    /flowchart.ts        Flowchart runtime
    /simulation.ts       Simulation loop
    /scenario.ts         Scenario builders
    /validation.ts       Zod schema validation
    /inputBuilder.ts     Lieutenant prompt building
    /compiler.ts         Flowchart compilation
    /aiCommander.ts      AI commander logic
    /lieutenant.ts       Lieutenant types/helpers

/client                 React frontend (deployed on Vercel)
  /src/components/      UI components (BattlefieldCanvas, MessagePanel, etc.)
  /src/App.tsx           Main app (uses Convex hooks)
  /src/main.tsx          Entry point (ConvexProvider)
  /src/types/            Client-side types
```

## The Event System

This is the core primitive. Every troop agent runs on this. Lieutenants write in this vocabulary. It must be stable — do not change event names or action signatures without updating all dependent schemas and prompts.

### Events (inputs to an agent)
```ts
enemy_spotted: { enemyId: string, position: Vec2, distance: number }
under_attack: { attackerId: string, damage: number }
flanked: { direction: 'left' | 'right' | 'rear' }
message: { from: string, content: string }
ally_down: { unitId: string, position: Vec2 }
casualty_threshold: { lossPercent: number }
order_received: { order: string, from: string }
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

## Lieutenant Output Schema

Lieutenants output structured JSON only. This is what gets compiled into the runtime. Validate all output before compiling.

```ts
type LieutenantOutput = {
  directives: FlowchartDirective[]   // for troops
  self_directives?: FlowchartDirective[]  // lieutenant's own behavior
  message_up?: string                // report to commander
  message_peers?: { to: string, content: string }[]  // peer comms
}

type FlowchartDirective = {
  unit: string | 'all' | 'squad_*'
  nodes: FlowchartNode[]
}

type FlowchartNode = {
  id: string
  on: string           // event name
  condition?: string   // simple expression, e.g. "distance < 50"
  action: string       // action name
  params?: object
  next?: string        // node id to chain to
  else?: string        // node id if condition fails
}
```

## Lieutenant System Prompt Structure

Each lieutenant instance gets a system prompt with:
- Identity (name, rank, personality trait — one of: aggressive, cautious, disciplined, impulsive)
- Stats (initiative 1-10, discipline 1-10, communication 1-10)
- Current orders (from commander)
- Visible units under command (their positions, health, morale)
- Peer lieutenants they're authorized to contact
- Terrain context (brief description)
- Last N messages received

They must respond with valid `LieutenantOutput` JSON. Include a system prompt section that specifies this and shows the schema explicitly. Always validate.

## Simulation Loop

Runs at 10 ticks/second via Convex scheduled mutations. Each tick:
1. Read full game state from single Convex document
2. Process all pending events for each agent
3. Execute flowchart transitions
4. Resolve combat (stat-based)
5. Update visibility per agent
6. Write updated state back to Convex (triggers reactive client queries)
7. Schedule next tick via `ctx.scheduler.runAfter()`
8. Schedule AI commander LLM calls every 50 ticks (via Convex actions)

LLM calls are Convex actions (async, non-blocking). Lieutenants continue running their current flowchart until new output arrives.

## Stats

### Troop stats
- `combat`: attack/defense effectiveness (1-10)
- `speed`: movement rate
- `courage`: threshold before breaking formation (1-10)
- `discipline`: how precisely they execute flowchart logic (1-10)

### Lieutenant stats
- `initiative`: likelihood of acting without explicit orders
- `discipline`: how literally they interpret orders
- `communication`: quality/frequency of reports upward

Stats modulate behavior — they do not override flowchart logic directly. A `courage: 3` unit might break from `hold()` if `under_attack` triggers repeatedly. Model this as a probability check, not a hard override.

## Visibility

Each agent has a visibility radius. Troops report to their lieutenant. Lieutenants aggregate and report to the player. The player's battlefield view is an aggregate of all lieutenant visibility zones — not omniscient.

This is important. Do not give the player full map visibility.

## Key Design Rules

1. **The player never directly controls units.** All commands go through the communication layer.
2. **Lieutenants interpret, they don't relay.** They should exercise judgment, not just forward orders.
3. **Flowcharts must have fallbacks.** Any unhandled event should fall to a default behavior (hold position, report up).
4. **Keep LLM calls minimal.** Only call lieutenant LLMs when they have new input. Troops never call LLMs.
5. **Fail gracefully.** Malformed lieutenant output → validate, reject, request retry with error context. Don't crash the sim.

## What Not To Build Yet

- Multiplayer (single player vs AI commander for MVP)
- Economy or resource management
- Unit production or base building
- More than 3 lieutenants, ~100 units total
- Procedural terrain (use fixed maps for MVP)
