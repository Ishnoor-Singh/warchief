# Warchief Architecture

Warchief is a real-time battle strategy game where the player commands an army entirely through natural language. The player talks to LLM-powered lieutenants, who write structured flowchart logic for their troops. The troops execute that logic in a running simulation.

The player never directly controls units. They only communicate.

```
Player (text) --> Lieutenant LLMs --> Structured flowchart output --> Troop agents --> Simulation
```

---

## Table of Contents

1. [Three-Layer Architecture](#three-layer-architecture)
2. [Repository Structure](#repository-structure)
3. [Server Architecture](#server-architecture)
4. [Client Architecture](#client-architecture)
5. [Data Flow](#data-flow)
6. [Simulation Tick Cycle](#simulation-tick-cycle)
7. [Flowchart Runtime](#flowchart-runtime)
8. [Agent System](#agent-system)
9. [Communication Infrastructure](#communication-infrastructure)
10. [Performance](#performance)
11. [Non-Blocking LLM Integration](#non-blocking-llm-integration)

---

## Three-Layer Architecture

The system is organized into three distinct layers that communicate through defined interfaces only.

```
+------------------------------------------------------------------+
|                    COMMUNICATION LAYER                            |
|  LLM inference, message routing, org graph                       |
|  (src/server/agents/, src/server/comms/)                         |
+------------------------------------------------------------------+
                              |
                    structured JSON output
                              |
+------------------------------------------------------------------+
|                    FLOWCHART RUNTIME                              |
|  Event system, flowchart compiler, agent execution               |
|  (src/server/runtime/, src/shared/events/)                       |
+------------------------------------------------------------------+
                              |
                      GameAction outputs
                              |
+------------------------------------------------------------------+
|                    SIMULATION LAYER                               |
|  2D physics, combat stats, visibility, terrain, morale           |
|  (src/server/sim/, src/server/engine/)                           |
+------------------------------------------------------------------+
```

### Layer Responsibilities

**Communication Layer** -- Handles all LLM interactions. Lieutenants receive orders from the player (or AI commander), battlefield context is assembled into prompts, LLM output is parsed and validated via Zod schemas, and the resulting structured directives are handed to the flowchart compiler. The message bus routes typed messages between agents.

**Flowchart Runtime** -- Compiles lieutenant directives into executable flowcharts (directed graphs of condition/action nodes). Each troop agent owns a `FlowchartRuntime` instance that processes incoming game events and emits `GameAction` outputs. Flowcharts are deterministic and fast -- no LLM calls happen at this layer.

**Simulation Layer** -- Runs the 2D battle at 10 ticks/second. Handles movement, combat resolution, visibility, terrain modifiers, morale cascades, formation maintenance, stalemate detection, and win conditions. All game mechanics live in the engine module as pure, testable functions.

---

## Repository Structure

```
/client                        React frontend (Vite + TypeScript)
  /src
    App.tsx                    Main app shell, game phase routing
    /components                All React UI components
      BattlefieldCanvas.tsx    Canvas-based battlefield renderer
      MessagePanel.tsx         Player-lieutenant chat interface
      FlowchartPanel.tsx       Flowchart visualization (read-only)
      FlowchartEditor.tsx      Visual flowchart editing
      PreBattleScreen.tsx      War Room (briefing + army preview)
      SetupScreen.tsx          API key, model, game mode selection
      LandingScreen.tsx        Title screen
      EndScreen.tsx            Post-battle results + summary
      InstructionsScreen.tsx   In-game guide (must match docs/)
      FormationPlayground.tsx  Interactive formation testing
      MapPreview.tsx           Scenario map preview
      ArmyStrengthHUD.tsx      Live army health/morale bars
      BattleEventTicker.tsx    Scrolling battle event feed
    /hooks
      useWebSocket.ts          WebSocket connection management
    /types
      index.ts                 Client-side TypeScript types

/src/server
  index.ts                     WebSocket + HTTP server, session management
  /sim
    simulation.ts              Core simulation loop (10 ticks/sec)
    scenario.ts                Pre-built army configurations
  /agents
    lieutenant.ts              Lieutenant LLM agent instances
    ai-commander.ts            AI commander (enemy or player in ai_vs_ai)
    coordinator.ts             Reinvocation orchestration
    reinvocation.ts            Reinvocation trigger system
    memory.ts                  Agent working memory (beliefs + observations)
    memory-recorder.ts         Auto-records battle events as observations
    compiler.ts                Compiles LLM directives to flowcharts
    schema.ts                  Zod validation for LLM output
    input-builder.ts           Constructs LLM system prompts
  /runtime
    flowchart.ts               Flowchart compiler + event runtime
  /comms
    message-bus.ts             Typed, prioritized pub-sub
  /engine
    index.ts                   Barrel export for all engine modules
    vec2.ts                    Vector math (distance, normalize, etc.)
    unit-types.ts              Unit definitions, presets, factories
    combat.ts                  Base damage, death, squad tracking, win condition
    combat-modifiers.ts        Formation modifiers, flanking, charge momentum
    morale.ts                  Morale routing, panic cascades, recovery
    terrain.ts                 Terrain features, modifiers, visibility
    formations.ts              Formation slot positioning (6 types)
    movement.ts                Agent movement, pursuit, arrival
    spatial.ts                 Spatial indexing (Matter.js backed)
    conditions.ts              Safe condition evaluation (no eval)
    stalemate.ts               Stalemate detection and escalation
    event-detection.ts         Expanded event detection

/src/shared
  /types
    index.ts                   Core types (Vec2, AgentState, BattleState, etc.)
  /events
    index.ts                   Event/action type definitions

/docs                          Game mechanics documentation
  combat-mechanics.md          Damage formula, modifiers, application order
  morale-and-routing.md        Morale system, routing checks, panic cascades
  terrain.md                   Terrain types, modifiers, combos
  unit-stats.md                All unit stats, presets, stat tables
  formations.md                Formation types, combat modifiers
  architecture.md              This file
```

---

## Server Architecture

### Entry Point: `src/server/index.ts`

The server is an Express + WebSocket application. Each connected client gets a `GameSession` with isolated state:

```ts
interface GameSession {
  ws: WebSocket;
  apiKey: string | null;
  model: string;
  simulation: SimulationState | null;
  lieutenants: Lieutenant[];             // Player's lieutenants
  enemyLieutenants: Lieutenant[];        // Enemy LLM lieutenants
  aiCommander: AICommander | null;       // Enemy AI commander
  playerAICommander: AICommander | null; // Player AI commander (ai_vs_ai)
  gameMode: GameMode;                    // 'human_vs_ai' | 'ai_vs_ai'
  timer: NodeJS.Timeout | null;
  anthropicClient: LLMClient | null;
  aiCommanderInterval: number;
  speed: number;                         // 0.5x, 1x, 2x
  coordinator: GameCoordinator | null;   // Reinvocation coordinator
}
```

The server handles WebSocket messages for: API key validation, scenario initialization, battle start/pause/resume, speed changes, player orders, and manual flowchart edits. The battle loop runs via `setInterval` at `100ms / speed`, calling `simulationTick()` synchronously and handling all async operations (LLM calls, event routing, state broadcasting) around it.

### Simulation State: `src/server/sim/simulation.ts`

The `SimulationState` is the central data structure holding all battle state:

```ts
interface SimulationState {
  battle: BattleState;                   // Agents, tick count, map size, winner
  runtimes: Map<string, FlowchartRuntime>;  // Per-agent flowchart executors
  terrain: TerrainMap;                   // Hills, forests, rivers
  spatialWorld: SpatialWorld;            // Matter.js spatial index
  messageBus: MessageBus;               // Agent-to-agent communication
  stalemateTracker: StalemateTracker;    // No-combat timer
  terrainTracker: TerrainTracker;        // Per-agent terrain transitions
  squadMemberCache: Map<string, string[]>;  // Cached squad lookups
  squadCacheDirty: boolean;             // Dirty flag for cache invalidation
  pendingFlowchartSwaps: Array<{...}>;  // Atomic swap queue from async LLM
  pendingBattleEvents: BattleEvent[];   // Client-bound event feed
  wasMovingLastTick: Set<string>;       // Charge momentum tracking
  chargeApplied: Set<string>;           // One-time charge bonus tracking
  lastCombat: Map<string, number>;      // Per-agent last combat tick
  activeEngagements: Set<string>;       // Currently engaged agent pairs
  squadCasualties: Map<string, {...}>;  // Per-squad death counts
}
```

### Scenarios: `src/server/sim/scenario.ts`

Pre-built army configurations with defined layouts:

- **Basic**: 3 player squads vs 3 enemy squads (30v30), open field
- **Assault**: Asymmetric forces with terrain features
- **River Crossing**: Terrain-heavy scenario with rivers and forests

Layout convention: armies face each other horizontally. Player spawns on the left (x=50), enemy on the right (x=350). Lieutenants position behind their troops. Formations are applied before battle start via `applyInitialFormations()`.

### Engine Modules: `src/server/engine/`

All game mechanics are implemented as pure functions in dedicated modules, each with co-located test files. Everything is re-exported through `src/server/engine/index.ts`.

| Module | Responsibility | Key Exports |
|--------|---------------|-------------|
| `vec2.ts` | Vector math | `distance`, `normalize`, `moveToward`, `lerp`, `rotate`, `clamp` |
| `unit-types.ts` | Unit definitions | `createTroop`, `createLieutenant`, `createSquad`, `TROOP_PRESETS`, `LIEUTENANT_PRESETS` |
| `combat.ts` | Damage and death | `calculateDamage`, `applyDamage`, `findCombatPairs`, `checkWinCondition`, `buildSquadCasualties` |
| `combat-modifiers.ts` | Tactical multipliers | `getFormationModifiers`, `calculateFlankingMultiplier`, `calculateChargeBonusDamage` |
| `morale.ts` | Morale and routing | `shouldRout`, `applyRoutingPanic`, `checkMoraleRecovery` |
| `terrain.ts` | Terrain effects | `getTerrainModifiers`, `getEffectiveVisibilityRadius`, `getTerrainAt`, `createTerrainMap` |
| `formations.ts` | Formation positioning | `computeFormationSlot`, `computeFormationPositions` |
| `movement.ts` | Movement and speed | `getSpeed`, `computeMovementTick`, `updateAllMovement`, `getVisibleEnemies` |
| `spatial.ts` | Spatial queries | `createSpatialWorld`, `queryRange`, `queryPairsInRange`, `destroySpatialWorld` |
| `conditions.ts` | Safe expression eval | `evaluateCondition` (no `eval()`, supports `<`, `>`, `==`, `&&`, `||`) |
| `stalemate.ts` | Stalemate detection | `checkStalemate`, `recordCombat`, `createStalemateTracker` |
| `event-detection.ts` | Expanded events | `detectFormationBroken`, `detectMoraleLow`, `detectEnemyRetreating`, `detectTerrainTransition` |

---

## Client Architecture

### React SPA

The client is a React single-page application built with Vite. It communicates with the server exclusively via a single WebSocket connection managed by the `useWebSocket` hook.

### Game Phases

The client tracks a `GamePhase` state machine:

```
landing --> setup --> pre-battle (War Room) --> battle --> post-battle
              |                                              |
              v                                              |
         instructions                                   (restart)
              |
              v
         playground
```

| Phase | Screen Component | Purpose |
|-------|-----------------|---------|
| `landing` | `LandingScreen` | Title screen, start button |
| `setup` | `SetupScreen` | API key entry, model selection, game mode (human_vs_ai / ai_vs_ai) |
| `pre-battle` | `PreBattleScreen` | War Room: scenario picker, lieutenant briefing, army preview |
| `battle` | Main layout (composite) | Live battle with canvas, chat, flowcharts, HUD |
| `post-battle` | `EndScreen` | Victory/defeat screen, detailed battle summary |
| `instructions` | `InstructionsScreen` | Full game mechanics reference (must match docs/) |
| `playground` | `FormationPlayground` | Interactive formation testing sandbox |

### Battle Screen Layout

During the battle phase, the screen is composed of multiple components:

```
+-----------------------------------------------+
|  ArmyStrengthHUD (top bar)                    |
+-------------------+---------------------------+
|                   |                           |
| BattlefieldCanvas | MessagePanel              |
| (canvas renderer) | (player-lieutenant chat)  |
|                   |                           |
+-------------------+---------------------------+
| FlowchartPanel    | BattleEventTicker         |
| (current logic)   | (scrolling battle feed)   |
+-------------------+---------------------------+
```

- **BattlefieldCanvas**: Canvas-based 2D renderer showing unit positions, health bars, formations, terrain features, and fog of war. Only renders what the player's lieutenants can see.
- **MessagePanel**: Chat interface for sending orders to lieutenants and receiving responses. Supports lieutenant selection for targeted commands.
- **FlowchartPanel**: Read-only visualization of current flowchart logic per lieutenant.
- **ArmyStrengthHUD**: Real-time health and morale bars for both armies.
- **BattleEventTicker**: Scrolling feed of battle events (kills, retreats, engagements, stalemate warnings).

### WebSocket Communication

**Client --> Server messages:**
- `set_api_key` -- Validate and store API key
- `select_scenario` -- Choose battle scenario (basic, assault, river_crossing)
- `briefing` -- Player orders to a lieutenant
- `start_battle` / `pause_battle` / `resume_battle`
- `set_speed` -- Change simulation speed (0.5x, 1x, 2x)
- `edit_flowchart` -- Manual flowchart modifications

**Server --> Client messages:**
- `battle_state` -- Visibility-filtered state snapshot (every 5 ticks / 2 per second)
- `battle_event` -- Kill, retreat, engagement, stalemate events for the ticker
- `flowchart` -- Updated flowchart visualization after LLM response
- `message` -- Lieutenant responses (briefing replies and proactive messages)
- `battle_end` -- Winner + `DetailedBattleSummary`
- `battle_ready` -- Scenario loaded, ready to start
- `error` -- Error messages

---

## Data Flow

### Complete Order-to-Action Pipeline

```
 PLAYER                 SERVER                              SIMULATION
   |                      |                                      |
   |  "Attack the hill"   |                                      |
   |--------------------->|                                      |
   |                      |                                      |
   |              +-------v--------+                             |
   |              | input-builder  |  Build prompt with:         |
   |              | .ts            |  - Identity, personality    |
   |              |                |  - Current orders           |
   |              |                |  - Visible units/enemies    |
   |              |                |  - Peer state               |
   |              |                |  - Bus messages             |
   |              |                |  - Working memory           |
   |              |                |  - Terrain description      |
   |              +-------+--------+                             |
   |                      |                                      |
   |              +-------v--------+                             |
   |              | Anthropic API  |  LLM generates structured   |
   |              | (async)        |  JSON output                |
   |              +-------+--------+                             |
   |                      |                                      |
   |              +-------v--------+                             |
   |              | schema.ts      |  Zod validation of output   |
   |              | (validate)     |                              |
   |              +-------+--------+                             |
   |                      |                                      |
   |              +-------v--------+                             |
   |              | compiler.ts    |  Resolve unit patterns,     |
   |              | (compile)      |  convert to Flowchart[]     |
   |              +-------+--------+                             |
   |                      |                                      |
   |              +-------v-----------------+                    |
   |              | queueFlowchartSwap()    |  Queue for atomic  |
   |              | (pendingFlowchartSwaps) |  application       |
   |              +-------+-----------------+                    |
   |                      |                                      |
   |                      |  ---- next tick boundary ----        |
   |                      |                                      |
   |                      |              +-------v-----------+   |
   |                      |              | Apply swaps       |   |
   |                      |              | (tick start)      |   |
   |                      |              +-------+-----------+   |
   |                      |                      |               |
   |                      |              +-------v-----------+   |
   |                      |              | processEvents()   |   |
   |                      |              | (flowchart.ts)    |   |
   |                      |              +-------+-----------+   |
   |                      |                      |               |
   |                      |              +-------v-----------+   |
   |                      |              | executeAction()   |   |
   |                      |              | (simulation.ts)   |   |
   |                      |              +-------------------+   |
```

### Reinvocation Flow

```
Battle event occurs (kill, stalemate, support request, etc.)
  |
  v
Coordinator records event per lieutenant tracker
  |
  v
Each tick: tickCoordinator() advances idle counters
  |
  v
getLieutenantsNeedingReinvocation() checks thresholds:
  - casualties >= 3? (after 5s cooldown)
  - support_requests >= 2? (after 5s cooldown)
  - peer_message received? (after 5s cooldown)
  - stalemate_warning? (after 5s cooldown)
  - idle >= 15s? (no cooldown)
  |
  v
markLieutenantReinvoked() resets tracker immediately
  |
  v
reinvokeLieutenant() fires async (non-blocking):
  buildEnrichedContext() provides peer state + bus messages + terrain
  processOrder() calls LLM with "[REINVOCATION] Reassess..."
  |
  v
New flowcharts queued in pendingFlowchartSwaps[]
Applied atomically at start of next tick
```

### Memory Flow

```
Battle events (kills, retreats, squad wipes, engagements, stalemate warnings)
  |
  v
recordBattleEvents() in memory-recorder.ts
  Filters: only records events matching the lieutenant's team
  (stalemate_warning recorded for all teams)
  Maps event types to observation types:
    kill -> casualty, retreat -> routing, squad_wiped -> squad_wiped
    engagement -> engagement, casualty_milestone -> casualties
    stalemate_warning -> stalemate
  |
  v
recordObservation() appends to observations[] (max 20, FIFO eviction)
  |
  v
LLM output includes updated_beliefs -> setBelief() stores in memory.beliefs
  |
  v
buildMemorySummary() formats beliefs + observations for next LLM prompt
  |
  v
Lieutenant has full accumulated context of battle history on next call
```

### Lieutenant Output Schema

Lieutenants produce structured JSON that the compiler consumes:

```ts
type LieutenantOutput = {
  directives: FlowchartDirective[]          // Troop orders (required)
  self_directives?: FlowchartDirective[]    // Lieutenant's own movement
  message_up?: string                       // Report to commander
  message_peers?: { to: string, content: string }[]  // Peer coordination
  response_to_player?: string               // Proactive player message
  updated_beliefs?: Record<string, unknown> // Persist knowledge across calls
}
```

Each directive targets a unit or pattern and contains flowchart nodes:

```ts
type FlowchartDirective = {
  unit: string;  // "all" | "p_s1_*" (prefix wildcard) | specific unit ID
  nodes: FlowchartNodeInput[];
}
```

---

## Simulation Tick Cycle

The simulation runs at 10 ticks/second (100ms per tick). Each tick executes these steps in strict order:

```
simulationTick(state)
  |
  |-- 0. Apply pending flowchart swaps
  |       Drains pendingFlowchartSwaps[]
  |       Replaces runtime flowcharts atomically
  |       (Ensures no mid-tick mutation from async LLM callbacks)
  |
  |-- 1. Update visibility + queue events (every 10 ticks = 1/sec)
  |       For each alive agent:
  |         Spatial query for nearby enemies (terrain-aware radius)
  |         Hills: +20 visibility bonus to viewer
  |         Forests: 0.5x concealment (harder to spot units inside)
  |         Queue enemy_spotted (closest enemy) or no_enemies_visible
  |
  |-- 2. Detect expanded events (every 10 ticks = 1/sec)
  |       Per-lieutenant:
  |         formation_broken: <60% of squad alive and not routing
  |         morale_low: average squad morale < 40
  |       Per-agent:
  |         enemy_retreating: visible enemy is routing
  |         terrain_entered/terrain_exited: tracked via TerrainTracker
  |
  |-- 3. Process flowchart events per agent
  |       Queue tick event to every agent
  |       Skip routing units (routing overrides flowchart)
  |       processEvents() returns GameAction[]
  |       executeAction() applies each action to simulation state
  |
  |-- 4. Maintain formations
  |       For each lieutenant:
  |         Compute formation slots relative to lieutenant position + facing
  |         Reposition non-engaged troops to their assigned slot
  |       Uses squadMemberCache with dirty flag for efficiency
  |
  |-- 5. Move agents toward targets
  |       speed * terrain_speed_modifier per tick
  |       Hill: 0.85x, Forest: 0.70x, River: 0.45x
  |
  |-- 6. Sync spatial world + separate overlapping units
  |       Update all Matter.js body positions
  |       Push apart units within UNIT_MIN_SEPARATION (8 units)
  |       Push force: 0.6 units/tick
  |
  |-- 7. Resolve combat
  |       Find pairs within COMBAT_RANGE (15 units) via queryPairsInRange()
  |       Base damage: BASE_DAMAGE(10) * (attacker_combat / defender_combat)
  |       Variance: +/- 20%
  |       Modifier application order:
  |         1. Formation attack/defense multipliers
  |         2. Flanking multiplier (1.0x front, 1.3x side, 1.6x rear)
  |         3. Terrain defense multiplier (defender's position)
  |         4. Charge bonus (additive, first hit only)
  |         5. Minimum 1 damage floor
  |       Process deaths: emit ally_down events, record battle events
  |       Reset stalemate tracker on any damage dealt
  |
  |-- 8. Check morale + trigger routing
  |       Morale < 40: routing check
  |       Routing chance: (1 - morale/40) * (1 - courage/12)
  |       Routing units: flee toward spawn, spread panic
  |       Panic: -8 morale to allies within 40 units
  |
  |-- 9. Recover morale for out-of-combat units
  |       +0.5 morale/tick when not in combat
  |       Routing stops when morale recovers to 50
  |
  |-- 10. Check win condition
  |        Team loses when strength drops below WIN_THRESHOLD
  |
  |-- 11. Track charge momentum
  |        Record which agents moved this tick
  |        Charge bonus available on first hit if agent was moving last tick
  |
  |-- 12. Stalemate detection + escalation
  |        Increment ticksSinceLastCombat
  |        State machine: none -> warning -> force_advance
  |        100 ticks (10s): broadcast stalemate_warning via message bus
  |        200 ticks (20s): force all units to advance toward map center
  |        Any combat damage resets tracker to none
  |
  |-- 13. Fire onTick callback
```

### Server Tick Wrapper

The server wraps each tick with additional coordination logic:

```
setInterval (100ms / speed)
  |
  |-- simulationTick(state)               [synchronous]
  |
  |-- Drain and broadcast battle events   [synchronous]
  |     Send each event to client via WebSocket
  |     Feed to coordinator:
  |       kill events -> recordCasualty() for owning lieutenant
  |       stalemate_warning -> recordStalemateWarning() for all
  |     Feed to memory recorder:
  |       recordBattleEvents() for each lieutenant's memory
  |
  |-- Send filtered battle state          [synchronous, every 5 ticks]
  |     getFilteredStateForTeam('player') -> only what lieutenants can see
  |
  |-- AI Commander cycle                  [async, non-blocking]
  |     Runs at aiCommanderInterval ticks (configurable)
  |     generateCommanderOrders() -> orders for enemy lieutenants
  |     Also runs for player AI commander in ai_vs_ai mode
  |
  |-- Tick coordinator + reinvocation     [async, non-blocking]
  |     tickCoordinator() -> advance all idle counters
  |     getLieutenantsNeedingReinvocation() -> list of lieutenant IDs
  |     For each: reinvokeLieutenant() fire-and-forget
  |
  |-- Check for battle end                [synchronous]
  |     Clear timer, send detailed summary to client
```

---

## Flowchart Runtime

### Overview

The flowchart runtime (`src/server/runtime/flowchart.ts`) is the bridge between LLM-generated logic and simulation execution. Each troop and lieutenant agent has its own `FlowchartRuntime` instance.

### Data Model

```ts
interface FlowchartNode {
  id: string;
  on: EventType;              // Which event triggers this node
  condition?: string;         // Expression like "distance < 50"
  action: GameAction;         // What to do when triggered
  next?: string;              // Chain to another node after action
  else?: string;              // Branch if condition fails
  priority?: number;          // Higher priority checked first (default 0)
}

interface Flowchart {
  agentId: string;
  nodes: FlowchartNode[];
  defaultAction: GameAction;  // Fallback when no node matches
}

interface FlowchartRuntime {
  flowchart: Flowchart;
  currentNodeId: string | null;
  eventQueue: GameEvent[];
  pendingActions: GameAction[];
}
```

### Event Processing Algorithm

```
Event arrives (enemy_spotted, under_attack, tick, etc.)
  |
  v
Find all nodes where node.on === event.type
Sort by priority descending (higher priority first)
  |
  v
For each matching node (first match wins):
  |
  +-- Evaluate condition (safe evaluator, no eval())
  |   Supports: <, >, <=, >=, ==, !=, &&, ||
  |   Variables resolved from event data (e.g., "distance" from enemy_spotted)
  |   Empty/missing condition = always true
  |
  +-- If condition TRUE:
  |     Execute node's action
  |     Follow "next" chain (depth limit: 10 to prevent infinite loops)
  |       At each chained node: evaluate condition
  |       If true -> execute action, continue to next
  |       If false -> follow "else" branch if present
  |     Return all collected actions
  |
  +-- If condition FALSE:
        Follow "else" branch if present
        Otherwise try next matching node
  |
  v
No match? Use defaultAction for under_attack/enemy_spotted events only
Other event types with no match produce no actions
```

### Personality Default Flowcharts

When no briefing has been given, troops get personality-appropriate default flowcharts:

- **Aggressive**: Engage all spotted enemies, charge, advance when clear
- **Cautious**: Only engage close enemies (<40), hold far, request support at 20% casualties
- **Disciplined**: Engage medium range (<60), maintain line formation, advance ordered
- **Impulsive**: Charge all enemies, scatter on flank, rush forward constantly

Lieutenants also get default movement flowcharts so they advance with their troops rather than standing frozen at spawn.

### Event Vocabulary

**Input events (received by agents):**

| Event | Data Fields | Trigger Condition | Frequency |
|-------|-------------|-------------------|-----------|
| `enemy_spotted` | `enemyId`, `position`, `distance` | Enemy within visibility radius | 1/sec (every 10 ticks) |
| `under_attack` | `attackerId`, `damage` | Agent takes damage | Per hit |
| `flanked` | `direction` (left/right/rear) | Attack from side or rear | Per hit |
| `ally_down` | `unitId`, `position` | Nearby ally killed | Per death |
| `casualty_threshold` | `lossPercent` | Squad casualty milestones | Per milestone |
| `no_enemies_visible` | (none) | No enemies in visibility radius | 1/sec |
| `formation_broken` | `reason`, `intactPercent` | <60% of squad intact | 1/sec |
| `morale_low` | `averageMorale`, `lowestMorale` | Squad avg morale < 40 | 1/sec |
| `enemy_retreating` | `enemyId`, `position`, `distance` | Visible enemy is routing | 1/sec |
| `terrain_entered` | `terrainType`, `position` | Unit enters terrain feature | 1/sec |
| `terrain_exited` | `terrainType`, `position` | Unit leaves terrain feature | 1/sec |
| `tick` | `tick` | Every simulation tick | 10/sec |
| `arrived` | `position` | Reached target position | On arrival |
| `message` | `from`, `content` | Message received | On message |
| `order_received` | `order`, `from` | Order from commander | On order |

**Output actions (emitted by agents):**

| Action | Parameters | Simulation Effect |
|--------|-----------|-------------------|
| `moveTo` | `position: Vec2` | Set target position, begin movement |
| `setFormation` | `formation: FormationType` | Change formation (line/wedge/scatter/pincer/defensive_circle/column) |
| `engage` | `targetId: string` | Move toward and attack target enemy |
| `fallback` | `position: Vec2` | Retreat to specified position |
| `hold` | (none) | Clear target, stay in place |
| `requestSupport` | `message: string` | Send support request to lieutenant via message bus |
| `emit` | `eventType`, `message` | Send report or alert upward |

---

## Agent System

### Agent Hierarchy

```
+-----------------------+
|  Player (human)       |
|  or AI Commander      |
+----------+------------+
           | natural language orders
           v
+----------+------------+     peer messages     +---------------------+
|  Lieutenant A         |<--------------------->|  Lieutenant B       |
|  (LLM-powered)        |                       |  (LLM-powered)      |
|  personality, stats    |                       |  personality, stats  |
|  working memory        |                       |  working memory      |
+----------+------------+                       +----------+----------+
           | flowcharts (compiled from                     | flowcharts
           | structured LLM output)                        |
           v                                               v
    +------+------+                                 +------+------+
    | Troop  Troop |  (10 per squad typical)         | Troop  Troop |
    | Troop  Troop |  Deterministic flowchart        | Troop  Troop |
    | Troop  Troop |  executors. Never call LLMs.    | Troop  Troop |
    +--------------+                                 +--------------+
```

**Troops** are deterministic flowchart executors. They process events through their flowchart and output actions for the simulation. They never call LLMs. Their behavior is entirely determined by the flowchart their lieutenant compiled for them.

**Lieutenants** are LLM-powered agents with persistent identity:
- Personality (aggressive, cautious, disciplined, impulsive) affects order interpretation
- Stats (initiative, discipline, communication) modulate prompt behavior
- Working memory accumulates beliefs and observations across calls
- Can communicate with peers, report upward, and proactively message the player
- Produce structured JSON output validated via Zod before compilation

**AI Commander** generates strategic orders for its team's lieutenants. It observes the battlefield from the team's perspective and produces orders at a configurable interval. Personality styles: aggressive (overwhelming force), cautious (defensive), balanced (adaptive).

### Lieutenant: `src/server/agents/lieutenant.ts`

```ts
interface Lieutenant {
  id: string;
  name: string;
  personality: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
  stats: { initiative: number; discipline: number; communication: number };
  troopIds: string[];           // IDs of troops under command
  authorizedPeers: string[];    // IDs of peer lieutenants allowed to message
  messageHistory: RecentMessage[];
  busy: boolean;                // Prevents double-triggering during LLM calls
  lastOutput: LieutenantOutput | null;
  memory: AgentMemory;          // Persistent beliefs + observations
}
```

### LLM Prompt Context: `src/server/agents/input-builder.ts`

When a lieutenant LLM is called, the prompt includes:

```ts
interface LieutenantContext {
  identity: LieutenantIdentity;           // Name, personality, stats
  currentOrders: string;                   // Latest orders from player/commander
  visibleUnits: VisibleUnitInfo[];         // Troops under command (position, health, morale)
  visibleEnemies?: VisibleEnemyInfo[];     // Enemies within visibility radius
  authorizedPeers: string[];               // Peer lieutenant IDs
  terrain: string;                         // Terrain description
  recentMessages: RecentMessage[];         // Message history
  peerStates?: PeerStateInfo[];            // Peer position, troop count, morale, action
  pendingBusMessages?: PendingBusMessageInfo[];  // Unread bus messages
  memorySummary?: string;                  // Formatted beliefs + observations
}
```

The prompt also includes:
- Personality-specific guidance (how to interpret ambiguous orders)
- Full event/action vocabulary reference
- Output schema with examples
- Formation type reference

### Agent Working Memory: `src/server/agents/memory.ts`

Lieutenants accumulate structured knowledge across LLM calls:

```ts
interface AgentMemory {
  agentId: string;
  beliefs: Map<string, unknown>;     // Named key-value pairs (LLM read/write)
  observations: Observation[];        // Rolling log (max 20, FIFO eviction)
}

interface Observation {
  tick: number;
  type: string;      // casualty, routing, squad_wiped, engagement, etc.
  summary: string;   // Human-readable description
}
```

**Beliefs** are set by the lieutenant via `updated_beliefs` in its output. They persist until overwritten. Examples: `"enemy_strength": "weakening on left flank"`, `"threat_level": "high"`.

**Observations** are recorded automatically by `memory-recorder.ts` from battle events. Capped at 20 entries with FIFO eviction. They provide a rolling battle log the lieutenant can reference.

### Reinvocation System: `src/server/agents/reinvocation.ts`

```
+--------------------+-----------+------------------+
| Trigger            | Threshold | Cooldown         |
+--------------------+-----------+------------------+
| Troop casualties   | 3 deaths  | 50 ticks (5s)    |
| Support requests   | 2 reqs    | 50 ticks (5s)    |
| Peer message       | 1 message | 50 ticks (5s)    |
| Stalemate warning  | 1 event   | 50 ticks (5s)    |
| Idle (no LLM call) | 150 ticks | N/A (always fire)|
+--------------------+-----------+------------------+
```

The idle threshold (15 seconds) bypasses cooldown entirely -- if a lieutenant has not been called in 15 seconds, it gets a reassessment regardless of other triggers.

Each lieutenant has an independent `ReinvocationTracker` that counts events since the last LLM call. `markReinvoked()` resets all counters.

### Compiler: `src/server/agents/compiler.ts`

Converts validated `LieutenantOutput` into runtime `Flowchart` objects:

1. **Pattern resolution**: `"all"` -> all available troops, `"p_s1_*"` -> prefix match, specific ID -> exact match
2. **Node conversion**: Schema nodes (Zod-validated) to runtime nodes (typed `EventType`, `GameAction`)
3. **Merge semantics**: If a unit already has a flowchart from a previous directive, new nodes are appended
4. **Self-directives**: `self_directives` compile to the lieutenant's own runtime
5. **Error collection**: Returns `CompiledFlowcharts` with both `flowcharts` map and `errors` array

### Schema Validation: `src/server/agents/schema.ts`

All LLM output is validated through Zod schemas before compilation. The schema validates:

- Event types: Must be one of the 15 defined `EventType` values
- Action shapes: Discriminated union on `type` field with correct parameter shapes
- Position objects: Must have numeric `x` and `y` fields
- Formation types: Must be one of the 6 valid `FormationType` values
- Directive structure: Unit targeting pattern + array of valid nodes

Malformed output is rejected with error context. The server can retry with the error message included in the next prompt.

---

## Communication Infrastructure

### Message Bus: `src/server/comms/message-bus.ts`

Central typed pub-sub system for all agent-to-agent communication:

```
+----------+                       +-----------+
|  Troop   |---support_request---->|           |
|          |---troop_report------->| Message   |
|          |---troop_alert-------->|   Bus     |
+----------+                       |           |
                                   | Prioritized|
+----------+                       | queue with |
|Lieutenant|<--peer_message------->| targeted + |
|          |<--support_request-----| broadcast  |
|          |<--stalemate_warning---| delivery   |
+----------+                       |           |
                                   |           |
+----------+                       |           |
|Simulation|---stalemate_warning-->|           |
|          |   (broadcast)         |           |
+----------+                       +-----------+
```

```ts
interface BusMessage {
  from: string;                // Sender agent ID
  to: string | null;           // Target agent ID, or null for broadcast
  type: string;                // Message type (support_request, peer_message, etc.)
  payload: Record<string, unknown>;
  priority: number;            // Higher = processed first
  tick: number;                // Simulation tick when sent
}
```

**Key design decisions:**

- **Priority ordering**: Messages sorted by priority (descending) on drain. Higher priority messages are processed first.
- **Targeted vs broadcast**: `to: agentId` for direct delivery; `to: null` for broadcast to all subscribers except the sender.
- **Per-agent drain**: `drainFor(bus, agentId)` extracts only messages for that agent (targeted + broadcasts), leaving others in the queue. Used when building LLM context for reinvocation.
- **Wildcard subscribers**: `subscribe(bus, '*', handler)` receives all messages. Useful for logging.
- **Queue-based**: Messages accumulate in the queue between drains, ensuring nothing is lost if a lieutenant is not ready to process immediately.

### Message Flow Patterns

```
Troop -> Lieutenant:
  support_request (priority: high)    "Taking heavy casualties, need reinforcement"
  troop_report (priority: medium)     "Enemy spotted at position X"
  troop_alert (priority: high)        "Flanked from the rear"

Lieutenant <-> Lieutenant:
  peer_message (priority: medium)     "Moving to support your right flank"

Simulation -> All (broadcast):
  stalemate_warning (priority: high)  "No combat for 10 seconds, armies must advance"
```

---

## Performance

### Spatial Indexing: `src/server/engine/spatial.ts`

The spatial module uses Matter.js as a broadphase spatial index. Each game agent is represented as a static sensor body (radius 5, no collision response) in a gravity-free Matter.js world.

**Range queries** (`queryRange`):
1. Compute AABB bounding box from center + range
2. `Matter.Query.region()` for broadphase candidate filtering
3. Squared-distance circular post-filter for exact range
4. Returns array of entity IDs within range

Used for: visibility checks, morale effect range, ally-down detection.

**Pair queries** (`queryPairsInRange`):
1. Build spatial hash grid with cell size = range
2. For each body, check its own cell + 8 neighboring cells
3. Squared-distance check for each candidate pair
4. Deduplicate via sorted-label pair key set
5. Returns `[idA, idB]` tuples

Complexity: O(n * k) where k = average neighbors per cell, replacing O(n^2) brute force.

Used for: combat pair detection, unit separation.

### Caching and Dirty Flags

**Squad member cache** (`squadMemberCache`):
- Maps lieutenant ID to ordered list of alive troop IDs
- Rebuilt only when `squadCacheDirty` flag is true (set on any troop death)
- Eliminates per-tick `Array.from().filter().sort()` allocations in `maintainFormations()`

### Throttled Detection

Expensive detection routines run every 10 ticks (1/sec) instead of every tick:
- Visibility updates and enemy_spotted/no_enemies_visible events
- Expanded event detection (formation_broken, morale_low, enemy_retreating, terrain transitions)

This prevents event flooding while keeping agents informed at a useful cadence.

### Performance Benchmarks

From `src/server/sim/performance.test.ts`:

| Scenario | Target | Measured |
|----------|--------|----------|
| 200 agents, open field | < 10ms/tick | ~3-4ms |
| 100 agents, open field | < 5ms/tick | ~1-2ms |
| 200 agents, with terrain | < 15ms/tick | ~5-7ms |

The 10ms budget at 200 agents ensures comfortable headroom for 10 ticks/second real-time simulation.

---

## Non-Blocking LLM Integration

LLM calls are the slowest operation in the system (1-10 seconds vs sub-millisecond ticks). The architecture ensures they never block the simulation.

### Async Fire-and-Forget Pattern

```
Simulation Tick Loop (10/sec, synchronous)
  |
  |-- Coordinator identifies lieutenants needing reinvocation
  |
  |-- For each lieutenant:
  |     reinvokeLieutenant(session, lt).catch(err => log(err))
  |     ^--- fire-and-forget Promise, NOT awaited
  |
  |-- Simulation continues with current flowcharts
  |
  ~  ... 1-10 seconds later ...
  ~
  LLM Response Arrives (async callback)
    |
    |-- Validate output (Zod schema)
    |-- Compile directives to Flowchart[]
    |-- queueFlowchartSwap(sim, unitId, flowchart)
    |     ^--- appends to pendingFlowchartSwaps[]
    |
    |-- Next tick: swaps applied atomically at step 0
```

### Concurrency Controls

```ts
const MAX_CONCURRENT_REINVOCATIONS = 3;
let activeReinvocations = 0;
```

- **Max 3 concurrent LLM calls** at any time to prevent API overload and rate limiting
- **Busy flag per lieutenant**: Prevents double-triggering if reinvocation conditions persist across ticks
- **Immediate tracker reset**: `markLieutenantReinvoked()` is called before the async call fires, preventing the coordinator from re-selecting the same lieutenant

### Atomic Flowchart Swaps

Flowchart replacements are queued in `pendingFlowchartSwaps[]` and applied at the very start of the next tick (step 0). This guarantees:
- No mid-tick flowchart mutation
- Consistent agent behavior within a single tick
- Safe interaction between async LLM callbacks and the synchronous tick loop

### Busy Guard Pattern

```ts
lt.busy = true;        // Set before LLM call
try {
  const context = buildEnrichedContext(...);
  const result = await processOrder(lt, ...);
  if (result.success && result.output) {
    const compiled = compileDirectives(result.output, lt.troopIds, lt.id);
    for (const [unitId, flowchart] of Object.entries(compiled.flowcharts)) {
      queueFlowchartSwap(session.simulation, unitId, flowchart);
    }
  }
} finally {
  lt.busy = false;     // Always cleared, even on error or timeout
  activeReinvocations--;
}
```

The `finally` block ensures a lieutenant is never permanently locked out, even if the LLM call throws or times out.
