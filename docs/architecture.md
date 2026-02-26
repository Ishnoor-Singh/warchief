# Warchief Architecture

A real-time battle strategy game where the player commands an army through natural language. Three distinct layers process player intent into battlefield action.

## System Overview

```
Player (text) → Lieutenant LLMs → Structured flowchart output → Troop agents → Simulation
```

### Three Layers

1. **Communication Layer** — LLM inference, message routing, organization graph
2. **Flowchart Runtime** — Event system, flowchart compiler, agent execution
3. **Simulation Layer** — 2D physics, combat, visibility, terrain, morale

## Server Architecture

### Entry Point: `src/server/index.ts`

WebSocket + HTTP server managing game sessions. Each WebSocket connection creates a `GameSession` with:
- Simulation state
- Player and enemy lieutenants
- AI commander(s)
- Game coordinator for reinvocation
- Battle loop timer

### Simulation: `src/server/sim/`

| File | Purpose |
|------|---------|
| `simulation.ts` | Core tick loop (10 ticks/sec), state management |
| `scenario.ts` | Scenario definitions (basic, assault, river_crossing) |
| `performance.test.ts` | Performance benchmarks (200 agents < 10ms/tick) |

### Engine: `src/server/engine/`

| File | Purpose |
|------|---------|
| `vec2.ts` | 2D vector math (distance, normalize, etc.) |
| `unit-types.ts` | Troop/Lieutenant factories, presets, stat defaults |
| `combat.ts` | Base damage, death, squad tracking, win condition |
| `combat-modifiers.ts` | Formation modifiers, flanking, charge momentum |
| `morale.ts` | Morale routing, panic cascades, recovery |
| `terrain.ts` | Terrain features (hill, forest, river), modifiers |
| `formations.ts` | Formation slot positioning (6 types) |
| `movement.ts` | Agent movement, pursuit, arrival |
| `spatial.ts` | Spatial indexing (Matter.js backed, grid-based pairs) |
| `conditions.ts` | Safe condition evaluation (no eval) |
| `stalemate.ts` | Stalemate detection and escalation |
| `event-detection.ts` | Expanded event detection (formation, morale, terrain) |

### Agents: `src/server/agents/`

| File | Purpose |
|------|---------|
| `lieutenant.ts` | Lieutenant LLM instances, `processOrder()` |
| `ai-commander.ts` | AI commander for enemy (and player in ai_vs_ai) |
| `coordinator.ts` | Reinvocation orchestration, enriched context builder |
| `reinvocation.ts` | Trigger system (casualties, support, idle) |
| `memory.ts` | Agent working memory (beliefs + observations) |
| `memory-recorder.ts` | Auto-records battle events as observations |
| `compiler.ts` | Compiles LLM output into runtime flowcharts |
| `schema.ts` | LLM output validation/parsing |
| `input-builder.ts` | Builds LLM prompt context |

### Runtime: `src/server/runtime/`

| File | Purpose |
|------|---------|
| `flowchart.ts` | Flowchart runtime, event processing, personality defaults |

### Communication: `src/server/comms/`

| File | Purpose |
|------|---------|
| `message-bus.ts` | Typed, prioritized pub-sub for agent-to-agent messaging |

## Client Architecture

React SPA with WebSocket connection to the game server.

### Screens (game phases)

```
Landing → Setup (API key) → Pre-Battle (War Room) → Battle → Post-Battle
                                                         ↑
                                              Instructions / Playground
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `BattlefieldCanvas` | Canvas rendering of the battlefield |
| `MessagePanel` | Chat interface for orders/reports |
| `FlowchartPanel` | Live flowchart visualization during battle |
| `FlowchartEditor` | Pre-battle flowchart editing |
| `PreBattleScreen` | War Room: scenario picker, lieutenant config, briefing |
| `MapPreview` | Minimap showing troop positions and terrain |
| `ArmyStrengthHUD` | Army strength bars during battle |
| `BattleEventTicker` | Scrolling battle events feed |

## Tick Cycle

Each simulation tick (10/second) performs these steps:

```
0. Apply pending flowchart swaps (atomic, queued by async LLM)
1. Update visibility + queue enemy_spotted events (every 10 ticks)
2. Detect expanded events (formation_broken, morale_low, etc.)
3. Process flowchart events per agent (skip routing units)
4. Maintain formations (cached squad members)
5. Move agents toward targets (terrain speed modifiers)
6. Sync spatial world (update body positions)
7. Separate overlapping units (spatial-indexed)
8. Resolve combat (spatial-indexed pairs, modifiers stack)
9. Check morale + trigger routing
10. Recover morale for out-of-combat units
11. Check win condition
12. Track charge momentum
13. Stalemate detection + escalation
14. Fire callbacks
```

## Performance Architecture

### Spatial Indexing

All O(n²) operations replaced with spatial queries:

- **Matter.js bodies** as sensors for broadphase queries
- **Grid-based spatial hash** for pair detection: `queryPairsInRange()` divides space into cells of `range` size, checks only 9 neighbor cells per body
- **Range queries** via `queryRange()`: rectangular broadphase then circular filter

### Caching

- **Squad member cache**: Map<lieutenantId, troopId[]> with dirty flag invalidation on death
- Eliminates per-tick `Array.from().filter().sort()` allocation in `maintainFormations()`

### Benchmarks

| Scenario | Target | Measured |
|----------|--------|----------|
| 200 agents, open field | < 10ms/tick | ~3-4ms |
| 100 agents, open field | < 5ms/tick | ~1-2ms |
| 200 agents, with terrain | < 15ms/tick | ~5-7ms |

## Non-blocking LLM Architecture

LLM calls never block the simulation tick loop:

1. **Async fire-and-forget**: `reinvokeLieutenant()` runs asynchronously
2. **Atomic flowchart swap**: New flowcharts queued via `queueFlowchartSwap()`, applied at tick start
3. **Concurrency limit**: Max 3 simultaneous reinvocations (`MAX_CONCURRENT_REINVOCATIONS`)
4. **Timeout protection**: 30s timeout on LLM calls

```
Tick loop (synchronous, 10/sec)
  ├─ Apply queued flowchart swaps
  ├─ Process all tick steps
  └─ Check reinvocation triggers
       └─ Fire async LLM call (non-blocking)
            └─ On completion: queue flowchart swap
```

## Data Flow

### Player Order Flow

```
Player types order
  → WebSocket send_order message
  → Server finds lieutenant
  → processOrder() calls LLM (async)
  → LLM returns structured JSON (LieutenantOutput)
  → compileDirectives() converts to Flowcharts
  → applyFlowcharts() updates agent runtimes
  → Troops execute new logic next tick
```

### Reinvocation Flow

```
Battle event occurs (kill, stalemate, etc.)
  → Coordinator records event per lieutenant
  → Each tick: tickCoordinator() advances idle counters
  → getLieutenantsNeedingReinvocation() checks thresholds
  → reinvokeLieutenant() fires async LLM call
  → buildEnrichedContext() provides peer state + bus messages
  → New flowcharts queued atomically
  → Applied at start of next tick
```

### Memory Flow

```
Battle events (kills, retreats, etc.)
  → recordBattleEvents() auto-records as observations
  → LLM output includes updated_beliefs
  → setBelief() stores in working memory
  → buildMemorySummary() formats for next LLM prompt
  → Lieutenant has full context of battle history
```
