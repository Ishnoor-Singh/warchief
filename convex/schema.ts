import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  games: defineTable({
    // Game settings
    phase: v.string(), // 'setup' | 'pre-battle' | 'battle' | 'post-battle'
    mode: v.string(), // 'human_vs_ai' | 'ai_vs_ai'
    apiKey: v.optional(v.string()),
    model: v.string(),
    speed: v.number(),

    // Map dimensions
    mapWidth: v.number(),
    mapHeight: v.number(),

    // Battle state: serialized as JSON blob (all agents, tick, winner, etc.)
    // We store the full simulation state in a single document for efficient tick processing.
    // This avoids reading/writing 60+ agent documents per tick.
    battleState: v.optional(v.any()),
    // Flowchart runtimes: Record<agentId, FlowchartRuntime>
    runtimes: v.optional(v.any()),
    // Squad casualty tracking: Record<teamSquadKey, { total, dead }>
    squadCasualties: v.optional(v.any()),
    // Active engagement tracking
    activeEngagements: v.optional(v.array(v.string())),

    // Lieutenant data (player + enemy)
    lieutenants: v.optional(v.any()),
    enemyLieutenants: v.optional(v.any()),
    aiCommander: v.optional(v.any()),
    playerAICommander: v.optional(v.any()),

    // Personality settings
    playerPersonality: v.optional(v.string()),
    enemyPersonality: v.optional(v.string()),

    // Tick scheduling
    tickScheduleId: v.optional(v.id("_scheduled_functions")),
  }),

  messages: defineTable({
    gameId: v.id("games"),
    messageId: v.string(),
    from: v.string(),
    to: v.string(),
    content: v.string(),
    timestamp: v.number(),
    tick: v.number(),
    messageType: v.string(), // 'order' | 'report' | 'alert'
  }).index("by_game", ["gameId"]),

  battleEvents: defineTable({
    gameId: v.id("games"),
    eventType: v.string(),
    tick: v.number(),
    team: v.string(),
    message: v.string(),
    position: v.optional(v.object({ x: v.number(), y: v.number() })),
  }).index("by_game", ["gameId"]),
});
