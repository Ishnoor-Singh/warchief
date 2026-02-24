# Post-Testing Plan

This document is a prioritized list of changes to make after doing a first playthrough.
It reflects the current state of the codebase (Phases 1 and 2 complete, Phase 3 partially built)
and is organized by priority — fix blockers first, then polish, then post-MVP.

---

## Current State (as of Feb 2026)

| Component | Status | Notes |
|-----------|--------|-------|
| Simulation engine | ✅ Done | 10 ticks/sec, combat resolution, visibility |
| Flowchart runtime | ✅ Done | Event routing, condition eval, action dispatch |
| Lieutenant LLM layer | ✅ Done | System prompts, Zod validation, compiler, 56 tests |
| WebSocket server | ✅ Done | Session management, message routing |
| Setup / pre-battle UI | ✅ Done | API key input, model selection, lieutenant briefing |
| Battlefield canvas | ⚠️ Partial | Units render as circles, health bars work; fog-of-war and formations missing |
| Message panel | ⚠️ Partial | Order input works; report feed needs readability work |
| Flowchart panel | ⚠️ Partial | Read-only display exists; live node highlighting missing |
| Win/loss screen | ❌ Missing | Battle end detected server-side, no UI for it |
| Enemy AI behaviors | ❌ Missing | Only one scripted behavior (engage-on-sight) |

**To run a battle end-to-end:** `npm run dev` (server) + `npm run dev:client` (client) → open localhost:5173 → enter API key → brief lieutenants → start battle.

---

## Phase 3 Completion — Make It Playable

These are the remaining items needed before the game is actually playable by a human.

### 3a. Fog of War Visualization
The server already computes visibility per agent. The client needs to render it.

- Each lieutenant has a `visibilityRadius` in `AgentState`
- The server sends aggregate visibility zones in the state delta
- On the canvas, render a dark overlay and "cut out" circles around visible units
- Enemy units outside all visibility radii should not render

**Where to work:** `client/src/components/BattlefieldCanvas.tsx`

### 3b. Formation Shapes
Troops move into formations but the canvas only renders them as a blob of dots.

- When a unit's current action is `setFormation`, render them in the correct geometric shape
- Formation types: `line | wedge | scatter | pincer | defensive_circle | column`
- Doesn't have to be pixel-perfect — just visually distinct so you can tell formation at a glance
- Consider color-coding squads within a lieutenant's command

**Where to work:** `client/src/components/BattlefieldCanvas.tsx`

### 3c. Live Flowchart Node Highlighting
The flowchart panel shows the compiled flowchart but doesn't show which node is currently active.

- Server already tracks `currentNode` per agent in `AgentState`
- Wire this through the state delta to the client
- In `FlowchartPanel.tsx`, highlight the active node and animate transitions
- The MVP description says: "the current node glows, branches light up as decisions are made"

**Where to work:** `client/src/components/FlowchartPanel.tsx`, `src/server/sim/simulation.ts` (verify currentNode is emitted)

### 3d. Report Feed Readability
Reports from lieutenants currently show as raw text strings. They need context.

- Add timestamps (sim tick or wall-clock time)
- Tag the source (which lieutenant, which squad)
- Visually distinguish report types: `report` (routine) vs `alert` (urgent) vs `order_received` (confirmation)
- Consider a simple color code: white = report, yellow = alert, green = order confirmed

**Where to work:** `client/src/components/MessagePanel.tsx`

---

## Phase 4 — Playability Pass

### 4a. Win/Loss Screen
Battle end is detected on the server (when one side drops below 20% strength) but there's no UI.

- Add a `GamePhase.ENDED` state to the client
- Show a simple screen: who won, key stats (casualties, time, which lieutenants held/broke)
- "Play Again" button resets the session

**Where to work:** `client/src/App.tsx`, `src/server/index.ts` (verify `battle_ended` message is emitted)

### 4b. Second Enemy AI Behavior
Currently the enemy only has `engage-on-sight` logic. Add one more behavior to test against.

- **Defensive holder:** forms a defensive line, only engages if attacked, falls back to a fixed position under pressure
- Toggle between behaviors in the scenario setup (or pick randomly)
- This tests whether your flanking / pressure strategies actually work differently vs different enemy types

**Where to work:** `src/server/sim/scenario.ts`

### 4c. Lieutenant Personality Feedback
Lieutenants have `personality` traits (aggressive, cautious, disciplined, impulsive) and stats, but you can't see them influencing behavior.

- In the pre-battle screen, show each lieutenant's personality and stats clearly
- When a lieutenant acts on their personality (e.g., an aggressive one charges early), have them include a note in their `message_up` — prompt this behavior in the system prompt
- This makes the personality feel real rather than cosmetic

**Where to work:** `client/src/components/PreBattleScreen.tsx`, `src/server/agents/input-builder.ts`

### 4d. Courage / Morale Checks
Stats exist but the probability-based behavior variance (e.g., a courage: 3 unit breaking from `hold()`) is not wired.

- In the simulation tick, when a unit is under sustained attack and has low courage, roll a check
- On fail: override current action with `fallback` to a safe position, emit `morale_break` event
- This makes low-quality troops feel unreliable in a legible way

**Where to work:** `src/server/sim/simulation.ts`

---

## Known Issues to Investigate During Testing

These are things that *might* be broken or confusing — confirm during your first playthrough.

1. **LLM latency vs sim speed:** The sim runs at 10 ticks/sec. LLM calls are async and non-blocking, but if a lieutenant gets a lot of messages, calls could queue up. Watch for stale flowchart behavior.

2. **Malformed lieutenant output:** The retry logic exists (one retry with error context) but if both attempts fail, the lieutenant silently keeps their last flowchart. You might want a visible indicator in the message panel when this happens.

3. **WebSocket reconnect:** If the connection drops mid-battle, the client doesn't currently reconnect gracefully. The server session may still be running. Check what happens on refresh.

4. **Flowchart for troops with no current directive:** If a troop agent has no flowchart nodes yet (e.g., before the lieutenant's first LLM response arrives), they sit idle. Verify there's a sensible default (hold position, don't wander).

5. **Enemy visibility to the player:** The server may be sending full enemy position data to the client even for units outside visibility radii. Confirm the server-side filtering in `simulation.ts` before the fog-of-war visual is in place — otherwise the canvas fog will be cosmetic only.

---

## Post-MVP (After the Game Is Playable)

Don't touch these until the MVP loop is confirmed fun.

- **Peer-to-peer lieutenant communication** — framework exists in the schema (`message_peers`), not wired in routing. When wired, lets lieutenants coordinate laterally without you as bottleneck.
- **Multiple maps** — the scenario file uses fixed coordinates. A second map requires new scenario geometry and different terrain descriptions in the system prompt.
- **Battle replay** — log the full state delta stream server-side. Replay is just playing back the log. Useful for post-battle analysis.
- **Enemy LLM commander** — replace scripted enemy AI with a Claude instance receiving a simplified battlefield state. Makes the game asymmetric and unpredictable.
- **Morale speeches** — let the player broadcast to all troops, affecting morale stat. An army-wide speech before a charge should matter.
- **Player-editable flowcharts** — the Monaco editor is already a dependency. Let advanced players tweak lieutenant-generated flowcharts directly.

---

## Testing Checklist

Run through this on your first session to know what's working and what isn't.

### Setup
- [ ] `npm install` and `cd client && npm install` work without errors
- [ ] `npm run build` compiles cleanly
- [ ] `npm run dev` + `npm run dev:client` start without errors
- [ ] Setup screen accepts API key and model selection
- [ ] Pre-battle screen shows 3 lieutenants with names and roles

### Pre-Battle
- [ ] Can type a briefing to each lieutenant
- [ ] "Begin Battle" starts the battle phase
- [ ] Lieutenants respond to briefings (first LLM call triggers)

### Battle
- [ ] Units appear on the battlefield canvas
- [ ] Units move and engage each other
- [ ] Sending an order to a lieutenant triggers a response
- [ ] Lieutenant reports appear in the message panel
- [ ] Flowchart panel updates when a lieutenant responds

### Terminal verification (no UI needed)
- [ ] `npm run battle` runs to completion, prints winner
- [ ] `npm run assault` runs to completion, prints winner
- [ ] `npm test` — all 56 tests pass

### Known pass criteria
- Phases 1 and 2 should work completely
- Phase 3 is the likely failure zone — canvas rendering and live state sync
