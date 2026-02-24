# MVP Plan

The goal of the MVP is a single playable battle that demonstrates the core loop:
**Talk to lieutenants → they program troops → troops fight → you win or lose based on how well you communicated.**

No polish. No menus. Proof of concept that the core mechanic is fun.

---

## MVP Scope

- 1 player vs 1 LLM-controlled enemy commander
- 1 fixed map (simple terrain, a ridge, some open ground)
- Player has 3 lieutenants, ~30 troops each (~90 total)
- Enemy has 2 LLM lieutenants with equivalent troops, commanded by an AI commander
- Pre-battle phase: ~3 minutes to brief and configure (enemy also briefs in parallel)
- Battle phase: real-time, ~5-10 minutes
- Win condition: enemy army reduced below 20% strength

---

## Phases

### Phase 1 — Simulation Core ✅
*Get a battle running without any LLM or UI.*

- [x] 2D grid or continuous coordinate sim (continuous)
- [x] Agent state: position, health, morale, current action
- [x] Basic combat resolution (distance-based, stat-weighted)
- [x] Flowchart runtime: event system, node execution, action handlers
- [x] Visibility per agent (radius-based)
- [x] Sim loop at 10 ticks/sec
- [x] Hardcode a simple scenario: two armies, troops with basic `engage on sight` flowcharts
- [x] Verify battle resolves correctly

**Exit criteria:** A battle runs to completion in the terminal with no UI. ✅

**Run:** `npm run battle` or `npm run assault`

---

### Phase 2 — Lieutenant LLM Layer ✅
*Wire in Claude as lieutenant brains.*

- [x] Lieutenant system prompt template
- [x] Input builder: assembles system prompt from current state
- [x] Output parser + validator: parses `LieutenantOutput` JSON, validates schema (Zod)
- [x] Flowchart compiler: converts validated JSON into running runtime nodes
- [x] Async LLM call queue: non-blocking, integrates with sim loop
- [x] Basic message routing: player text → lieutenant LLM → compiled flowchart
- [x] Retry logic for malformed output (pass error back to LLM, try once more)
- [x] Test: 56 tests passing (TDD: red → green)

**Exit criteria:** Player can type a message, lieutenant interprets it, troops change behavior. ✅

**Run demo:** `ANTHROPIC_API_KEY=sk-... npm run demo`

---

### Phase 3 — Minimal Frontend ✅
*Make it playable.*

- [x] Top-down battlefield canvas (plain Canvas 2D)
  - Render units as circles (player = blue, enemy = red, lieutenants = larger)
  - Render visibility fog (radial gradient cutouts on dark overlay)
  - Show formation shape indicators (wedge, circle, scatter, column, pincer)
- [x] Message panel
  - Input box to send orders to selected lieutenant
  - Message history with timestamps, tick numbers, sender names
  - Alert badges for urgent messages, intel reports for enemy activity
- [x] Flowchart panel (read-only)
  - Select a lieutenant → see their active flowchart
  - Current active node highlights with green border and "ACTIVE" badge
  - Shows priority, conditions, and action parameters
- [x] Pre-battle screen
  - Text area to brief each lieutenant
  - Lieutenant stats displayed (initiative, discipline, communication bars)
  - Enemy LLM commander briefing shown as intel alert

**Exit criteria:** A human can play a full battle from briefing to win/loss. ✅

---

### Phase 4 — MVP Playability Pass ✅
*Make it not confusing.*

- [x] Lieutenant names, personality, and stats displayed with visual stat bars
- [x] Report feed is readable (timestamps, sender names, tick numbers, alert badges)
- [x] Flowchart fallback behavior visible (default hold action compiled for all flowcharts)
- [x] Win/loss screen with detailed summary (per-team casualties, duration, key moments)
- [x] LLM opponent commander (AI commander + 2 enemy lieutenants replace scripted behavior)

**Exit criteria:** Someone who hasn't seen the game can play it with minimal explanation. ✅

---

### Phase 5 — LLM Opponent ✅
*Play against an intelligent enemy.*

- [x] AI Commander module (`src/server/agents/ai-commander.ts`)
  - Balanced personality, generates strategic orders for enemy lieutenants
  - Receives battlefield state from enemy perspective (fog of war applies to enemy too)
  - Issues orders every 50 ticks during battle
- [x] Enemy lieutenants (Lt. Volkov - aggressive, Lt. Kira - cautious)
  - Same LLM pipeline as player lieutenants
  - Compile flowcharts for enemy troops
- [x] Pre-battle briefing for enemy army (runs in parallel with player briefing)
- [x] Visibility-filtered state (`getFilteredStateForTeam`) — fog of war is real, not cosmetic
- [x] 78 tests passing (TDD: red → green → refactor)

**Exit criteria:** Player faces an LLM opponent that adapts its strategy during battle. ✅

---

## Technical Decisions for MVP

| Decision | Choice | Why |
|---|---|---|
| Frontend framework | React + Vite | Fast setup, good ecosystem |
| Canvas library | Phaser 3 | Battle rendering, built-in game loop |
| Backend | Node.js + Express | Fast to prototype, same language as frontend types |
| Real-time | WebSocket (ws) | Sim state streaming to client |
| LLM | Claude claude-sonnet-4-6 via API | Best instruction following for structured output |
| Flowchart state | In-memory (server) | No DB needed for MVP |

---

## What Good Looks Like for MVP

You sit down, you have 3 minutes. You type to Lt. Adaeze on the left flank: *"Hold the ridge until I say advance. If they push hard, fall back to the treeline and wait."* She responds: *"Understood. Squads 1 and 2 will hold the ridge. On heavy contact, we retreat to treeline and await orders."* 

The battle starts. Her squads hold. The enemy pushes. You watch her flowchart: `under_attack` → `loss_check` → `fallback`. Her troops pull back in formation. You feel like a commander.

That's the MVP.

---

## Not In MVP

- Player-editable flowcharts (lieutenants write them, player reads them)
- ~~Enemy LLM commander~~ (DONE - Phase 5)
- Morale speeches affecting stats
- Multiple maps
- Saving / replaying battles
- More than 3 lieutenants
- Peer-to-peer lieutenant LLM communication (can be mocked with scripted responses)
- Courage/morale probability checks (stats exist, not wired to behavior yet)
