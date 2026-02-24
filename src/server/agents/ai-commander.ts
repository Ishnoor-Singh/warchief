// AI Commander: LLM-powered enemy opponent
// The enemy counterpart to the human player — briefs its own lieutenants
// and issues orders based on battlefield state.

import { z } from 'zod';
import { LLMClient } from './lieutenant.js';
import { SimulationState } from '../sim/simulation.js';
import { Team } from '../../shared/types/index.js';

export interface AICommanderConfig {
  personality: 'aggressive' | 'cautious' | 'balanced';
  lieutenantIds: string[];
  model: string;
}

export interface CommanderOrder {
  lieutenantId: string;
  order: string;
}

export interface AICommander {
  personality: 'aggressive' | 'cautious' | 'balanced';
  lieutenantIds: string[];
  model: string;
  orderHistory: CommanderOrder[];
  busy: boolean;
  lastOrderTick: number;
}

export interface CommanderResult {
  success: boolean;
  orders?: CommanderOrder[];
  error?: string;
}

// Zod schema for commander LLM output
const CommanderOutputSchema = z.object({
  orders: z.array(z.object({
    lieutenantId: z.string(),
    order: z.string(),
  })),
  reasoning: z.string().optional(),
});

type CommanderOutput = z.infer<typeof CommanderOutputSchema>;

const PERSONALITY_STYLES: Record<AICommander['personality'], string> = {
  aggressive: 'You favor overwhelming force and fast, decisive attacks. Push hard, accept casualties for positional advantage. Flank aggressively.',
  cautious: 'You favor defensive positioning and counter-attacks. Wait for the enemy to overextend, then punish. Preserve your forces.',
  balanced: 'You adapt to the situation. Press advantages when you have them, fall back when outmatched. Use combined arms.',
};

export function createAICommander(config: AICommanderConfig): AICommander {
  return {
    personality: config.personality,
    lieutenantIds: [...config.lieutenantIds],
    model: config.model,
    orderHistory: [],
    busy: false,
    lastOrderTick: 0,
  };
}

export function buildCommanderContext(commander: AICommander, sim: SimulationState): string {
  const { battle } = sim;

  // Count troops per team
  let enemyAlive = 0;
  let enemyTotal = 0;
  let playerAlive = 0;
  let playerTotal = 0;
  const enemyPositions: Array<{ id: string; x: number; y: number; health: number }> = [];
  const playerVisible: Array<{ id: string; x: number; y: number; health: number }> = [];

  for (const agent of battle.agents.values()) {
    if (agent.type !== 'troop') continue;

    if (agent.team === 'enemy') {
      enemyTotal++;
      if (agent.alive) {
        enemyAlive++;
        enemyPositions.push({ id: agent.id, x: Math.round(agent.position.x), y: Math.round(agent.position.y), health: agent.health });
      }
    } else {
      playerTotal++;
      if (agent.alive) {
        playerAlive++;
        // Only include player troops visible to enemy (within any enemy agent's visibility)
        for (const enemyAgent of battle.agents.values()) {
          if (enemyAgent.team !== 'enemy' || !enemyAgent.alive) continue;
          const dx = agent.position.x - enemyAgent.position.x;
          const dy = agent.position.y - enemyAgent.position.y;
          if (Math.sqrt(dx * dx + dy * dy) <= enemyAgent.visibilityRadius) {
            playerVisible.push({ id: agent.id, x: Math.round(agent.position.x), y: Math.round(agent.position.y), health: agent.health });
            break;
          }
        }
      }
    }
  }

  const sections: string[] = [];

  sections.push(`# You are the Enemy Commander
You command the enemy army. Your goal is to defeat the player's forces.
Personality: ${commander.personality}
${PERSONALITY_STYLES[commander.personality]}

Battlefield: ${battle.width}x${battle.height}
Current tick: ${battle.tick}`);

  sections.push(`# Your Forces
Total troops: ${enemyTotal} (${enemyAlive} alive, ${enemyTotal - enemyAlive} dead)
Positions: ${enemyPositions.slice(0, 10).map(p => `${p.id} at (${p.x},${p.y}) hp:${p.health}`).join('; ')}`);

  sections.push(`# Visible Enemy (Player) Forces
Total visible: ${playerVisible.length} of ${playerAlive} alive
Positions: ${playerVisible.slice(0, 10).map(p => `${p.id} at (${p.x},${p.y}) hp:${p.health}`).join('; ')}`);

  sections.push(`# Your Lieutenants
${commander.lieutenantIds.map(id => `- ${id}`).join('\n')}

Issue orders to your lieutenants. Each order should be a natural language instruction for how their troops should behave.`);

  if (commander.orderHistory.length > 0) {
    const recent = commander.orderHistory.slice(-4);
    sections.push(`# Recent Orders
${recent.map(o => `To ${o.lieutenantId}: ${o.order}`).join('\n')}`);
  }

  sections.push(`# Output Format
Respond with ONLY valid JSON:
{
  "orders": [
    { "lieutenantId": "<lt_id>", "order": "<natural language order>" }
  ],
  "reasoning": "<brief tactical reasoning>"
}`);

  return sections.join('\n\n');
}

export async function generateCommanderOrders(
  commander: AICommander,
  sim: SimulationState,
  client: LLMClient
): Promise<CommanderResult> {
  commander.busy = true;

  try {
    const systemPrompt = buildCommanderContext(commander, sim);
    const userMessage = `Tick ${sim.battle.tick}. Assess the battlefield and issue orders to your lieutenants. Be decisive.`;

    const response = await client.messages.create({
      model: commander.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || !('text' in textContent)) {
      commander.busy = false;
      return { success: false, error: 'No text response from LLM' };
    }

    let parsed: CommanderOutput;
    try {
      const raw = JSON.parse(textContent.text!);
      const result = CommanderOutputSchema.safeParse(raw);
      if (!result.success) {
        commander.busy = false;
        return { success: false, error: 'Invalid commander output schema' };
      }
      parsed = result.data;
    } catch {
      commander.busy = false;
      return { success: false, error: 'Invalid JSON from commander LLM' };
    }

    // Store in history
    for (const order of parsed.orders) {
      commander.orderHistory.push(order);
    }

    // Keep history bounded
    if (commander.orderHistory.length > 20) {
      commander.orderHistory = commander.orderHistory.slice(-20);
    }

    commander.lastOrderTick = sim.battle.tick;
    commander.busy = false;

    return { success: true, orders: parsed.orders };
  } catch (error) {
    commander.busy = false;
    return { success: false, error: (error as Error).message };
  }
}
