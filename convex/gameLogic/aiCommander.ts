// AI Commander data types and prompt building (no LLM client - that's in convex actions)

import { z } from 'zod';
import { SimulationState, distance } from './simulation';
import { Team } from './types';

export interface AICommanderConfig {
  personality: 'aggressive' | 'cautious' | 'balanced';
  lieutenantIds: string[];
  model: string;
  team?: Team;
  name?: string;
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
  team: Team;
  name: string;
}

export interface CommanderResult {
  success: boolean;
  orders?: CommanderOrder[];
  error?: string;
}

export const CommanderOutputSchema = z.object({
  orders: z.array(z.object({
    lieutenantId: z.string(),
    order: z.string(),
  })),
  reasoning: z.string().optional(),
});

export type CommanderOutput = z.infer<typeof CommanderOutputSchema>;

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
    team: config.team || 'enemy',
    name: config.name || 'Enemy Commander',
  };
}

export function buildCommanderContext(commander: AICommander, sim: SimulationState): string {
  const { battle } = sim;
  const myTeam = commander.team;
  const opponentTeam: Team = myTeam === 'player' ? 'enemy' : 'player';

  let myAlive = 0;
  let myTotal = 0;
  let opponentAlive = 0;
  const myPositions: Array<{ id: string; x: number; y: number; health: number }> = [];
  const opponentVisible: Array<{ id: string; x: number; y: number; health: number }> = [];

  for (const agent of Object.values(battle.agents)) {
    if (agent.type !== 'troop') continue;

    if (agent.team === myTeam) {
      myTotal++;
      if (agent.alive) {
        myAlive++;
        myPositions.push({ id: agent.id, x: Math.round(agent.position.x), y: Math.round(agent.position.y), health: agent.health });
      }
    } else {
      if (agent.alive) {
        opponentAlive++;
        for (const myAgent of Object.values(battle.agents)) {
          if (myAgent.team !== myTeam || !myAgent.alive) continue;
          const dist = distance(myAgent.position, agent.position);
          if (dist <= myAgent.visibilityRadius) {
            opponentVisible.push({ id: agent.id, x: Math.round(agent.position.x), y: Math.round(agent.position.y), health: agent.health });
            break;
          }
        }
      }
    }
  }

  const sections: string[] = [];

  sections.push(`# You are ${commander.name}
You command the ${myTeam} army. Your goal is to defeat the ${opponentTeam}'s forces.
Personality: ${commander.personality}
${PERSONALITY_STYLES[commander.personality]}

Battlefield: ${battle.width}x${battle.height}
Current tick: ${battle.tick}`);

  sections.push(`# Your Forces
Total troops: ${myTotal} (${myAlive} alive, ${myTotal - myAlive} dead)
Positions: ${myPositions.slice(0, 10).map(p => `${p.id} at (${p.x},${p.y}) hp:${p.health}`).join('; ')}`);

  sections.push(`# Visible Enemy Forces
Total visible: ${opponentVisible.length} of ${opponentAlive} alive
Positions: ${opponentVisible.slice(0, 10).map(p => `${p.id} at (${p.x},${p.y}) hp:${p.health}`).join('; ')}`);

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
