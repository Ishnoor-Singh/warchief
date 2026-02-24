# MVP Plan

The goal of the MVP is a single playable battle that demonstrates the core loop:
**Talk to lieutenants → they program troops → troops fight → you win or lose based on how well you communicated.**

No polish. No menus. Proof of concept that the core mechanic is fun.

---

## MVP Scope

- 1 player vs 1 AI-controlled enemy army
- 1 fixed map (simple terrain, a ridge, some open ground)
- Player has 3 lieutenants, ~30 troops each (~90 total)
- Enemy has equivalent size, run by scripted AI (no LLM needed for enemy MVP)
- Pre-battle phase: ~3 minutes to brief and configure
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

### Phase 3 — Minimal Frontend
*Make it playable.*

- [ ] Top-down battlefield canvas (Phaser or plain Canvas)
  - Render units as simple shapes (player = blue, enemy = red, lieutenants = larger)
  - Render visibility fog
  - Show formation shapes
- [ ] Message panel
  - Input box: "send to [lieutenant dropdown] / all"
  - Message history feed
  - Incoming reports from lieutenants
- [ ] Flowchart panel (read-only for MVP)
  - Select a lieutenant → see their active flowchart
  - Current active node highlights live
- [ ] Pre-battle screen
  - Simple text area to brief each lieutenant
  - Toggle peer-to-peer communication links
  - "Begin Battle" button

**Exit criteria:** A human can sit down and play a full battle from pre-battle briefing to win/loss.

---

### Phase 4 — MVP Playability Pass
*Make it not confusing.*

- [ ] Lieutenant names and personality displayed
- [ ] Report feed is readable (timestamps, sender, importance)
- [ ] Flowchart fallback behavior is clear (what happens when a node has no match)
- [ ] Win/loss screen with simple summary (who held, who broke, key moments)
- [ ] At least 2 enemy AI behaviors (aggressive rusher, defensive holder) to test against

**Exit criteria:** Someone who hasn't seen the game can play it with minimal explanation.

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
- Enemy LLM commander
- Morale speeches affecting stats
- Multiple maps
- Saving / replaying battles
- More than 3 lieutenants
- Peer-to-peer lieutenant LLM communication (can be mocked with scripted responses)
