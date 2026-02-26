# Communication System

This document describes all inter-agent communication systems in Warchief. Every number here is authoritative -- if the code disagrees with this doc, the doc is wrong and should be updated.

## Overview

Communication is one of the three core layers in Warchief's architecture. The player never directly controls units; all commands flow through a chain of communication from player to lieutenants to troops. Lieutenants interpret orders, coordinate with peers, and program troop behavior via flowcharts.

The communication layer is built from five subsystems:

1. **Message Bus** -- typed, prioritized pub-sub for agent-to-agent messages
2. **Coordinator** -- connects the simulation to the agent layer, orchestrates LLM re-calls
3. **Reinvocation System** -- tracks events and decides when lieutenants need LLM re-invocation
4. **Agent Working Memory** -- persistent beliefs and observations across LLM calls
5. **Memory Recorder** -- auto-records battle events as observations in lieutenant memory

---

## Message Flow Diagram

```
                        Player
                          |
                    (natural language)
                          |
                          v
    +---------------------------------------------------+
    |                  Lieutenant LLM                    |
    |  (interprets orders, writes flowcharts, reports)   |
    +---------------------------------------------------+
         |         |         ^         ^         ^
         |         |         |         |         |
    directives  message   support   troop     troop
    (flowcharts)  _peers  _request  _report   _alert
         |         |         |         |         |
         v         v         |         |         |
    +---------+ +---------+  |         |         |
    | Troops  | | Peer Lt |  |         |         |
    | (exec   | | (coord) |  +---------+---------+
    |  flow-  | +---------+        |
    |  charts)|                    |
    +---------+                    |
         |                         |
         +-------(via bus)---------+
```

### Full Message Routing

```
+------------------------------------------------------------------+
|                        MESSAGE BUS                                |
|  (typed, prioritized, pub-sub)                                    |
|                                                                   |
|  Troop --> Lieutenant:                                            |
|    support_request  (priority 7)  "Need reinforcements!"          |
|    troop_report     (priority 3)  "Enemy spotted east"            |
|    troop_alert      (priority 8)  "Under heavy fire!"             |
|                                                                   |
|  Lieutenant <--> Lieutenant:                                      |
|    peer_message     (variable)    "Flanking from the north"       |
|                                                                   |
|  Simulation --> All (broadcast):                                  |
|    stalemate_warning (priority 9) "Battle has stalled"            |
+------------------------------------------------------------------+
         |                    |                    |
         v                    v                    v
  +-------------+     +-------------+     +-------------+
  | Lieutenant  |     | Lieutenant  |     | Lieutenant  |
  | Tracker     |     | Tracker     |     | Tracker     |
  | (reinvoke?) |     | (reinvoke?) |     | (reinvoke?) |
  +-------------+     +-------------+     +-------------+
         |                    |                    |
         v                    v                    v
  +-------------+     +-------------+     +-------------+
  |  LLM Call   |     |  LLM Call   |     |  LLM Call   |
  |  (if needed)|     |  (if needed)|     |  (if needed)|
  +-------------+     +-------------+     +-------------+
```

---

## Message Bus

**Source:** `src/server/comms/message-bus.ts`

The message bus is a typed, prioritized pub-sub system that serves as the backbone for all agent-to-agent communication. It decouples senders from receivers and ensures messages are processed in priority order.

### Data Structures

```ts
interface BusMessage {
  from: string;          // sender agent ID
  to: string | null;     // recipient agent ID, or null for broadcast
  type: string;          // message type (support_request, peer_message, etc.)
  payload: Record<string, unknown>;  // message content
  priority: number;      // higher number = processed first
  tick: number;          // simulation tick when sent
}

interface MessageBus {
  queue: BusMessage[];                       // pending messages
  subscribers: Map<string, MessageHandler[]>; // per-agent handlers
}

type MessageHandler = (message: BusMessage) => void;
```

### API

| Function | Signature | Description |
|----------|-----------|-------------|
| `createMessageBus()` | `() => MessageBus` | Creates an empty bus with no messages or subscribers |
| `send(bus, message)` | `(MessageBus, BusMessage) => void` | Enqueues a message for delivery on the next drain |
| `subscribe(bus, agent, handler)` | `(MessageBus, string, MessageHandler) => void` | Registers a handler for messages targeting a specific agent. Use `"*"` as agent to receive all messages (wildcard) |
| `drain(bus)` | `(MessageBus) => void` | Delivers all queued messages to subscribers in priority order (descending), then clears the queue |
| `drainFor(bus, agentId)` | `(MessageBus, string) => BusMessage[]` | Extracts and returns only messages for a specific agent (targeted + broadcasts excluding self), sorted by priority. Leaves other messages in the queue |

### Message Delivery Rules

- **Targeted messages** (`to` is a specific agent ID): delivered only to that agent's subscribers.
- **Broadcast messages** (`to` is `null`): delivered to all subscribers except the sender. The sender is explicitly excluded to prevent self-notification.
- **Wildcard subscribers** (subscribed with `"*"`): receive every message regardless of target. Wildcard subscribers are also excluded from broadcast delivery to avoid double-delivery.
- **Priority ordering**: messages are sorted by `priority` descending before delivery. Higher priority messages are processed first.

### Message Types and Priorities

| Type | Direction | Priority | Trigger |
|------|-----------|----------|---------|
| `support_request` | Troop --> Lieutenant | 7 | Troop executes `requestSupport` action |
| `troop_report` | Troop --> Lieutenant | 3 | Troop executes `emit('report', ...)` action |
| `troop_alert` | Troop --> Lieutenant | 8 | Troop executes `emit('alert', ...)` action |
| `peer_message` | Lieutenant --> Lieutenant | variable | Lieutenant includes `message_peers` in LLM output |
| `stalemate_warning` | Simulation --> All | 9 | No combat for 100 ticks (10 seconds) |

### How Messages Enter the Bus

Messages are injected into the bus at three points in the simulation:

1. **Troop `requestSupport` action** -- when a troop's flowchart executes `requestSupport`, the simulation sends a `support_request` message to the troop's lieutenant via the bus (priority 7). The simulation also fires the legacy `onTroopMessage` callback for backward compatibility.

2. **Troop `emit` action** -- when a troop executes `emit('report', ...)` or `emit('alert', ...)`, the simulation routes it to the lieutenant as `troop_report` (priority 3) or `troop_alert` (priority 8). The event type determines the priority: alerts are urgent, reports are informational.

3. **Stalemate detection** -- when the simulation detects no combat for 100 ticks, it broadcasts a `stalemate_warning` (from: `"simulation"`, to: `null`, priority 9) to all lieutenants. This is the highest priority message type in the system.

### How Messages Leave the Bus

Messages are consumed in two ways:

1. **`drain(bus)`** -- delivers all messages to registered subscriber handlers and clears the queue. Used for general event processing with the subscriber pattern.

2. **`drainFor(bus, agentId)`** -- extracts messages for a specific lieutenant when building enriched LLM context. This is the primary consumption path during the reinvocation flow: the coordinator calls `drainFor` to gather pending messages for a lieutenant before constructing its LLM prompt. Importantly, `drainFor` removes only the matched messages from the queue, leaving messages for other agents untouched.

---

## Game Coordinator

**Source:** `src/server/agents/coordinator.ts`

The coordinator is the bridge between the simulation layer and the agent/LLM layer. It does not make LLM calls itself -- it determines which lieutenants need re-invocation and builds the context they need. The server layer handles the async LLM calls.

### Data Structure

```ts
interface GameCoordinator {
  trackers: Map<string, ReinvocationTracker>;  // one per lieutenant
}
```

### API

| Function | Signature | Description |
|----------|-----------|-------------|
| `createCoordinator(ltIds)` | `(string[]) => GameCoordinator` | Creates a coordinator with reinvocation trackers for all lieutenant IDs |
| `tickCoordinator(coord)` | `(GameCoordinator) => void` | Advances idle counters on all trackers by one tick. Call once per simulation tick |
| `recordCasualty(coord, ltId)` | `(GameCoordinator, string) => void` | Records a troop death under a specific lieutenant |
| `recordSupportRequest(coord, ltId)` | `(GameCoordinator, string) => void` | Records a support request received by a lieutenant |
| `recordPeerMessage(coord, ltId)` | `(GameCoordinator, string) => void` | Records a peer message arrival for a lieutenant |
| `recordStalemateWarning(coord)` | `(GameCoordinator) => void` | Records stalemate warning for ALL lieutenants simultaneously |
| `getLieutenantsNeedingReinvocation(coord)` | `(GameCoordinator) => string[]` | Returns IDs of all lieutenants whose trackers indicate reinvocation is needed |
| `markLieutenantReinvoked(coord, ltId, tick)` | `(GameCoordinator, string, number) => void` | Resets a lieutenant's tracker after an LLM call completes |
| `buildEnrichedContext(ltId, orders, sim, peerIds)` | `(string, string, SimulationState, string[]) => LieutenantContext` | Builds the full LLM prompt context (see below) |

### Enriched Context

When a lieutenant needs re-invocation, the coordinator builds a `LieutenantContext` containing everything the LLM needs for informed decision-making:

```ts
interface LieutenantContext {
  identity: LieutenantIdentity;            // name, personality, stats
  currentOrders: string;                    // player's latest orders
  visibleUnits: VisibleUnitInfo[];          // alive troops under command
  visibleEnemies?: VisibleEnemyInfo[];      // enemies within visibility radius
  authorizedPeers: string[];               // peer lieutenant IDs for messaging
  terrain: string;                          // terrain description
  recentMessages: RecentMessage[];          // conversation history
  peerStates?: PeerStateInfo[];             // peer troop count, morale, action
  pendingBusMessages?: PendingBusMessageInfo[]; // drained from the bus
  memorySummary?: string;                   // beliefs + observations
}
```

The context assembly process:

1. **Gather troops** -- iterate all alive troop agents assigned to this lieutenant, collecting position, health, and morale.
2. **Find enemies** -- find all alive enemy agents within the lieutenant's visibility radius (150 units), recording position and distance.
3. **Collect peer state** -- for each authorized peer lieutenant, count alive/total troops, compute average morale, note current action and position.
4. **Drain bus messages** -- call `drainFor(bus, lieutenantId)` to extract pending messages, formatting them as `{ from, type, content }`. The content is pulled from the payload's `message` or `content` field, falling back to JSON stringification.
5. **Describe terrain** -- format the simulation's terrain features as a human-readable string (e.g., "Terrain features: hill at (300, 200), forest at (500, 100).").
6. **Build identity** -- extract the lieutenant's name, personality, and stats from the agent state.
7. **Package** -- assemble all data into the `LieutenantContext` structure. `peerStates` and `pendingBusMessages` are only included if non-empty.

### Coordinator Flow Per Tick

```
Simulation Tick
      |
      v
tickCoordinator(coord)          -- advance idle counters
      |
      v
[Battle events happen]          -- combat, deaths, stalemate, etc.
      |
      +-- recordCasualty()      -- on troop death
      +-- recordSupportRequest() -- on support_request bus message
      +-- recordPeerMessage()   -- on peer_message bus message
      +-- recordStalemateWarning() -- on stalemate detection
      |
      v
getLieutenantsNeedingReinvocation()
      |
      v
[For each lieutenant needing reinvocation:]
      |
      +-- buildEnrichedContext()   -- assemble LLM prompt data
      +-- (server makes async LLM call)
      +-- markLieutenantReinvoked() -- reset tracker
```

---

## Reinvocation System

**Source:** `src/server/agents/reinvocation.ts`

Lieutenants are not fire-and-forget. The reinvocation system tracks significant battlefield events per lieutenant and determines when the LLM should be re-called to reassess the situation. This closes the feedback loop: lieutenants react to changing conditions rather than running stale flowcharts indefinitely.

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `REINVOCATION_COOLDOWN_TICKS` | 50 | Minimum ticks between re-invocations (5 seconds at 10 ticks/sec) |
| `CASUALTY_THRESHOLD` | 3 | Number of troop deaths before triggering |
| `SUPPORT_REQUEST_THRESHOLD` | 2 | Number of support requests before triggering |
| `IDLE_THRESHOLD_TICKS` | 150 | Ticks of inactivity before forced reassessment (15 seconds) |

### Data Structure

```ts
type ReinvocationEventType =
  | 'casualty'
  | 'support_request'
  | 'peer_message'
  | 'tick'
  | 'stalemate_warning';

interface ReinvocationTracker {
  lieutenantId: string;
  casualtiesSinceLastCall: number;      // troop deaths under this lieutenant
  supportRequestsSinceLastCall: number; // support requests from troops
  peerMessagesPending: number;          // messages from peer lieutenants
  ticksSinceLastCall: number;           // ticks since last LLM call
  stalemateWarning: boolean;            // stalemate warning received
  lastCallTick: number;                 // tick of most recent LLM call
}
```

### Trigger Thresholds

| Trigger | Event Type | Threshold | Cooldown |
|---------|------------|-----------|----------|
| Troop casualties | `casualty` | 3 deaths | 50 ticks (5 seconds) |
| Support requests | `support_request` | 2 requests | 50 ticks (5 seconds) |
| Peer message | `peer_message` | 1 message | 50 ticks (5 seconds) |
| Stalemate warning | `stalemate_warning` | 1 event | 50 ticks (5 seconds) |
| Idle timeout | `tick` | 150 ticks (15 seconds) | N/A |

### Reinvocation Logic

```
shouldReinvoke(tracker):

  1. IF ticksSinceLastCall >= 150 (idle threshold)
       RETURN true                         -- always reinvoke after 15s idle

  2. IF ticksSinceLastCall < 50 (cooldown)
       RETURN false                        -- respect 5s cooldown between calls

  3. IF casualties >= 3                    RETURN true
     IF supportRequests >= 2               RETURN true
     IF peerMessages > 0                   RETURN true
     IF stalemateWarning == true           RETURN true

  4. RETURN false
```

Key design decisions:

- The **idle threshold bypasses cooldown** -- if a lieutenant has not been called in 15 seconds, it is reinvoked regardless of other conditions. This ensures periodic reassessment even in quiet moments.
- All other triggers **respect the 50-tick cooldown** -- this prevents rapid re-invocations when many events fire at once (e.g., during a large engagement with multiple casualties).
- **Peer messages have a threshold of 1** -- any peer communication immediately warrants a reassessment (after cooldown), because peers coordinate deliberately.
- **Stalemate warnings have a threshold of 1** -- the situation is critical enough to force an immediate response (after cooldown).

### Reset Behavior

When `markReinvoked(tracker, currentTick)` is called after a successful LLM call, all counters are zeroed:

```ts
tracker.casualtiesSinceLastCall = 0;
tracker.supportRequestsSinceLastCall = 0;
tracker.peerMessagesPending = 0;
tracker.ticksSinceLastCall = 0;
tracker.stalemateWarning = false;
tracker.lastCallTick = currentTick;
```

---

## Agent Working Memory

**Source:** `src/server/agents/memory.ts`

Lieutenants have persistent working memory that accumulates across LLM calls. This allows them to build situational awareness over time rather than treating each invocation as a blank slate.

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_OBSERVATIONS` | 20 | Maximum observations retained before oldest are evicted |

### Data Structures

```ts
interface Observation {
  tick: number;      // simulation tick when recorded
  type: string;      // category (casualty, routing, engagement, etc.)
  summary: string;   // human-readable description
}

interface AgentMemory {
  agentId: string;
  beliefs: Map<string, unknown>;   // named key-value pairs
  observations: Observation[];      // rolling log, capped at MAX_OBSERVATIONS
}
```

### Two Types of Memory

**Beliefs** are named key-value pairs that the LLM can read and write. They represent the lieutenant's understanding of the battlefield:
- Enemy positions and movements
- Threat assessments
- Current tactical plans
- Estimated enemy strength

Beliefs are set via the `updated_beliefs` field in the lieutenant's LLM output. They persist until explicitly overwritten. There is no limit on the number of beliefs.

**Observations** are a rolling log of significant events, automatically recorded by the memory recorder. The log is capped at **20 entries**. When the cap is reached, the oldest observation is evicted (FIFO via `Array.shift()`).

### API

| Function | Signature | Description |
|----------|-----------|-------------|
| `createAgentMemory(agentId)` | `(string) => AgentMemory` | Creates fresh empty memory for an agent |
| `setBelief(mem, key, value)` | `(AgentMemory, string, unknown) => void` | Sets or updates a named belief |
| `getBelief(mem, key)` | `(AgentMemory, string) => unknown` | Retrieves a belief (returns `undefined` if not set) |
| `recordObservation(mem, tick, type, summary)` | `(AgentMemory, number, string, string) => void` | Records an observation, evicting oldest if at capacity |
| `getRecentObservations(mem, count)` | `(AgentMemory, number) => Observation[]` | Returns the N most recent observations |
| `buildMemorySummary(mem)` | `(AgentMemory) => string` | Formats beliefs and observations into a human-readable section for the LLM prompt |

### Memory Summary Format

The `buildMemorySummary()` function produces text included in the LLM prompt under the "Working Memory" heading. Example output:

```
Beliefs:
- enemy_position: {"x": 400, "y": 300}
- threat_level: high
- current_plan: flanking from the north

Recent observations:
- [tick 120] (casualty) Player troop-3 was killed by enemy-vanguard-2
- [tick 135] (engagement) Player troop-1 engaged enemy-infantry-4
- [tick 180] (stalemate) The battle has stalled -- forces are not engaging!
```

If no beliefs exist, the beliefs section is omitted. If no observations exist, it shows "No observations recorded yet."

---

## Memory Recorder

**Source:** `src/server/agents/memory-recorder.ts`

The memory recorder automatically translates simulation battle events into observations stored in lieutenant memory. It is called by the server layer after each tick to keep lieutenant memory updated with battlefield developments.

### API

| Function | Signature | Description |
|----------|-----------|-------------|
| `recordBattleEvents(mem, events, tick, team)` | `(AgentMemory, BattleEvent[], number, 'player' \| 'enemy') => void` | Records relevant battle events as observations in memory |

### Recorded Event Types

| Battle Event Type | Observation Type | Description |
|-------------------|-----------------|-------------|
| `kill` | `casualty` | A troop was killed |
| `retreat` | `routing` | A troop is routing (fleeing) |
| `squad_wiped` | `squad_wiped` | An entire squad has been eliminated |
| `engagement` | `engagement` | A new combat engagement started |
| `casualty_milestone` | `casualties` | Squad hit a casualty threshold (25%, 50%, 75%) |
| `stalemate_warning` | `stalemate` | No combat for 10 seconds |

### Filtering Rules

- Events are filtered by **team**: a lieutenant only receives observations about their own team's events.
- **Exception**: `stalemate_warning` and `stalemate_force_advance` events are recorded for all teams, since stalemate affects the entire battlefield.
- The recorder uses the battle event's `message` field directly as the observation summary.

---

## Lieutenant Output Schema

When a lieutenant LLM is called, it produces structured JSON that drives communication and troop behavior:

```ts
type LieutenantOutput = {
  directives: FlowchartDirective[]         // flowcharts for troops
  self_directives?: FlowchartDirective[]   // flowcharts for the lieutenant itself
  message_up?: string                      // report to commander/player
  message_peers?: {                        // messages to peer lieutenants
    to: string;
    content: string;
  }[]
  response_to_player?: string             // proactive message to the player
  updated_beliefs?: Record<string, unknown> // persist knowledge across calls
}
```

### Communication Fields

**`message_up`** -- Report sent upward to the commander. Used for status reports, warnings, and tactical observations.

**`message_peers`** -- Array of messages to send to peer lieutenants via the message bus. Each entry specifies a recipient (`to`) and content. Only peers listed in the lieutenant's `authorizedPeers` should be targeted.

**`response_to_player`** -- Proactive message delivered to the player via WebSocket (or NDJSON in headless mode) as a `type: 'response'` message. Use cases include:
- Status reports without being asked
- Warnings about dangerous situations
- Pushback on risky orders
- Tactical observations the player should know about

**`updated_beliefs`** -- Key-value pairs to store in the lieutenant's working memory. These persist across LLM calls and appear in the "Working Memory" section of future prompts.

### Directive Compilation Flow

1. LLM outputs structured JSON matching the schema above.
2. `parseLieutenantOutput()` validates the output.
3. `compileDirectives()` resolves unit patterns (`"all"`, `"squad_*"`, specific IDs) and converts directives to `Flowchart` objects.
4. `applyFlowcharts()` or `queueFlowchartSwap()` installs the new flowcharts into agent runtimes.

---

## LLM Prompt Structure

**Source:** `src/server/agents/input-builder.ts`

The `buildLieutenantPrompt()` function assembles a complete system prompt from the `LieutenantContext`. The prompt includes these sections in order:

1. **Identity** -- name, personality description, personality guidance, stats (initiative, discipline, communication)
2. **Current Orders** -- the player's latest orders for this lieutenant
3. **Units Under Your Command** -- position, health, morale of each alive troop
4. **Visible Enemy Positions** -- enemies within visibility radius with distance
5. **Authorized Peer Communication** -- list of peer lieutenant IDs
6. **Peer Status** -- (if peers exist) position, troop count, morale, current action of each peer
7. **Incoming Messages** -- (if bus messages pending) formatted as `[type] from sender: content`
8. **Terrain** -- description of terrain features on the battlefield
9. **Working Memory** -- (if memory exists) beliefs and observations from previous calls
10. **Recent Messages** -- conversation history, sorted newest first
11. **Event Types** -- full vocabulary of flowchart trigger events
12. **Action Types** -- full vocabulary of available troop actions
13. **Output Format** -- JSON schema and rules for the response

Personality guidance is tailored per personality type:
- **aggressive**: favors bold, direct action; interprets ambiguity toward attack
- **cautious**: favors careful, measured action; prioritizes troop survival
- **disciplined**: follows orders precisely; maintains formation and coordination
- **impulsive**: acts quickly on instinct; may anticipate orders or overextend

---

## End-to-End Communication Flow

This section traces a complete communication cycle from player command to troop response and back.

### 1. Player Issues an Order

```
Player: "Alpha, take the hill on the east side"
                    |
                    v
          Server receives text
                    |
                    v
        Lieutenant "Alpha" is targeted
                    |
                    v
      buildEnrichedContext() assembles:
        - Identity, personality, stats
        - Current orders (updated)
        - Troop positions, health, morale
        - Visible enemies
        - Peer states (troop counts, morale, actions)
        - Pending bus messages
        - Terrain description
        - Working memory (beliefs + observations)
                    |
                    v
          LLM call (async, non-blocking)
```

### 2. Lieutenant Responds

```
LLM returns LieutenantOutput:
  {
    directives: [
      { unit: "all", nodes: [
        { on: "tick", action: { type: "moveTo", position: {x: 700, y: 200} } },
        { on: "enemy_spotted", condition: "distance < 80",
          action: { type: "setFormation", formation: "wedge" } },
        { on: "under_attack", action: { type: "engage" } }
      ]}
    ],
    message_up: "Moving to take the eastern hill, enemies spotted nearby",
    message_peers: [
      { to: "lt-bravo", content: "Advancing on eastern hill, cover my flank" }
    ],
    response_to_player: "Copy that. Moving my squad to the eastern hill.
                         I see enemy scouts nearby -- will engage if needed.",
    updated_beliefs: {
      "current_objective": "take eastern hill",
      "enemy_scouts_spotted": true
    }
  }
```

### 3. Messages Are Routed

```
directives -----> compiled into flowcharts for troops
                  (troops begin executing immediately)

message_up -----> displayed to player (commander report)

message_peers --> sent via message bus to lt-bravo
                  (enqueued as peer_message)

response_to_player --> delivered via WebSocket to player UI

updated_beliefs --> stored in Alpha's AgentMemory
                    (available in next LLM call)
```

### 4. Troops Execute and Report Back

```
Troops execute flowcharts:
  - moveTo(700, 200) -- advancing toward hill
  - enemy_spotted fires -- troops switch to wedge formation
  - under_attack fires -- troops engage

During combat, a troop executes requestSupport:
                    |
                    v
  BusMessage {
    from: "troop-alpha-3",
    to: "lt-alpha",
    type: "support_request",
    payload: { message: "Taking heavy fire on the hill!" },
    priority: 7,
    tick: 245
  }
                    |
                    v
  Coordinator records support request for lt-alpha
                    |
                    v
  After 2 support requests (threshold met) + cooldown elapsed:
    shouldReinvoke(tracker) returns true
                    |
                    v
  buildEnrichedContext() includes:
    pendingBusMessages: [
      { from: "troop-alpha-3", type: "support_request",
        content: "Taking heavy fire on the hill!" },
      { from: "troop-alpha-1", type: "support_request",
        content: "Need backup!" }
    ]
                    |
                    v
  Lieutenant Alpha is re-invoked with updated context
  (LLM generates new flowcharts responding to the situation)
```

### 5. Stalemate Escalation

```
100 ticks with no combat damage
            |
            v
  StalemateTracker transitions to 'warning'
            |
            v
  Broadcast via message bus:
    BusMessage {
      from: "simulation",
      to: null,            <-- broadcast to all
      type: "stalemate_warning",
      payload: { message: "Battle has stalled..." },
      priority: 9,         <-- highest priority
      tick: current
    }
            |
            v
  Coordinator: recordStalemateWarning()
    (sets stalemateWarning = true on ALL trackers)
            |
            v
  Memory Recorder: records stalemate observation
    in ALL lieutenant memories
            |
            v
  All lieutenants are reinvoked with stalemate context
            |
            v
  200 ticks with no combat:
    Simulation FORCES all troops toward map center
    (bypasses flowcharts entirely)
```

---

## Stalemate Detection Integration

**Source:** `src/server/engine/stalemate.ts`

The stalemate system is part of the communication flow because it injects messages into the bus and triggers reinvocation.

| Threshold | Ticks | Time | Action |
|-----------|-------|------|--------|
| Warning | 100 | 10 seconds | Broadcasts `stalemate_warning` via message bus to all lieutenants |
| Force advance | 200 | 20 seconds | Forces all troops toward map center (bypasses flowcharts) |

The tracker is a simple state machine: `none` -> `warning` -> `force_advance`. Any combat damage resets the tracker entirely (ticks, warning flag, and force-advance flag all return to initial state).

---

## Complete System Diagram

```
                    +-------------------+
                    |   Player (UI)     |
                    +--------+----------+
                             | orders (WebSocket)
                             v
                    +-------------------+
                    | Lieutenant LLM    |<---- reinvocation triggers
                    +--------+----------+
                             | LieutenantOutput (JSON)
                             v
                    +-------------------+
                    | Flowchart Compiler |
                    +--------+----------+
                             | Flowcharts
                             v
                    +-------------------+
                    | Agent Runtimes    |<---- events from simulation
                    +--------+----------+
                             | actions (moveTo, engage, requestSupport, emit, ...)
                             v
+-----------+       +-------------------+       +------------+
|  Memory   |<----->|   Simulation      |------>|  Message   |
|  Recorder |       |   (10 ticks/sec)  |       |    Bus     |
+-----------+       +--------+----------+       +-----+------+
      |                      |                        |
      v                      v                        v
+-----------+       +-------------------+       +-----------+
|   Agent   |       |   Stalemate       |       | drainFor()|
|   Memory  |       |   Tracker         |       | (per lt)  |
| (beliefs  |       | (100t warn,       |       +-----------+
|  + obs)   |       |  200t force)      |             |
+-----------+       +-------------------+             |
      |                      |                        |
      +------+---------------+------------------------+
             |
             v
      +-------------------+
      |   Coordinator     |
      |  (reinvocation    |
      |   orchestration)  |
      +--------+----------+
               |
               v
      buildEnrichedContext()
               |
               v
      LieutenantContext for LLM
```

---

## Design Principles

1. **Decoupled messaging.** The bus decouples senders from receivers. Troops do not need to know which lieutenant they report to at the action level -- the simulation handles routing based on the troop's `lieutenantId`.

2. **Priority-driven processing.** Higher priority messages are always processed first. Alerts (priority 8-9) outrank reports (priority 3), ensuring urgent information is not buried by routine status updates.

3. **Cooldown prevents thrashing.** The 50-tick (5-second) cooldown between reinvocations prevents the LLM from being called repeatedly when many events fire simultaneously (e.g., during a large engagement with multiple casualties on the same tick).

4. **Idle timeout ensures responsiveness.** Even in quiet moments, lieutenants are re-invoked every 15 seconds to reassess the situation and potentially take initiative. The idle threshold bypasses the normal cooldown check.

5. **Memory accumulates context.** Working memory (beliefs + observations) gives lieutenants continuity across invocations. They build understanding over time rather than starting fresh each call. Beliefs are LLM-controlled; observations are system-recorded.

6. **LLM calls are async and non-blocking.** The simulation continues running while LLM calls are in flight. Troops execute their current flowcharts until new output arrives. This means there is always a lag between a battlefield change and the lieutenant's response.

7. **Graceful degradation.** If a lieutenant's LLM call fails or is slow, troops continue executing their last-compiled flowcharts. The system does not stall or crash. Malformed output is validated and rejected, not blindly applied.
