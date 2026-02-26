# Communication System

All agent-to-agent communication in Warchief flows through structured, typed systems. This document covers the message bus, coordinator, reinvocation triggers, and agent memory.

## Message Bus

**File:** `src/server/comms/message-bus.ts`

Central typed pub-sub system for all inter-agent communication.

### Message Format

```typescript
interface BusMessage {
  from: string;        // Sender agent ID
  to: string | null;   // Target agent ID (null = broadcast)
  type: string;        // Message type identifier
  payload: Record<string, unknown>;
  priority: number;    // Higher = processed first
  tick: number;        // Simulation tick when sent
}
```

### Message Types

| Direction | Type | Purpose |
|-----------|------|---------|
| Troop → Lieutenant | `support_request` | Request reinforcements or help |
| Troop → Lieutenant | `troop_report` | Status report from the field |
| Troop → Lieutenant | `troop_alert` | Urgent alert (under fire, etc.) |
| Lieutenant ↔ Lieutenant | `peer_message` | Coordination between peers |
| Simulation → All | `stalemate_warning` | Broadcast when no combat for 10s |

### API

```typescript
createMessageBus(): MessageBus
send(bus, message): void           // Enqueue for delivery
subscribe(bus, agent, handler): void  // Register handler
drain(bus): void                   // Deliver all messages, priority order
drainFor(bus, agentId): BusMessage[]  // Drain for specific agent only
```

### Delivery Rules

- **Targeted messages** (`to` specified): delivered only to target's handlers
- **Broadcasts** (`to: null`): delivered to all subscribers except sender
- **Wildcard** (`subscribe(bus, '*', handler)`): receives all messages
- Messages are sorted by priority (descending) before delivery

## Game Coordinator

**File:** `src/server/agents/coordinator.ts`

Connects the simulation to the agent layer. Tracks reinvocation triggers and builds enriched context for LLM calls.

### Interface

```typescript
interface GameCoordinator {
  trackers: Map<string, ReinvocationTracker>;
}
```

### Functions

| Function | Purpose |
|----------|---------|
| `createCoordinator(ltIds)` | Create coordinator with trackers for all lieutenants |
| `tickCoordinator(coord)` | Advance idle counters (call each tick) |
| `recordCasualty(coord, ltId)` | Record troop death for a lieutenant |
| `recordSupportRequest(coord, ltId)` | Record incoming support request |
| `recordPeerMessage(coord, ltId)` | Record peer message arrival |
| `recordStalemateWarning(coord)` | Record for all lieutenants |
| `getLieutenantsNeedingReinvocation(coord)` | Check triggers, return IDs |
| `markLieutenantReinvoked(coord, ltId, tick)` | Reset tracker after LLM call |
| `buildEnrichedContext(ltId, orders, sim, peerIds)` | Build full LLM context |

### Enriched Context

When a lieutenant needs reinvocation, `buildEnrichedContext()` gathers:

1. **Identity**: Name, personality, stats
2. **Visible units**: Position, health, morale of troops under command
3. **Visible enemies**: Within lieutenant's visibility radius
4. **Peer state**: For each authorized peer — position, troop count, morale, current action
5. **Pending bus messages**: Support requests, peer comms, alerts
6. **Terrain description**: Current terrain features

## Reinvocation System

**File:** `src/server/agents/reinvocation.ts`

Determines when a lieutenant LLM should be re-called to reassess the situation.

### Triggers

| Trigger | Threshold | Cooldown |
|---------|-----------|----------|
| Troop casualties | 3 deaths | 50 ticks (5s) |
| Support requests | 2 requests | 50 ticks (5s) |
| Peer message | 1 message | 50 ticks (5s) |
| Stalemate warning | 1 event | 50 ticks (5s) |
| Idle (no LLM call) | 150 ticks (15s) | N/A |

### Logic

```
shouldReinvoke(tracker):
  if ticksSinceLastCall >= 150 → true (idle override)
  if ticksSinceLastCall < 50 → false (cooldown)
  if casualties >= 3 → true
  if supportRequests >= 2 → true
  if peerMessages > 0 → true
  if stalemateWarning → true
  else → false
```

### Wiring (in `index.ts`)

The coordinator is wired into the live battle loop:

1. **Each tick**: `tickCoordinator()` advances idle counters
2. **Kill events**: Routed to `recordCasualty()` for the dead troop's lieutenant
3. **Stalemate warnings**: Routed to `recordStalemateWarning()`
4. **Support requests**: Detected from troop messages containing "support"
5. **Reinvocation check**: `getLieutenantsNeedingReinvocation()` each tick
6. **Async LLM call**: `reinvokeLieutenant()` fires non-blocking, max 3 concurrent
7. **Flowchart update**: Queued atomically via `queueFlowchartSwap()`

## Agent Working Memory

**File:** `src/server/agents/memory.ts`

Persistent structured memory across LLM calls.

### Structure

```typescript
interface AgentMemory {
  agentId: string;
  beliefs: Map<string, unknown>;  // Named key-value pairs
  observations: Observation[];     // Rolling log (max 20)
}

interface Observation {
  tick: number;
  type: string;
  summary: string;
}
```

### Beliefs

Key-value pairs that the LLM can read and write:
- Set via `updated_beliefs` in LLM output
- Stored by `setBelief(mem, key, value)`
- Included in subsequent prompts
- Examples: `"enemy_position": "right flank"`, `"threat_level": "high"`

### Observations

Rolling log of significant events (max 20, oldest evicted):
- Recorded automatically by the memory recorder
- Formatted as `[tick N] (type) summary`

## Memory Recorder

**File:** `src/server/agents/memory-recorder.ts`

Automatically records battle events as observations in lieutenant memory.

### Recorded Events

| Event Type | Observation Type | Example |
|------------|-----------------|---------|
| `kill` | `casualty` | "Player troop p_s1_3 was killed" |
| `retreat` | `routing` | "Enemy troop e_s2_1 is routing" |
| `squad_wiped` | `squad_wiped` | "Squad alpha has been wiped out" |
| `engagement` | `engagement` | "New engagement near position (200, 150)" |
| `casualty_milestone` | `casualties` | "Player forces at 50% strength" |
| `stalemate_warning` | `stalemate` | "No combat for 10 seconds" |

### Filtering

- Only events matching the lieutenant's team are recorded
- Stalemate warnings are recorded for all teams
- Events are batched per lieutenant per tick

## Lieutenant Output Schema

```typescript
type LieutenantOutput = {
  directives: FlowchartDirective[];           // Troop flowchart rules
  self_directives?: FlowchartDirective[];     // Lieutenant's own rules
  message_up?: string;                        // Report to commander
  message_peers?: { to: string; content: string }[];  // Peer messages
  response_to_player?: string;                // Proactive player message
  updated_beliefs?: Record<string, unknown>;  // Persist knowledge
}
```

### Directive Compilation

1. LLM outputs structured JSON matching the schema
2. `parseLieutenantOutput()` validates the output
3. `compileDirectives()` resolves unit patterns and converts to Flowcharts
4. `applyFlowcharts()` or `queueFlowchartSwap()` applies to runtimes

## Communication Flow Diagram

```
                    ┌─────────────────┐
                    │   Player (UI)   │
                    └────────┬────────┘
                             │ orders (WebSocket)
                             ▼
                    ┌─────────────────┐
                    │  Lieutenant LLM │◄──── reinvocation triggers
                    └────────┬────────┘
                             │ FlowchartDirectives
                             ▼
                    ┌─────────────────┐
                    │ Flowchart Compiler│
                    └────────┬────────┘
                             │ Flowcharts
                             ▼
                    ┌─────────────────┐
                    │  Agent Runtimes  │◄──── events from simulation
                    └────────┬────────┘
                             │ actions
                             ▼
┌──────────┐       ┌─────────────────┐       ┌──────────┐
│  Memory  │◄─────►│   Simulation    │──────►│ Message  │
│ Recorder │       │   (10 tps)      │       │   Bus    │
└──────────┘       └─────────────────┘       └──────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Coordinator    │
                    │ (reinvocation)  │
                    └─────────────────┘
```
