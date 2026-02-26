# Event System

The event system is the core primitive of Warchief. Every troop agent runs on events. Lieutenants write in this vocabulary when they produce flowchart logic. Events flow from the simulation into agent flowcharts, and actions flow back out to the simulation.

```
Simulation  --(events)-->  Flowchart Runtime  --(actions)-->  Simulation
```

## Source Files

| File | Purpose |
|------|---------|
| `/src/shared/events/index.ts` | Event and action type definitions |
| `/src/shared/types/index.ts` | Core types (`Vec2`, `FormationType`, `AgentState`) |
| `/src/server/runtime/flowchart.ts` | Flowchart compiler, runtime, and event processing |
| `/src/server/engine/event-detection.ts` | Expanded event detection (formation, morale, terrain) |
| `/src/server/engine/conditions.ts` | Safe condition evaluator (no `eval()`) |
| `/src/server/sim/simulation.ts` | Simulation loop that fires events and executes actions |

---

## Events (Inputs to an Agent)

Events are the inputs that agents receive. The simulation detects battlefield conditions and queues events into each agent's flowchart runtime. Lieutenants write flowchart nodes that listen for these event types and respond with actions.

### Core Events

These events are fired by the main simulation loop every tick or in response to immediate battlefield changes.

#### `enemy_spotted`

Fired when the closest visible enemy is detected within the agent's visibility radius. Only the closest enemy generates this event per visibility check (every 10 ticks).

```ts
{
  type: 'enemy_spotted',
  enemyId: string,      // ID of the closest visible enemy
  position: Vec2,       // enemy's current position { x, y }
  distance: number      // distance in simulation units
}
```

**When it fires:** Every 10 ticks during the visibility update phase, if any enemies are within the agent's visibility radius (60 units for troops, 150 units for lieutenants). Terrain affects visibility -- hills grant +20 bonus, forests apply 0.5x concealment.

#### `under_attack`

Fired immediately when the agent takes damage from combat.

```ts
{
  type: 'under_attack',
  attackerId: string,   // ID of the agent dealing damage
  damage: number        // amount of damage received
}
```

**When it fires:** During combat resolution, after damage is calculated. One event per combat pair per tick.

#### `flanked`

Fired when the agent is attacked from the side or rear. Flanking direction is determined by the relative positions of attacker and defender.

```ts
{
  type: 'flanked',
  direction: 'left' | 'right' | 'rear'   // which direction the attack comes from
}
```

**When it fires:** During combat resolution, when flanking detection determines the attack angle is not frontal. Rear attacks deal 1.6x damage; side attacks deal 1.3x damage.

#### `message`

Fired when another agent sends a message to this agent.

```ts
{
  type: 'message',
  from: string,     // ID of the sending agent
  content: string   // message text
}
```

#### `ally_down`

Fired when a nearby allied unit dies. Delivered to all allies within `MORALE_EFFECT_RANGE` (50 units).

```ts
{
  type: 'ally_down',
  unitId: string,    // ID of the fallen ally
  position: Vec2     // where the ally died
}
```

**When it fires:** During combat resolution, when an agent's health drops to 0 or below. Nearby allies also suffer -5 morale.

#### `casualty_threshold`

Fired to all surviving troops in a squad when a squad member dies. Reports the cumulative loss percentage for the squad.

```ts
{
  type: 'casualty_threshold',
  lossPercent: number   // percentage of original squad that is dead (0-100)
}
```

**When it fires:** After a squad member's death, if the squad has recorded casualties. Delivered to all surviving members of the same squad.

#### `order_received`

Fired when the agent receives an explicit order from a superior.

```ts
{
  type: 'order_received',
  order: string,   // the order text
  from: string     // ID of the issuing agent
}
```

#### `tick`

Internal event fired every simulation tick. Allows agents to take periodic actions regardless of battlefield conditions.

```ts
{
  type: 'tick',
  tick: number   // current simulation tick number
}
```

**When it fires:** Every tick, for every agent that is alive and not routing.

#### `arrived`

Fired when an agent reaches its target position (within arrival threshold).

```ts
{
  type: 'arrived',
  position: Vec2   // the position the agent arrived at
}
```

**When it fires:** During movement processing, when `isWithinRange(agent.position, target, arrivalThreshold)` returns true.

#### `no_enemies_visible`

Fired when the agent has no enemies within its visibility radius.

```ts
{
  type: 'no_enemies_visible'
}
```

**When it fires:** Every 10 ticks during the visibility update phase, if no enemies are visible to the agent. Mutually exclusive with `enemy_spotted` -- an agent receives one or the other, never both in the same visibility cycle.

### Expanded Events

These events are detected by the expanded event detection system (`/src/server/engine/event-detection.ts`) and fired every 10 ticks (once per second at 10 ticks/second). They provide tactical awareness beyond immediate combat.

#### `formation_broken`

Fired when a lieutenant's squad has lost cohesion. The formation is considered "broken" when fewer than 60% of the squad's troops are alive and not routing.

```ts
{
  type: 'formation_broken',
  reason: 'casualties' | 'engagement' | 'routing',   // why the formation broke
  intactPercent: number   // 0-100, percentage of squad still in formation
}
```

**Detection logic** (in `detectFormationBroken()`):
- Counts all troops assigned to the lieutenant
- A troop is "intact" if it is alive AND not routing
- If `intact / total < 0.6` (the `FORMATION_BROKEN_THRESHOLD`), fires the event
- Reason priority: routing > casualties (dead troops) > engagement

**Delivered to:** All alive troops under the lieutenant, plus the lieutenant itself.

#### `morale_low`

Fired when the average morale of a lieutenant's alive troops drops below the threshold (40).

```ts
{
  type: 'morale_low',
  averageMorale: number,   // squad-wide average morale (0-100)
  lowestMorale: number     // worst individual morale in the squad
}
```

**Detection logic** (in `detectMoraleLow()`):
- Computes average morale across all alive troops under the lieutenant
- Tracks the single lowest morale value
- Fires if `averageMorale < MORALE_LOW_THRESHOLD` (40)

**Delivered to:** All alive troops under the lieutenant, plus the lieutenant itself.

#### `enemy_retreating`

Fired when a visible enemy unit is routing (fleeing). Provides a pursuit opportunity.

```ts
{
  type: 'enemy_retreating',
  enemyId: string,     // ID of the routing enemy
  position: Vec2,      // enemy's current position
  distance: number     // distance from the observing agent
}
```

**Detection logic** (in `detectEnemyRetreating()`):
- For each agent, checks all enemy agents
- An enemy is "retreating" if it is alive AND its `currentAction === 'routing'`
- Only reported if the enemy is within the agent's visibility radius

**Delivered to:** The individual agent that can see the routing enemy. Multiple events may fire if multiple enemies are retreating.

#### `terrain_entered`

Fired when an agent moves into a terrain feature.

```ts
{
  type: 'terrain_entered',
  terrainType: 'hill' | 'forest' | 'river',   // type of terrain entered
  position: Vec2   // agent's current position
}
```

#### `terrain_exited`

Fired when an agent moves out of a terrain feature.

```ts
{
  type: 'terrain_exited',
  terrainType: 'hill' | 'forest' | 'river',   // type of terrain exited
  position: Vec2   // agent's current position
}
```

**Detection logic** (in `detectTerrainTransition()`):
- Each agent's current terrain is tracked via a `TerrainTracker` (a `Map<string, string | null>` mapping agent ID to terrain feature ID)
- Every 10 ticks, the agent's current terrain is compared to the previously recorded terrain
- If the terrain changed, appropriate `terrain_exited` and/or `terrain_entered` events are fired
- Moving directly from one terrain feature to another fires both an exit and an enter event

**Delivered to:** The individual agent that moved.

---

## Actions (Outputs from an Agent)

Actions are the outputs that flowchart nodes produce. When a flowchart node matches an event and its condition passes, the node's action is sent to the simulation for execution.

### `moveTo`

Move toward a target position. Speed is affected by terrain modifiers and the agent's base speed stat.

```ts
{
  type: 'moveTo',
  position: Vec2   // target position { x, y }
}
```

### `setFormation`

Change the formation for the agent's squad. Only meaningful for lieutenants and their troops.

```ts
{
  type: 'setFormation',
  formation: FormationType   // 'line' | 'wedge' | 'scatter' | 'pincer' | 'defensive_circle' | 'column'
}
```

Available formation types and their combat modifiers:

| Formation | Attack | Defense | Best For |
|-----------|--------|---------|----------|
| `line` | 1.0x | 1.0x | Balanced default |
| `wedge` | 1.3x | 0.8x | Aggressive charges |
| `scatter` | 0.85x | 1.15x | Surviving ranged/flanks |
| `pincer` | 1.2x | 0.9x | Flanking maneuvers |
| `defensive_circle` | 0.7x | 1.4x | Last stand defense |
| `column` | 0.6x | 0.7x | Rapid movement (not for combat) |

### `engage`

Engage a specific enemy target in combat. The agent will move toward and attack the target.

```ts
{
  type: 'engage',
  targetId: string   // ID of the enemy to engage
}
```

**Note:** When a flowchart specifies `targetId: ''` (empty string), the simulation fills in the actual target ID at runtime based on the triggering event's `enemyId` or `attackerId`.

### `fallback`

Retreat to a specified position. The agent moves toward the fallback position.

```ts
{
  type: 'fallback',
  position: Vec2   // position to retreat to
}
```

### `hold`

Hold the current position. The agent stops moving and does not pursue enemies, but will still fight if enemies are within combat range.

```ts
{
  type: 'hold'
}
```

### `requestSupport`

Send a support request message up the chain of command. This triggers the message bus and can cause lieutenant re-invocation.

```ts
{
  type: 'requestSupport',
  message: string   // description of the situation
}
```

### `emit`

Emit a report or alert message. Used for communication up the chain.

```ts
{
  type: 'emit',
  eventType: 'report' | 'alert',   // report = informational, alert = urgent
  message: string
}
```

---

## Flowchart Structure

Flowcharts are the compiled logic that lieutenants produce for their troops. Each flowchart is a directed graph of condition/action nodes with a default fallback action.

### Types

Defined in `/src/server/runtime/flowchart.ts`:

```ts
/** A complete flowchart for an agent. */
interface Flowchart {
  agentId: string;            // which agent this flowchart controls
  nodes: FlowchartNode[];     // the logic nodes
  defaultAction: GameAction;  // fallback when no node matches
}

/** A node in the flowchart - the basic unit of logic. */
interface FlowchartNode {
  id: string;               // unique node identifier
  on: EventType;            // which event triggers this node
  condition?: string;       // optional condition expression (e.g., "distance < 50")
  action: GameAction;       // what to do when triggered
  next?: string;            // node ID to chain to after action (for multi-step responses)
  else?: string;            // node ID to follow if condition fails
  priority?: number;        // higher priority nodes are checked first (default 0)
}
```

### Priority

Nodes are sorted by `priority` in descending order (higher numbers checked first). When multiple nodes listen for the same event type, the highest priority node whose condition passes wins. Nodes without an explicit priority default to 0.

### Default Action

The `defaultAction` serves as the fallback behavior. It is only triggered for `under_attack` and `enemy_spotted` events when no flowchart node matches. For other event types, if no node matches, no action is taken.

### Node Chaining

Nodes can chain to other nodes using `next` and `else`:

- **`next`**: After the current node's action is executed, follow this node ID and execute its action too. This enables multi-step responses (e.g., set formation, then engage).
- **`else`**: If the current node's condition fails, follow this node ID instead of trying lower-priority nodes.

Chain depth is limited to 10 to prevent infinite loops from circular references.

### Example Flowchart

A cautious defensive flowchart:

```ts
{
  agentId: "troop_1",
  nodes: [
    {
      id: "engage_close",
      on: "enemy_spotted",
      condition: "distance < 40",
      action: { type: "engage", targetId: "" },
      priority: 10
    },
    {
      id: "hold_far",
      on: "enemy_spotted",
      condition: "distance >= 40",
      action: { type: "hold" },
      priority: 5
    },
    {
      id: "defend",
      on: "under_attack",
      action: { type: "engage", targetId: "" },
      priority: 8
    },
    {
      id: "report_losses",
      on: "casualty_threshold",
      condition: "lossPercent > 20",
      action: { type: "requestSupport", message: "Taking casualties, requesting support" },
      priority: 7
    },
    {
      id: "slow_advance",
      on: "no_enemies_visible",
      action: { type: "moveTo", position: { x: 200, y: 150 } },
      priority: 1
    }
  ],
  defaultAction: { type: "hold" }
}
```

This flowchart:
1. Engages enemies only within 40 units (priority 10)
2. Holds position if enemies are farther away (priority 5)
3. Counter-attacks when hit (priority 8)
4. Requests support if losses exceed 20% (priority 7)
5. Advances slowly when no enemies are visible (priority 1)
6. Falls back to holding position for unmatched `enemy_spotted` or `under_attack` events

### Example with Node Chaining

A two-step engage sequence using `next`:

```ts
{
  agentId: "troop_2",
  nodes: [
    {
      id: "form_up",
      on: "enemy_spotted",
      action: { type: "setFormation", formation: "wedge" },
      next: "charge",
      priority: 10
    },
    {
      id: "charge",
      on: "enemy_spotted",
      action: { type: "engage", targetId: "" }
    }
  ],
  defaultAction: { type: "hold" }
}
```

When `enemy_spotted` fires, this flowchart first sets wedge formation, then chains to the `charge` node and engages the enemy -- producing two actions from a single event.

### Example with Else Branching

Conditional branching using `else`:

```ts
{
  agentId: "troop_3",
  nodes: [
    {
      id: "engage_close",
      on: "enemy_spotted",
      condition: "distance < 20",
      action: { type: "engage", targetId: "" },
      else: "fallback_far",
      priority: 10
    },
    {
      id: "fallback_far",
      on: "enemy_spotted",
      action: { type: "fallback", position: { x: 0, y: 0 } }
    }
  ],
  defaultAction: { type: "hold" }
}
```

If the enemy is within 20 units, engage. Otherwise, fall back to position (0, 0).

---

## Flowchart Runtime

The flowchart runtime executes compiled flowcharts for each agent. Defined in `/src/server/runtime/flowchart.ts`.

### Runtime State

```ts
interface FlowchartRuntime {
  flowchart: Flowchart;           // the compiled flowchart
  currentNodeId: string | null;   // which node is currently active
  eventQueue: GameEvent[];        // pending events to process
  pendingActions: GameAction[];   // actions waiting to be executed
}
```

### Lifecycle

1. **Creation**: `createFlowchartRuntime(flowchart)` initializes a runtime with an empty event queue.
2. **Event queuing**: The simulation calls `queueEvent(runtime, event)` to push events into the agent's queue.
3. **Processing**: Each tick, the simulation calls `processEvents(runtime)` which drains the event queue and returns resulting actions.
4. **Execution**: The simulation executes each returned action (move, engage, set formation, etc.).

### Event Processing Algorithm

When `processEvents()` is called, it processes each queued event in FIFO order:

```
for each event in queue:
  1. Find all flowchart nodes where node.on === event.type
  2. Sort matching nodes by priority (descending)
  3. For each node (highest priority first):
     a. Evaluate the node's condition against the event data
     b. If condition passes:
        - Execute the node's action
        - Follow the "next" chain (up to depth 10)
        - Stop checking other nodes for this event
     c. If condition fails and node has "else":
        - Execute the else node's action
        - Stop checking other nodes for this event
  4. If no node matched:
     - For "under_attack" or "enemy_spotted": use defaultAction
     - For all other event types: do nothing
```

### Routing Override

Routing units (agents with `currentAction === 'routing'`) skip flowchart processing entirely. Routing is controlled by the morale system -- the agent flees toward its spawn point until morale recovers to 50 or above.

---

## Condition Evaluation

Conditions are evaluated using a safe expression parser in `/src/server/engine/conditions.ts`. This replaces `eval()` with a purpose-built tokenizer and parser that only supports the limited syntax needed for flowchart conditions.

### Supported Syntax

| Feature | Example |
|---------|---------|
| Comparison operators | `<`, `>`, `<=`, `>=`, `==`, `!=` |
| Logical operators | `&&`, `||` |
| Parentheses | `(distance < 50) && (damage > 10)` |
| Number literals | `50`, `3.5`, `-10` |
| String literals | `"left"`, `"rear"` |
| Boolean literals | `true`, `false` (converted to 1/0) |
| Event data variables | `distance`, `lossPercent`, `damage`, `direction` |

### Variable Resolution

Variables in conditions are resolved from the event data. For example, in the condition `distance < 50` evaluated against an `enemy_spotted` event with `{ distance: 30 }`, the variable `distance` resolves to `30`.

If a variable is not found in the event data, it resolves to `0` (for numbers) or `0` (falsy).

### Safety Rules

- **Empty or undefined conditions always return `true`** -- an unconditional node always matches.
- **Malformed conditions return `false`** -- fail-safe behavior prevents broken conditions from triggering actions.
- **No code execution** -- the parser only supports the syntax listed above. Expressions like `process.exit()` are rejected.

### Condition Examples

```ts
// Simple comparison against event data
evaluateCondition('distance < 50', { type: 'enemy_spotted', distance: 30 })
// => true

// Compound condition
evaluateCondition('distance >= 100 && damage > 5', { type: 'under_attack', distance: 120, damage: 10 })
// => true

// String comparison
evaluateCondition('direction == "rear"', { type: 'flanked', direction: 'rear' })
// => true

// Threshold check
evaluateCondition('lossPercent > 30', { type: 'casualty_threshold', lossPercent: 25 })
// => false

// Empty condition (always matches)
evaluateCondition('', { type: 'tick', tick: 100 })
// => true
```

---

## Simulation Integration

The simulation loop (`/src/server/sim/simulation.ts`) runs at 10 ticks per second. Events are fired at specific points in the tick cycle.

### Tick Cycle and Event Firing Points

```
1.  updateVisibility()
    - Fires: enemy_spotted OR no_enemies_visible (every 10 ticks)

1b. detectExpandedEvents()
    - Fires: formation_broken, morale_low (per lieutenant, to all their troops)
    - Fires: enemy_retreating (per agent, if visible routing enemies)
    - Fires: terrain_entered, terrain_exited (per agent, on terrain boundary change)

2.  processFlowchartEvents()
    - Queues: tick (every tick, to every alive non-routing agent)
    - Processes all queued events through each agent's flowchart
    - Executes resulting actions

3.  maintainFormations()
    - (No events fired)

4.  moveAgents()
    - Fires: arrived (when agent reaches target position)

5.  separateOverlappingUnits()
    - (No events fired)

6.  resolveCombat()
    - Fires: under_attack (to defenders taking damage)
    - Fires: flanked (when attack comes from side/rear)
    - Fires: ally_down (to nearby allies when a unit dies)
    - Fires: casualty_threshold (to squad members when losses accumulate)

7.  checkMoraleAndRouting()
    - (No events fired directly; routing state changes are internal)

8.  recoverMorale()
    - (No events fired)

9.  checkWinCondition()
    - (No events fired to agents)

10. trackMovingAgents()
    - (No events fired)

11. stalemateDetection()
    - Broadcasts stalemate_warning via message bus (not the event system)

12. fireCallbacks()
    - (External callbacks, not agent events)
```

### Event Firing Frequency

| Event | Frequency | Phase |
|-------|-----------|-------|
| `tick` | Every tick | Phase 2 |
| `enemy_spotted` | Every 10 ticks | Phase 1 |
| `no_enemies_visible` | Every 10 ticks | Phase 1 |
| `formation_broken` | Every 10 ticks | Phase 1b |
| `morale_low` | Every 10 ticks | Phase 1b |
| `enemy_retreating` | Every 10 ticks | Phase 1b |
| `terrain_entered` | Every 10 ticks | Phase 1b |
| `terrain_exited` | Every 10 ticks | Phase 1b |
| `under_attack` | Every tick (during combat) | Phase 6 |
| `flanked` | Every tick (during combat) | Phase 6 |
| `ally_down` | On death | Phase 6 |
| `casualty_threshold` | On death | Phase 6 |
| `arrived` | On arrival | Phase 4 |
| `message` | On message receipt | Varies |
| `order_received` | On order receipt | Varies |

---

## Personality-Based Default Flowcharts

When no lieutenant briefing is available, troops receive a default flowchart based on their lieutenant's personality. These are defined in `/src/server/runtime/flowchart.ts`.

### Aggressive

Engages all spotted enemies immediately. Advances when clear. Pushes forward even when allies fall.

### Cautious

Only engages enemies within 40 units. Holds position when enemies are far. Requests support when casualties exceed 20%. Advances slowly when clear.

### Disciplined

Engages at medium range (60 units). Holds at longer ranges. Maintains line formation when idle. Advances in an orderly fashion.

### Impulsive

Charges any spotted enemy regardless of distance. Rushes forward aggressively when clear. Scatters formation when flanked.

---

## Design Principles

1. **Stability**: Event names and action signatures must remain stable. Changing them requires updating all dependent schemas, prompts, and lieutenant output validation.

2. **Fail-safe conditions**: Malformed conditions evaluate to `false`, preventing broken flowcharts from causing unexpected behavior.

3. **Default fallbacks**: Every flowchart must have a `defaultAction`. Unhandled events should result in safe behavior (typically `hold`).

4. **Routing override**: The morale system takes precedence over flowcharts. Routing units ignore their flowchart entirely until morale recovers.

5. **No LLM calls for troops**: Troops are purely flowchart-driven. Only lieutenants invoke LLMs. This keeps the simulation deterministic and fast at the troop level.

6. **Chain depth limits**: The `next` chain is capped at 10 to prevent infinite loops from circular references in flowchart graphs.
