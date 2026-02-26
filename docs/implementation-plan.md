# Implementation Plan: Agentic Game Design Improvements

This plan covers performance optimization, wiring the coordinator/reinvocation system, non-blocking LLM guarantees, pre-match configurability, and comprehensive public documentation.

## Status: COMPLETE

All 5 phases implemented. **460 tests passing** across 33 test files.

### What Was Done

- **Phase 1**: Spatial index integrated into simulation hot paths, O(n²) eliminated, forest concealment applied, performance benchmarks added (200 agents < 10ms/tick)
- **Phase 2**: Coordinator wired into live battle loop — tick tracking, casualty/stalemate/support routing, automatic lieutenant re-invocation with enriched context
- **Phase 3**: Atomic flowchart swap queue prevents mid-tick mutations, max 3 concurrent LLM calls
- **Phase 4**: Scenario picker in PreBattleScreen with descriptions and difficulty ratings
- **Phase 5**: 10 documentation files in `/docs/`, updated InstructionsScreen, updated CLAUDE.md

---

## Phase 1: Performance — Spatial Index + O(n²) Elimination

**Goal**: Use the existing spatial index in all hot paths. Add performance benchmarks. Target: handle 200+ agents at 10 tps without frame drops.

### Task 1.1: Fix `queryPairsInRange` to actually use broadphase
**File**: `src/server/engine/spatial.ts`
- Current implementation is O(n²) despite the comment claiming broadphase
- Replace with grid-based or sweep approach: divide space into cells of `range` size, only check adjacent cells
- **Tests**: spatial.test.ts — add benchmark test with 200 bodies, verify pairs found match brute-force

### Task 1.2: Integrate spatial world into SimulationState
**File**: `src/server/sim/simulation.ts`
- Add `spatialWorld: SpatialWorld` to `SimulationState`
- In `createSimulation`: create spatial world, add all agents as bodies
- In `simulationTick`: after movement step, call `updateBodyPosition` for each moved agent
- Remove dead agents from spatial world when they die
- **Tests**: simulation.test.ts — verify spatial world stays in sync with agent positions

### Task 1.3: Replace O(n²) in `separateUnits` with spatial queries
**File**: `src/server/sim/simulation.ts` (line ~595)
- Instead of nested loop over all alive agents, use `queryRange(world, agent.position, UNIT_MIN_SEPARATION)` per agent
- Reduces from O(n²) to O(n × k) where k = nearby agents (typically 2-5)
- **Tests**: existing simulation-mechanics.test.ts should still pass; add perf test

### Task 1.4: Replace O(n²) in `findCombatPairs` with spatial queries
**File**: `src/server/engine/combat.ts` (line ~140)
- Add optional `SpatialWorld` parameter to `findCombatPairs`
- When provided, use `queryRange(world, agent.position, COMBAT_RANGE)` per agent instead of nested loop
- Filter results to cross-team pairs only
- **Tests**: combat.test.ts — verify identical results with and without spatial index

### Task 1.5: Fix `maintainFormations` allocation pattern
**File**: `src/server/sim/simulation.ts` (line ~548)
- Currently allocates `Array.from(battle.agents.values()).filter().sort()` per troop per tick
- Cache squad member lists: add `squadMemberCache: Map<string, string[]>` to SimulationState
- Invalidate cache only on death events
- Rebuild once per tick at most (dirty flag)
- **Tests**: verify formation maintenance still works; verify cache invalidation on death

### Task 1.6: Apply terrain concealment to visibility
**File**: `src/server/sim/simulation.ts` `updateVisibility`
- Currently ignores forest concealment. `getEffectiveVisibilityRadius` exists in terrain.ts but is never called
- Use `getEffectiveVisibilityRadius(viewer, target, baseRadius, map)` instead of raw `visibilityRadius`
- **Tests**: test that units in forests are harder to spot

### Task 1.7: Performance benchmark test suite
**File**: `src/server/sim/performance.test.ts` (NEW)
- Create scenario with 200 agents (100 per side)
- Benchmark: run 100 ticks, measure total time
- Assert: average tick < 10ms (100 ticks/sec headroom)
- Benchmark `separateUnits`, `findCombatPairs`, `maintainFormations` individually
- Run with and without spatial index to show improvement

---

## Phase 2: Wire Coordinator/Reinvocation into Live Battle Loop

**Goal**: The coordinator and reinvocation system exist but are never called from the production battle loop. Wire them in so lieutenants are automatically re-invoked based on battlefield events.

### Task 2.1: Create coordinator in session initialization
**File**: `src/server/index.ts`
- In `init_scenario` handler: call `createCoordinator()` and store on session
- Initialize reinvocation trackers for each lieutenant
- **Tests**: integration test verifying coordinator is created with correct lieutenant IDs

### Task 2.2: Feed battle events to coordinator
**File**: `src/server/index.ts`
- In the tick callback (`onTick`): feed pending battle events to coordinator
  - `kill` → `recordCasualty(coordinator, lieutenantId)`
  - `stalemate_warning` → `recordStalemateWarning(coordinator, lieutenantId)`
- In message bus subscriber: feed troop messages to coordinator
  - `support_request` → `recordSupportRequest(coordinator, lieutenantId)`
  - `peer_message` → `recordPeerMessage(coordinator, lieutenantId)`
- **Tests**: verify event routing from sim events to coordinator

### Task 2.3: Trigger lieutenant re-invocation from coordinator
**File**: `src/server/index.ts`
- Every tick (or every N ticks), call `tickCoordinator(coordinator, tick)`
- For each lieutenant returned by `getLieutenantsNeedingReinvocation`: trigger async LLM re-call
- Use `buildEnrichedContext` for the re-invocation prompt
- Guard: skip if lieutenant is already `busy`
- Fire-and-forget (non-blocking, `.catch()` error handler)
- **Tests**: integration test showing lieutenant auto-re-invoked after 3 casualties

### Task 2.4: Feed memory recorder into the loop
**File**: `src/server/index.ts`
- Use `recordBattleEvent` from `memory-recorder.ts` to auto-record events as observations in lieutenant memory
- Subscribe to pending battle events each tick
- **Tests**: verify observations appear in lieutenant memory after battle events

---

## Phase 3: Non-Blocking LLM Guarantee

**Goal**: Ensure LLM calls never interfere with the tick loop, even under edge cases (slow responses, retries, concurrent calls).

### Task 3.1: Add flowchart swap atomicity guard
**File**: `src/server/sim/simulation.ts`
- Flowcharts are currently swapped via direct Map mutation from the async LLM handler
- Add a `pendingFlowchartUpdates: Array<{agentId, flowchart}>` queue to SimulationState
- LLM handlers push to queue; tick loop drains queue at start of step 2 (before processEvents)
- This prevents mid-tick flowchart changes
- **Tests**: test that flowchart updates applied between ticks, not during

### Task 3.2: Add concurrent LLM call limiting
**File**: `src/server/agents/lieutenant.ts`
- Add a semaphore/counter: max 3 concurrent LLM calls per session
- If at limit, queue the call and process when a slot opens
- Prevents API rate-limit errors and excessive concurrent requests
- **Tests**: test that 4th call is queued, processed after one completes

### Task 3.3: Add LLM call metrics
**File**: `src/server/agents/lieutenant.ts`
- Track: total calls, average latency, timeout count, retry count
- Expose via `getLLMMetrics()` for debugging and the headless status command
- **Tests**: verify metrics increment correctly

---

## Phase 4: Pre-Match Configuration

**Goal**: Make scenario, army composition, and game settings configurable from the client before a battle starts.

### Task 4.1: Scenario selection in client
**File**: `client/src/components/PreBattleScreen.tsx`
- Add scenario picker: basic, assault, river_crossing
- Show terrain preview for each (use existing MapPreview component)
- Send selected scenario in `init_scenario` message
- **Tests**: N/A (UI component, tested manually)

### Task 4.2: Add custom scenario builder support
**File**: `src/server/sim/scenario.ts`
- Add `createCustomScenario(config: ScenarioConfig)` that accepts:
  - `mapSize: { width, height }`
  - `playerSquads: Array<{ count, preset, position }>`
  - `enemySquads: Array<{ count, preset, position }>`
  - `terrain: TerrainFeature[]`
- Validate inputs (bounds, max units)
- **Tests**: test custom scenario creation with various configs

### Task 4.3: Expose troop preset selection per squad
**File**: `src/server/index.ts`, `client/src/components/PreBattleScreen.tsx`
- Allow changing unit preset per squad before battle (infantry, scout, vanguard, etc.)
- Server: handle `update_squad_preset` message, rebuild squad agents
- Client: show preset selector per squad with stat previews
- **Tests**: verify preset change updates agent stats correctly

### Task 4.4: Add game speed and tick rate configuration
**File**: `src/server/index.ts`
- Support `set_speed` with values 0.25x through 4x (not just 0.5/1/2)
- Add `set_tick_rate` for advanced users (5, 10, 20 tps)
- **Tests**: verify tick interval math for each speed/rate combo

### Task 4.5: Configuration summary before battle start
**File**: `client/src/components/PreBattleScreen.tsx`
- Show a summary panel before "Start Battle":
  - Scenario name + terrain preview
  - Player army: squads, unit types, total troops
  - Enemy army: squads, unit types, total troops
  - Lieutenant personalities and stats
  - Game mode (human vs AI / AI vs AI)
- **Tests**: N/A (UI)

---

## Phase 5: Comprehensive Public Documentation

**Goal**: Create detailed, public-facing documentation of the full architecture, codebase, troop types, eventing, and communication systems.

### Task 5.1: Architecture overview document
**File**: `docs/architecture.md` (NEW)
- Three-layer architecture diagram (Communication → Flowchart Runtime → Simulation)
- Data flow: Player → WebSocket → Server → LLM → Flowchart → Simulation → Client
- Component interaction diagram
- Tech stack: Node.js, Express, WebSocket, Vitest, Matter.js, React, Vite, Anthropic SDK

### Task 5.2: Event system reference
**File**: `docs/event-system.md` (NEW)
- Complete event vocabulary with types, payloads, and when each fires
- Action vocabulary with all available actions
- Flowchart structure and compilation
- Event detection intervals and thresholds
- Expanded events (formation_broken, morale_low, etc.)

### Task 5.3: Communication system reference
**File**: `docs/communication.md` (NEW)
- Message bus architecture (pub-sub, priorities, broadcasts)
- Message types and routing: troop→lieutenant, lieutenant↔lieutenant, sim→all
- Lieutenant re-invocation triggers and thresholds
- Agent working memory: beliefs, observations, memory recorder
- Lieutenant output schema: directives, messages, beliefs, response_to_player

### Task 5.4: Update unit-stats.md with full reference
**File**: `docs/unit-stats.md`
- Ensure all 7 presets are documented with all 4 stats
- Add stat effect descriptions (what each stat actually does mechanically)
- Add lieutenant stat effects
- Add visibility ranges per agent type

### Task 5.5: Add API/protocol reference
**File**: `docs/api-protocol.md` (NEW)
- Full WebSocket message protocol (client→server and server→client)
- Headless NDJSON protocol
- REST endpoints
- Session lifecycle

### Task 5.6: Update InstructionsScreen.tsx
**File**: `client/src/components/InstructionsScreen.tsx`
- Add section on scenario selection
- Add section on pre-battle configuration
- Add section on lieutenant re-invocation ("your lieutenants adapt mid-battle")
- Update tips with configuration advice

### Task 5.7: Update CLAUDE.md
**File**: `CLAUDE.md`
- Add spatial indexing usage to architecture notes
- Add coordinator wiring to simulation loop description
- Add performance characteristics section
- Add configuration options section
- Update any changed thresholds or mechanics

---

## Execution Order

1. **Phase 1** (Performance) — foundational, enables scaling
2. **Phase 2** (Coordinator) — brings built infrastructure to life
3. **Phase 3** (LLM safety) — ensures stability under load
4. **Phase 4** (Configuration) — user-facing improvements
5. **Phase 5** (Documentation) — must be last since it documents final state

Each phase follows red/green TDD:
1. Write failing test
2. Implement minimum code to pass
3. Refactor if needed
4. Verify all existing tests still pass
