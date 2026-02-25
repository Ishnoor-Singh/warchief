# Warchief

> *You are the only human on the battlefield. Everyone else is an agent.*

## Quick Start

```bash
# Clone and install
git clone https://github.com/Ishnoor-Singh/warchief.git
cd warchief
npm install
cd client && npm install && cd ..

# Start Convex backend (creates a free account if needed)
npx convex dev

# In a separate terminal: start the frontend
cd client
npm run dev
# → Open http://localhost:5173
```

**You'll need your own Anthropic API key.** Enter it in the browser when prompted.

### Deploy to Vercel + Convex

```bash
# Deploy Convex backend
npx convex deploy

# Deploy frontend to Vercel
# Set VITE_CONVEX_URL env var to your Convex deployment URL
vercel
```

### Development

```bash
# Terminal 1: Convex backend (watches for changes, syncs schema & functions)
npm run dev

# Terminal 2: Frontend (Vite hot reload)
npm run dev:frontend
```

---

## Architecture

```
Player (browser) → Convex (mutations/queries/actions) → Anthropic API
                 ← Convex reactive queries (real-time state updates)
```

### Stack

- **Frontend:** React + Phaser.js on Vercel
- **Backend:** Convex (reactive database, serverless functions, scheduled tasks)
- **LLM:** Claude API via Convex actions
- **No WebSockets, no Express, no long-running servers**

Convex handles:
- **Reactive queries** — client state auto-updates when data changes (replaces WebSocket broadcasts)
- **Mutations** — transactional game state updates (replaces REST API)
- **Actions** — external API calls to Anthropic for lieutenant LLM inference
- **Scheduled functions** — drive the 10 tick/sec simulation loop (replaces `setInterval`)

---

## What Is This?

Warchief is a real-time battle strategy game where your only interface is natural language. No clicking units, no build menus, no drag-to-select. You are a battle commander. You communicate — via orders, speeches, and direct messages — to a hierarchy of AI lieutenants, who in turn program and command their troops.

The army lives and dies by how well you communicate, how well you've structured your command chain, and how well your lieutenants interpret your intent.

## The Core Idea

Most strategy games give you omniscient control. You see everything, click everything, manage everything. Warchief inverts this. You have:

- **Limited visibility** — you see only what your lieutenants report to you
- **Imperfect communication** — orders are interpreted, not executed literally
- **A chain of command that actually matters** — the structure you build before battle determines how cleanly your intent propagates

The fog of war is *linguistic*. A poorly worded order, a distracted lieutenant, a gap in a troop's flowchart — these are the failure modes. Victory comes from clarity of thought, good org design, and adaptive communication under pressure.

## The Game Architecture

```
YOU (human, natural language only)
        ↓  messages, orders, speeches
LIEUTENANTS (LLM agents — reason, plan, write troop logic)
        ↓  structured flowchart directives
TROOPS (flowchart agents — fast, deterministic, programmable)
        ↓
SIMULATION (stats, physics, combat resolution)
```

### Lieutenants

Lieutenants are LLM instances. They receive your orders and translate them into action. Their primary output is **structured flowchart directives** — a domain-specific language that compiles into the event system powering their troops.

### Troops

Troops are flowchart agents. They are fast, deterministic, and dumb. They execute exactly the logic their lieutenant compiled for them.

### The Event System

The shared vocabulary between lieutenants and troops:

```
Events: enemy_spotted, under_attack, flanked, ally_down, casualty_threshold
Actions: moveTo, engage, fallback, hold, setFormation, requestSupport
```
