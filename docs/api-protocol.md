# Warchief WebSocket API Protocol

Warchief uses a WebSocket connection for all real-time communication between the browser client and the game server. Every message is a JSON object with a `type` field and a `data` field.

## Connection

- **Development:** `ws://localhost:3000/ws`
- **Production:** `wss://<host>/ws` (automatically selected based on page protocol)

The server uses the `ws` library with the WebSocket endpoint mounted at the `/ws` path on the HTTP server.

### Connection Lifecycle

Each WebSocket connection creates a server-side `GameSession` that tracks:

- API key and Anthropic client instance
- Selected LLM model
- Game mode (`human_vs_ai` or `ai_vs_ai`)
- Simulation state, lieutenants, and AI commanders
- Simulation timer and speed multiplier
- Reinvocation coordinator

When the client disconnects, the session is destroyed and any running simulation timer is cleared.

### Reconnection

The client automatically attempts to reconnect after 2 seconds when the connection drops.

---

## Message Format

All messages (both directions) follow this envelope:

```json
{
  "type": "<message_type>",
  "data": { ... }
}
```

---

## Client to Server Messages

### `set_api_key`

Validate and store an Anthropic API key. The server tests the key by making a minimal API call.

```json
{
  "type": "set_api_key",
  "data": {
    "apiKey": "sk-ant-..."
  }
}
```

**Validation:** The key must start with `sk-`. The server makes a test call to the Anthropic API using the currently selected model. On success, the session stores the key and creates an Anthropic client.

**Responses:**
- `api_key_valid` on success
- `error` if the key format is invalid or the API call fails

**Note:** If the server has `ANTHROPIC_API_KEY` set as an environment variable, the client does not need to send this message. The `connected` message will indicate this via `hasServerKey: true`.

---

### `set_model`

Change the LLM model used for lieutenant inference.

```json
{
  "type": "set_model",
  "data": {
    "model": "claude-sonnet-4-20250514"
  }
}
```

**Available models:**

| Model ID | Display Name |
|---|---|
| `claude-sonnet-4-20250514` | Claude Sonnet 4 (default) |
| `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet |
| `claude-3-5-haiku-20241022` | Claude 3.5 Haiku (faster) |

**Response:** `model_set`

---

### `set_game_mode`

Switch between human-controlled and fully AI-controlled game modes.

```json
{
  "type": "set_game_mode",
  "data": {
    "mode": "human_vs_ai"
  }
}
```

**Valid modes:**
- `human_vs_ai` -- Player issues orders to lieutenants; enemy is AI-commanded
- `ai_vs_ai` -- Both sides are AI-commanded; player observes

**Response:** `game_mode_set`

---

### `init_scenario`

Load a battle scenario. This creates the simulation, spawns troops and lieutenants, and applies default personality-based flowcharts. It does **not** start the battle -- the player can inspect troop info and conduct pre-battle briefings first.

```json
{
  "type": "init_scenario",
  "data": {
    "scenario": "basic",
    "gameMode": "human_vs_ai",
    "playerPersonality": "balanced",
    "enemyPersonality": "aggressive"
  }
}
```

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `scenario` | `"basic" \| "assault" \| "river_crossing"` | No (default: `"basic"`) | Which scenario to load |
| `gameMode` | `"human_vs_ai" \| "ai_vs_ai"` | No | Override game mode |
| `playerPersonality` | `"aggressive" \| "cautious" \| "balanced"` | No | Player AI commander personality (ai_vs_ai) |
| `enemyPersonality` | `"aggressive" \| "cautious" \| "balanced"` | No | Enemy AI commander personality |

**Responses:** `lieutenants` followed by `scenario_ready`

**Side effects:**
- Stops any running battle on the session
- Creates the simulation with terrain, troops, and lieutenants
- Assigns personality-based default flowcharts to all player troops
- Creates a reinvocation coordinator for all lieutenants

---

### `pre_battle_brief`

Send a conversational order to a player lieutenant before the battle starts. Supports multiple rounds of back-and-forth. The lieutenant processes the message via LLM, updates its flowcharts, and responds.

```json
{
  "type": "pre_battle_brief",
  "data": {
    "lieutenantId": "lt_alpha",
    "message": "Form a wedge and push up the center aggressively. Engage any enemies on sight."
  }
}
```

**Prerequisites:** `init_scenario` must have been called. API key must be set.

**Error conditions:**
- API key not set
- Scenario not initialized
- Lieutenant not found
- Lieutenant is busy (still processing a previous message)

**Responses:**
1. `message` (type `"order"`) -- echoes the player's message
2. `flowchart` -- updated flowchart rules compiled from the LLM output
3. `message` (type `"report"`) -- the lieutenant's response (from `message_up`)

If the LLM output fails validation, the lieutenant responds with an `"alert"` type message explaining the error.

---

### `init_battle`

Initialize AI commanders and brief all lieutenants. In `human_vs_ai` mode, this creates the enemy AI commander and briefs enemy lieutenants. In `ai_vs_ai` mode, both sides get AI commanders. If the scenario was not previously initialized (legacy flow), this also creates the scenario using the `basic` map.

```json
{
  "type": "init_battle",
  "data": {
    "gameMode": "human_vs_ai",
    "playerPersonality": "balanced",
    "enemyPersonality": "aggressive",
    "briefings": {
      "lt_alpha": "Hold the left flank",
      "lt_bravo": "Push center with wedge formation"
    }
  }
}
```

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `gameMode` | `"human_vs_ai" \| "ai_vs_ai"` | No | Override game mode |
| `playerPersonality` | `"aggressive" \| "cautious" \| "balanced"` | No | Player AI commander personality |
| `enemyPersonality` | `"aggressive" \| "cautious" \| "balanced"` | No | Enemy AI commander personality |
| `briefings` | `Record<string, string>` | No | Final briefings per lieutenant (applied if not already sent conversationally) |

**Responses:** `state`, `lieutenants`, `flowchart` (one per lieutenant), then `battle_ready`

---

### `start_battle`

Begin the simulation. Teleports troops into their formation slots and starts the tick loop.

```json
{
  "type": "start_battle",
  "data": {}
}
```

**Prerequisites:** `init_battle` must have been called (or at minimum `init_scenario` with a simulation present).

**Response:** `battle_started`

**Side effects:**
- Calls `applyInitialFormations()` to snap troops into formation positions
- Sets `simulation.battle.running = true`
- Starts the simulation interval timer (100ms per tick at 1x speed)

---

### `pause_battle`

Pause the running simulation. Stops the tick timer and marks the battle as not running.

```json
{
  "type": "pause_battle",
  "data": {}
}
```

**Response:** `battle_paused`

---

### `resume_battle`

Resume a paused simulation. Restarts the tick timer.

```json
{
  "type": "resume_battle",
  "data": {}
}
```

**Response:** `battle_resumed`

---

### `send_order`

Issue a mid-battle command to a player lieutenant. Only available in `human_vs_ai` mode. The lieutenant processes the order via LLM and updates its flowcharts.

```json
{
  "type": "send_order",
  "data": {
    "lieutenantId": "lt_bravo",
    "order": "Fall back to our starting position and form a defensive circle"
  }
}
```

**Error conditions:**
- `ai_vs_ai` mode active (manual orders not allowed)
- API key not set
- Lieutenant not found
- Lieutenant is busy

**Responses:**
1. `message` (type `"order"`) -- echoes the player's order
2. `message` (type `"report"`) -- the lieutenant's acknowledgment (from `message_up`)
3. `message` (type `"response"`) -- proactive lieutenant message (from `response_to_player`, if any)
4. `flowchart` -- updated flowchart rules

If processing fails, a `message` of type `"alert"` is sent with the error.

---

### `set_speed`

Change the simulation tick speed.

```json
{
  "type": "set_speed",
  "data": {
    "speed": 2
  }
}
```

**Valid speeds:** `0.5`, `1`, `2`

The tick interval is calculated as `Math.round(100 / speed)` milliseconds:
- `0.5x` = 200ms per tick (5 ticks/sec)
- `1x` = 100ms per tick (10 ticks/sec)
- `2x` = 50ms per tick (20 ticks/sec)

**Response:** `speed_set`

If the battle is running, the timer is restarted with the new interval.

---

### `update_lieutenant_config`

Modify a player lieutenant's personality and/or stats. If the personality changes, all of the lieutenant's troop flowcharts are regenerated using the new personality preset.

```json
{
  "type": "update_lieutenant_config",
  "data": {
    "lieutenantId": "lt_alpha",
    "personality": "cautious",
    "stats": {
      "initiative": 6,
      "discipline": 8,
      "communication": 7
    }
  }
}
```

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `lieutenantId` | `string` | Yes | ID of the lieutenant to modify |
| `personality` | `"aggressive" \| "cautious" \| "disciplined" \| "impulsive"` | No | New personality |
| `stats.initiative` | `number (1-10)` | No | New initiative stat |
| `stats.discipline` | `number (1-10)` | No | New discipline stat |
| `stats.communication` | `number (1-10)` | No | New communication stat |

Stats are clamped to the 1-10 range.

**Responses:** `lieutenants` (updated list), and `flowchart` if personality changed

---

### `update_squad_stats`

Modify troop stats for all troops in a squad.

```json
{
  "type": "update_squad_stats",
  "data": {
    "squadId": "squad_1",
    "stats": {
      "combat": 7,
      "speed": 3,
      "courage": 6,
      "discipline": 5
    }
  }
}
```

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `squadId` | `string` | Yes | Squad identifier (e.g., `"squad_1"`, `"squad_2"`, `"squad_3"`) |
| `stats.combat` | `number (1-10)` | No | Attack/defense effectiveness |
| `stats.speed` | `number (1-10)` | No | Movement rate |
| `stats.courage` | `number (1-10)` | No | Resistance to routing |
| `stats.discipline` | `number (1-10)` | No | Flowchart execution precision |

All stats are clamped to the 1-10 range.

**Response:** `scenario_ready` (with rebuilt troop info)

---

### `update_flowchart_node`

Directly edit flowchart rules for a lieutenant's troops.

```json
{
  "type": "update_flowchart_node",
  "data": {
    "lieutenantId": "lt_alpha",
    "operation": "add",
    "node": {
      "id": "custom_rule_1",
      "on": "enemy_spotted",
      "condition": "distance < 30",
      "action": { "type": "engage", "targetId": "$enemyId" },
      "priority": 10
    }
  }
}
```

**Operations:**

| Operation | Required Fields | Description |
|---|---|---|
| `add` | `node` | Append a new flowchart node to all of the lieutenant's troops |
| `update` | `node` | Replace an existing node (matched by `node.id`) |
| `delete` | `nodeId` | Remove a node by ID from all troops |

**Node structure:**

```json
{
  "id": "string",
  "on": "event_name",
  "condition": "optional condition expression",
  "action": { "type": "action_type", ...params },
  "priority": 0
}
```

**Response:** `flowchart` (updated consolidated flowchart for the lieutenant)

---

## Server to Client Messages

### `connected`

Sent immediately after the WebSocket connection is established.

```json
{
  "type": "connected",
  "data": {
    "models": [
      { "id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4", "default": true },
      { "id": "claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet" },
      { "id": "claude-3-5-haiku-20241022", "name": "Claude 3.5 Haiku (faster)" }
    ],
    "selectedModel": "claude-sonnet-4-20250514",
    "needsApiKey": true,
    "hasServerKey": false,
    "gameMode": "human_vs_ai"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `models` | `Array<{ id, name, default? }>` | Available LLM models |
| `selectedModel` | `string` | Currently selected model ID |
| `needsApiKey` | `boolean` | Whether the client must provide an API key |
| `hasServerKey` | `boolean` | Whether the server has a pre-configured API key |
| `gameMode` | `string` | Current game mode |

---

### `api_key_valid`

API key was accepted.

```json
{
  "type": "api_key_valid",
  "data": {
    "valid": true
  }
}
```

---

### `error`

An error occurred processing a client message.

```json
{
  "type": "error",
  "data": {
    "message": "Invalid API key format"
  }
}
```

Common error messages:
- `"Invalid API key format"` -- key does not start with `sk-`
- `"Invalid API key: ..."` -- API validation call failed
- `"API key not set"` -- no key configured on the session
- `"Scenario not initialized. Call init_scenario first."` -- premature briefing
- `"Lieutenant not found"` -- invalid `lieutenantId`
- `"<name> is still processing your previous message."` -- lieutenant busy
- `"<name> is still processing a previous order."` -- lieutenant busy (mid-battle)
- `"No battle initialized"` -- `start_battle` without prior initialization
- `"Cannot send manual orders in AI vs AI mode"` -- `send_order` in `ai_vs_ai`
- `"Scenario not initialized"` -- stat/flowchart edit before scenario load
- `"Simulation error: ..."` -- simulation tick threw an exception

---

### `model_set`

Model was changed successfully.

```json
{
  "type": "model_set",
  "data": {
    "model": "claude-3-5-haiku-20241022"
  }
}
```

---

### `game_mode_set`

Game mode was changed.

```json
{
  "type": "game_mode_set",
  "data": {
    "mode": "ai_vs_ai"
  }
}
```

---

### `lieutenants`

Full list of player-side lieutenants with their current stats. Sent after scenario initialization and whenever lieutenant state changes (busy flag, stats, personality).

```json
{
  "type": "lieutenants",
  "data": {
    "lieutenants": [
      {
        "id": "lt_alpha",
        "name": "Lt. Adaeze",
        "personality": "aggressive",
        "troopIds": ["p_s1_0", "p_s1_1", "p_s1_2", "p_s1_3", "p_s1_4", "p_s1_5", "p_s1_6", "p_s1_7", "p_s1_8", "p_s1_9"],
        "busy": false,
        "stats": { "initiative": 8, "discipline": 5, "communication": 7 }
      },
      {
        "id": "lt_bravo",
        "name": "Lt. Chen",
        "personality": "cautious",
        "troopIds": ["p_s2_0", "p_s2_1", "..."],
        "busy": false,
        "stats": { "initiative": 5, "discipline": 8, "communication": 6 }
      },
      {
        "id": "lt_charlie",
        "name": "Lt. Morrison",
        "personality": "disciplined",
        "troopIds": ["p_s3_0", "p_s3_1", "..."],
        "busy": false,
        "stats": { "initiative": 6, "discipline": 9, "communication": 5 }
      }
    ]
  }
}
```

---

### `scenario_ready`

Scenario has been loaded and is ready for pre-battle briefing. Contains troop information per lieutenant and the map dimensions.

```json
{
  "type": "scenario_ready",
  "data": {
    "troopInfo": {
      "lt_alpha": [
        {
          "id": "p_s1_0",
          "squadId": "squad_1",
          "position": { "x": 80, "y": 75 },
          "stats": { "combat": 5, "speed": 2, "courage": 5, "discipline": 5 }
        }
      ],
      "lt_bravo": [ "..." ],
      "lt_charlie": [ "..." ]
    },
    "mapSize": { "width": 400, "height": 300 }
  }
}
```

---

### `battle_ready`

Battle initialization is complete (AI commanders created, all lieutenants briefed). The client can now send `start_battle`.

```json
{
  "type": "battle_ready",
  "data": {
    "gameMode": "human_vs_ai"
  }
}
```

---

### `battle_started`

Simulation is now running.

```json
{
  "type": "battle_started",
  "data": {
    "gameMode": "human_vs_ai"
  }
}
```

---

### `battle_paused`

Simulation was paused.

```json
{
  "type": "battle_paused",
  "data": {}
}
```

---

### `battle_resumed`

Simulation was resumed.

```json
{
  "type": "battle_resumed",
  "data": {}
}
```

---

### `battle_end`

Battle is over. Contains the winner and a detailed summary.

```json
{
  "type": "battle_end",
  "data": {
    "winner": "player",
    "summary": {
      "tick": 342,
      "durationSeconds": 34.2,
      "winner": "player",
      "player": { "alive": 18, "dead": 12, "total": 30 },
      "enemy": { "alive": 0, "dead": 30, "total": 30 }
    }
  }
}
```

**Winner values:** `"player"` or `"enemy"`

The win condition is checked every tick: the first team to lose all troops loses. After sending this message, the simulation timer is cleared.

---

### `state`

Full battle state snapshot, sent every 5 simulation ticks. Contains all agent positions, health, morale, and active flowchart nodes.

```json
{
  "type": "state",
  "data": {
    "tick": 150,
    "agents": [
      {
        "id": "p_s1_0",
        "type": "troop",
        "team": "player",
        "position": { "x": 182.5, "y": 73.2 },
        "health": 85,
        "maxHealth": 100,
        "morale": 72,
        "currentAction": "moveTo",
        "formation": "wedge",
        "alive": true,
        "lieutenantId": "lt_alpha"
      },
      {
        "id": "lt_alpha",
        "type": "lieutenant",
        "team": "player",
        "position": { "x": 160.0, "y": 75.0 },
        "health": 100,
        "maxHealth": 100,
        "morale": 100,
        "currentAction": "moveTo",
        "formation": "line",
        "alive": true,
        "lieutenantId": null
      }
    ],
    "width": 400,
    "height": 300,
    "running": true,
    "winner": null,
    "activeNodes": {
      "p_s1_0": "engage_enemy_spotted",
      "p_s1_1": "advance_tick",
      "lt_alpha": null
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `tick` | `number` | Current simulation tick |
| `agents` | `AgentState[]` | All agents (troops and lieutenants, both teams) |
| `width` | `number` | Map width in simulation units |
| `height` | `number` | Map height in simulation units |
| `running` | `boolean` | Whether the simulation is active |
| `winner` | `"player" \| "enemy" \| null` | Winner, if battle has ended |
| `activeNodes` | `Record<string, string \| null>` | Currently active flowchart node ID per agent |

**Agent state fields:**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique agent ID (e.g., `"p_s1_0"`, `"lt_alpha"`) |
| `type` | `"troop" \| "lieutenant"` | Agent type |
| `team` | `"player" \| "enemy"` | Which side the agent belongs to |
| `position` | `{ x: number, y: number }` | Current position in simulation coordinates |
| `health` | `number` | Current health points |
| `maxHealth` | `number` | Maximum health points |
| `morale` | `number` | Current morale (0-100) |
| `currentAction` | `string \| null` | Current action being executed |
| `formation` | `string` | Current formation type |
| `alive` | `boolean` | Whether the agent is alive |
| `lieutenantId` | `string \| null` | ID of commanding lieutenant (null for lieutenants) |

---

### `message`

A chat message in the command channel. Used for orders, reports, alerts, and proactive lieutenant responses.

```json
{
  "type": "message",
  "data": {
    "id": "msg_1709234567890_lt_alpha",
    "from": "lt_alpha",
    "to": "commander",
    "content": "Understood, commander. Forming wedge and advancing on the center.",
    "timestamp": 1709234567890,
    "tick": 0,
    "type": "report"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique message ID |
| `from` | `string` | Sender (`"commander"` for the player, lieutenant ID, or agent ID) |
| `to` | `string` | Recipient (`"commander"`, `"player"`, or lieutenant ID) |
| `content` | `string` | Message text |
| `timestamp` | `number` | Unix timestamp in milliseconds |
| `tick` | `number` | Simulation tick when the message was generated |
| `type` | `string` | Message category (see below) |

**Message types:**

| Type | Direction | Description |
|---|---|---|
| `"order"` | Player to lieutenant | Player's command (echo of `send_order` or `pre_battle_brief`) |
| `"report"` | Lieutenant to player | Lieutenant's acknowledgment or status report (from `message_up`) |
| `"alert"` | Lieutenant to player | Error, warning, or urgent communication |
| `"response"` | Lieutenant to player | Proactive message from lieutenant (from `response_to_player`) |

Troop-originated messages (support requests, reports, alerts) are routed through the lieutenant and prefixed with the troop's agent ID: `"[p_s1_3] Under heavy attack, requesting support!"`

---

### `flowchart`

Updated flowchart rules for a lieutenant. Contains a consolidated view of the rules applied across all of the lieutenant's troops (deduplicated by node ID).

```json
{
  "type": "flowchart",
  "data": {
    "lieutenantId": "lt_alpha",
    "flowcharts": {
      "lt_alpha": {
        "agentId": "lt_alpha",
        "nodes": [
          {
            "id": "engage_enemy_spotted",
            "on": "enemy_spotted",
            "condition": "distance < 50",
            "action": { "type": "engage", "targetId": "$enemyId" },
            "priority": 10
          },
          {
            "id": "advance_tick",
            "on": "tick",
            "action": { "type": "moveTo", "position": { "x": 320, "y": 150 } },
            "priority": 1
          },
          {
            "id": "fallback_under_attack",
            "on": "under_attack",
            "condition": "health < 30",
            "action": { "type": "fallback", "position": { "x": 50, "y": 75 } },
            "priority": 8
          }
        ]
      }
    }
  }
}
```

The `flowcharts` object is keyed by lieutenant ID. Each flowchart contains:

| Field | Type | Description |
|---|---|---|
| `agentId` | `string` | The lieutenant this flowchart belongs to |
| `nodes` | `FlowchartNode[]` | Ordered list of event-action rules |

Each node:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique node identifier |
| `on` | `string` | Event that triggers this rule |
| `condition` | `string` (optional) | Condition expression that must be true |
| `action` | `object` | Action to execute (has a `type` field plus action-specific params) |
| `priority` | `number` (optional) | Higher priority rules are evaluated first |

---

### `battle_event`

A significant battle event for the event ticker display.

```json
{
  "type": "battle_event",
  "data": {
    "type": "kill",
    "tick": 87,
    "team": "enemy",
    "message": "p_s1_3 eliminated e_s2_5",
    "position": { "x": 210, "y": 145 }
  }
}
```

**Event types:**

| Type | Description |
|---|---|
| `kill` | A troop was eliminated |
| `engagement` | Two units entered combat |
| `retreat` | A unit began routing |
| `squad_wiped` | All troops in a squad are dead |
| `casualty_milestone` | A team has lost a percentage of troops (25%, 50%, 75%) |

| Field | Type | Description |
|---|---|---|
| `type` | `string` | Event type (see above) |
| `tick` | `number` | Simulation tick |
| `team` | `"player" \| "enemy"` | Which team is affected |
| `message` | `string` | Human-readable event description |
| `position` | `{ x, y }` (optional) | Where the event occurred |

---

### `speed_set`

Simulation speed was changed.

```json
{
  "type": "speed_set",
  "data": {
    "speed": 2
  }
}
```

---

## Game Flow

The typical sequence of messages for a complete game session:

```
Client                                    Server
  |                                         |
  |  ---- WebSocket connect ------>         |
  |  <---- connected ---------------        |  (1) Connection established
  |                                         |
  |  ---- set_api_key ------------->        |
  |  <---- api_key_valid -----------        |  (2) API key validated (skip if server has key)
  |                                         |
  |  ---- init_scenario ----------->        |
  |  <---- lieutenants -------------        |
  |  <---- flowchart (x3) ---------        |
  |  <---- scenario_ready ----------        |  (3) Scenario loaded
  |                                         |
  |  ---- pre_battle_brief -------->        |
  |  <---- message (order echo) ----        |
  |  <---- flowchart ---------------        |
  |  <---- message (report) --------        |  (4) Pre-battle briefing (optional, repeatable)
  |  ...more briefing rounds...             |
  |                                         |
  |  ---- init_battle ------------->        |
  |  <---- state -------------------        |
  |  <---- lieutenants -------------        |
  |  <---- flowchart (x3) ---------        |
  |  <---- battle_ready ------------        |  (5) Battle initialized
  |                                         |
  |  ---- start_battle ------------>        |
  |  <---- battle_started ----------        |  (6) Battle begins
  |                                         |
  |  <---- state (every 5 ticks) ---        |
  |  <---- message -----------------        |
  |  <---- flowchart ---------------        |
  |  <---- battle_event ------------        |  (7) Battle in progress
  |                                         |
  |  ---- send_order -------------->        |
  |  <---- message (order echo) ----        |
  |  <---- message (report) --------        |
  |  <---- flowchart ---------------        |  (8) Mid-battle orders (human_vs_ai only)
  |                                         |
  |  ---- pause_battle ------------>        |
  |  <---- battle_paused -----------        |  (9) Pause/resume
  |  ---- resume_battle ----------->        |
  |  <---- battle_resumed ----------        |
  |                                         |
  |  <---- battle_end --------------        |  (10) Battle over
```

---

## Scenarios

### basic

Open field battle. Two balanced armies face each other.

- **Map size:** 400 x 300
- **Player:** 3 squads of 10 infantry (30 troops total), 3 lieutenants
- **Enemy:** 3 squads of 10 infantry (30 troops total), 2 lieutenants
- **Terrain:** None (flat open field)
- **Default behavior:** All troops engage on sight and advance

### assault

Attacking a fortified hill position. Player outnumbers but enemy has superior troops and terrain advantage.

- **Map size:** 500 x 300
- **Player:** 3 squads of 12 troops (36 total), combat stat 4 (weaker)
- **Enemy:** 2 squads of 8 troops (16 total), combat stat 7 (vanguard/guardian presets)
- **Terrain:** Hill on the defender's side (`hill_defense` at x=370)
- **Default behavior:** Player troops advance; enemy troops hold position

### river_crossing

Complex multi-terrain scenario. Player must cross a river to assault a hilltop position, with flanking forests available.

- **Map size:** 500 x 350
- **Player:** 2 squads of 12 infantry + 1 squad of 8 scouts (32 total)
- **Enemy:** 2 squads of 8 troops (16 total, guardian/vanguard presets)
- **Terrain:**
  - Central river (vertical band at x=220, full map height)
  - Enemy hilltop (x=350, center of map)
  - Northern forest (x=150, top of map)
  - Southern forest (x=150, bottom of map)
- **Default behavior:** Player troops advance across river; enemy holds the hill

---

## HTTP Endpoints

The server also exposes two REST endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check. Returns `{ "status": "ok", "sessions": <count> }` |
| `GET` | `/api/models` | List available models. Returns `{ "models": [...] }` |

---

## Implementation Notes

### Simulation Tick Rate

The base simulation runs at 10 ticks per second (100ms interval). The `set_speed` command adjusts this:
- 0.5x = 5 ticks/sec (200ms interval)
- 1x = 10 ticks/sec (100ms interval)
- 2x = 20 ticks/sec (50ms interval)

### State Broadcasting

Battle state (`state` messages) is sent every 5 simulation ticks, not every tick. At 1x speed, this means roughly 2 state updates per second.

### LLM Calls Are Non-Blocking

All LLM calls (lieutenant briefings, order processing, reinvocations, AI commander cycles) are asynchronous. The simulation continues running while LLM responses are pending. A lieutenant's `busy` flag prevents concurrent LLM calls to the same lieutenant.

A maximum of 3 concurrent reinvocation LLM calls are allowed at any time to prevent API overload.

### AI Commander Cycle

The enemy AI commander (and player AI commander in `ai_vs_ai` mode) generates orders every 50 ticks (5 seconds at 1x speed). These orders are processed through the same lieutenant LLM pipeline.

### Flowchart Swaps During Battle

During active battle, reinvocation-produced flowcharts are queued via `queueFlowchartSwap()` and applied atomically at the start of the next simulation tick. This prevents mid-tick state inconsistencies. Pre-battle flowcharts (from briefings and `init_battle`) are applied immediately via `applyFlowcharts()`.
