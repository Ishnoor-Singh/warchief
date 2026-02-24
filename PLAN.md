# Development Plan

Status of each component and what remains to be done.

---

## Current State (as of Feb 2026)

| Component | Status | Notes |
|-----------|--------|-------|
| Simulation engine | Done | 10 ticks/sec, combat resolution, visibility |
| Flowchart runtime | Done | Event routing, condition eval, action dispatch |
| Lieutenant LLM layer | Done | System prompts, Zod validation, compiler, 78 tests |
| WebSocket server | Done | Session management, message routing, visibility-filtered state |
| Setup / pre-battle UI | Done | API key input, model selection, lieutenant briefing with stats |
| Battlefield canvas | Done | Fog-of-war rendering, formation indicators, health bars |
| Message panel | Done | Timestamps, sender tags, alert badges, order input |
| Flowchart panel | Done | Active node highlighting, priority display |
| Win/loss screen | Done | Detailed stats (casualties per team, duration), key moments |
| LLM opponent commander | Done | AI commander briefs enemy lieutenants, issues orders during battle |
| Enemy LLM lieutenants | Done | Lt. Volkov (aggressive) + Lt. Kira (cautious) interpret commander orders |

**To play:** `npm run dev` (server) + `cd client && npx vite` (client) -> open localhost:5173 -> enter API key -> brief lieutenants -> start battle.

---

## Architecture: LLM Opponent Flow

```
AI Commander LLM
  |-- generates orders every 50 ticks
  |-- briefs enemy lieutenants pre-battle
  |
  +-- Lt. Volkov (aggressive, e_s1/e_s2 troops)
  |     +-- interprets orders -> compiles flowcharts -> troops execute
  |
  +-- Lt. Kira (cautious, e_s3 troops)
        +-- interprets orders -> compiles flowcharts -> troops execute
```

The AI commander and enemy lieutenants use the same LLM pipeline as player lieutenants.
The commander receives a battlefield summary (from enemy perspective) and generates
strategic orders for its lieutenants.

---

## What Was Implemented

### Phase 3 Completion
- **Fog of War**: Server sends visibility zones per team. Canvas renders dark overlay with radial gradient cutouts. Enemy units outside visibility radius are not sent to client.
- **Formation Shapes**: Subtle geometric indicators per formation type (wedge=triangle, defensive_circle=circle, scatter=dots, column=line, pincer=arcs).
- **Live Flowchart Highlighting**: Server sends `activeNodes` map per agent. FlowchartPanel highlights active nodes with green border and "ACTIVE" badge.
- **Report Feed**: Messages show timestamps, tick numbers, sender names. Alert messages get a red "ALERT" badge. Intel messages shown for enemy activity.

### Phase 4 Completion
- **End Screen**: Full post-battle screen with per-team casualty stats, survival bars, duration, and key moments from the message log.
- **LLM Opponent**: AI commander (balanced personality) + 2 enemy lieutenants. Commander runs every 50 ticks during battle. Pre-battle briefing happens in parallel with player briefing.
- **Lieutenant Stats Display**: Pre-battle screen shows initiative/discipline/communication stat bars per lieutenant.
- **Visibility Filtering**: `getFilteredStateForTeam()` only sends enemy agents within friendly visibility radius. Fog of war is real, not cosmetic.
- **Detailed Battle Summary**: `getDetailedBattleSummary()` provides per-team alive/dead/total counts, duration, winner.

---

## Remaining Work (Post-MVP Polish)

### Courage / Morale Checks
Stats exist but probability-based behavior variance (e.g., courage: 3 unit breaking from `hold()`) is not wired.

- In the simulation tick, when a unit is under sustained attack and has low courage, roll a check
- On fail: override current action with `fallback`, emit `morale_break` event

**Where to work:** `src/server/sim/simulation.ts`

### Peer-to-Peer Lieutenant Communication
Framework exists in the schema (`message_peers`), not wired in routing. When wired, lets lieutenants coordinate laterally.

### Multiple Maps
The scenario file uses fixed coordinates. A second map requires new scenario geometry and different terrain descriptions in system prompts.

### Battle Replay
Log the full state delta stream server-side. Replay is just playing back the log.

### Player-Editable Flowcharts
The Monaco editor is a dependency. Let advanced players tweak lieutenant-generated flowcharts directly.

### Morale Speeches
Let the player broadcast to all troops, affecting morale stat.

---

## Test Coverage

78 tests across 7 test files:
- `schema.test.ts` - Lieutenant output validation (14 tests)
- `compiler.test.ts` - Flowchart compilation (15 tests)
- `lieutenant.test.ts` - LLM client + order processing (11 tests)
- `input-builder.test.ts` - System prompt construction (11 tests)
- `integration.test.ts` - Phase 2 end-to-end workflow (5 tests)
- `ai-commander.test.ts` - AI commander LLM opponent (11 tests)
- `simulation.test.ts` - Visibility filtering, battle summary, currentNode tracking (11 tests)

Run: `npm test`
