// Input builder: constructs system prompt for lieutenant LLM from current state

import { Vec2, LieutenantStats } from '../../shared/types/index.js';

export interface LieutenantIdentity {
  id: string;
  name: string;
  personality: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
  stats: LieutenantStats;
}

export interface VisibleUnitInfo {
  id: string;
  position: Vec2;
  health: number;
  morale: number;
}

export interface VisibleEnemyInfo {
  id: string;
  position: Vec2;
  distance: number;
}

export interface RecentMessage {
  from: string;
  content: string;
  timestamp: number;
}

/** Summary of a peer lieutenant's current situation. */
export interface PeerStateInfo {
  id: string;
  name: string;
  troopsAlive: number;
  troopsTotal: number;
  averageMorale: number;
  currentAction: string;
  position: Vec2;
}

/** Summary of a pending bus message for prompt context. */
export interface PendingBusMessageInfo {
  from: string;
  type: string;
  content: string;
}

export interface LieutenantContext {
  identity: LieutenantIdentity;
  currentOrders: string;
  visibleUnits: VisibleUnitInfo[];
  visibleEnemies?: VisibleEnemyInfo[];
  authorizedPeers: string[];
  terrain: string;
  recentMessages: RecentMessage[];
  /** Current state of authorized peers (for informed coordination). */
  peerStates?: PeerStateInfo[];
  /** Pending messages from the bus (support requests, peer comms, etc.). */
  pendingBusMessages?: PendingBusMessageInfo[];
  /** Working memory summary (beliefs + observations persisted across calls). */
  memorySummary?: string;
}

const PERSONALITY_GUIDANCE: Record<LieutenantIdentity['personality'], string> = {
  aggressive: `You favor bold, direct action. When given ambiguous orders, you interpret them toward attack and advance. You push hard and accept higher casualties for faster victory.`,
  cautious: `You favor careful, measured action. When given ambiguous orders, you interpret them conservatively. You prioritize troop survival and prefer flanking over frontal assault.`,
  disciplined: `You follow orders precisely as given. You do not improvise unless necessary. You maintain formation and coordination above individual initiative.`,
  impulsive: `You act quickly on instinct. You may anticipate orders or act before receiving them. You adapt rapidly to changing situations but may overextend.`,
};

const OUTPUT_SCHEMA = `{
  "directives": [
    {
      "unit": "<unit_id | 'all' | 'squad_*'>",
      "nodes": [
        {
          "id": "<unique_node_id>",
          "on": "<event_type>",
          "condition": "<optional: e.g. 'distance < 50'>",
          "action": { "type": "<action_type>", ...params },
          "priority": <optional: higher = checked first>,
          "next": "<optional: chain to node_id>",
          "else": "<optional: node_id if condition fails>"
        }
      ]
    }
  ],
  "message_up": "<optional: report to commander>",
  "message_peers": [{ "to": "<peer_id>", "content": "<message>" }],
  "response_to_player": "<optional: message to the player — use for status reports, warnings, or pushback on orders>",
  "updated_beliefs": { "<key>": "<value>" }
}`;

const EVENT_TYPES = [
  'enemy_spotted — { enemyId, position: {x,y}, distance }',
  'under_attack — { attackerId, damage }',
  'flanked — { direction: left|right|rear }',
  'message — { from, content }',
  'ally_down — { unitId, position }',
  'casualty_threshold — { lossPercent }',
  'order_received — { order, from }',
  'arrived — { position }',
  'no_enemies_visible — {}',
  'formation_broken — { reason: casualties|engagement|routing, intactPercent }',
  'morale_low — { averageMorale, lowestMorale }',
  'enemy_retreating — { enemyId, position: {x,y}, distance }',
  'terrain_entered — { terrainType: hill|forest|river, position: {x,y} }',
  'terrain_exited — { terrainType: hill|forest|river, position: {x,y} }',
];

const ACTION_TYPES = [
  'moveTo — { position: {x,y} }',
  'setFormation — { formation: line|wedge|scatter|pincer|defensive_circle|column }',
  'engage — { targetId?: string } — attack nearest enemy if no targetId',
  'fallback — { position: {x,y} }',
  'hold — {} — stay in place, defend if attacked',
  'requestSupport — { message: string }',
  'emit — { eventType: report|alert, message: string }',
];

export function buildLieutenantPrompt(context: LieutenantContext): string {
  const { identity, currentOrders, visibleUnits, visibleEnemies, authorizedPeers, terrain, recentMessages, peerStates, pendingBusMessages, memorySummary } = context;

  const sections: string[] = [];
  
  // Identity section
  sections.push(`# Identity
You are ${identity.name} (${identity.id}), a lieutenant in this battle.
Personality: ${identity.personality}
${PERSONALITY_GUIDANCE[identity.personality]}

Stats:
- initiative: ${identity.stats.initiative}/10
- discipline: ${identity.stats.discipline}/10  
- communication: ${identity.stats.communication}/10`);

  // Current orders
  sections.push(`# Current Orders
${currentOrders}`);

  // Units under command
  const unitList = visibleUnits.map(u => 
    `- ${u.id} at (${u.position.x}, ${u.position.y}) — health: ${u.health}%, morale: ${u.morale}%`
  ).join('\n');
  
  sections.push(`# Units Under Your Command
${unitList || '(No units currently visible)'}`);

  // Visible enemies
  if (visibleEnemies !== undefined) {
    if (visibleEnemies.length > 0) {
      const enemyList = visibleEnemies.map(e =>
        `- Enemy ${e.id} at (${e.position.x}, ${e.position.y}) — distance: ${Math.round(e.distance)}`
      ).join('\n');
      sections.push(`# Visible Enemy Positions
${enemyList}`);
    } else {
      sections.push(`# Visible Enemy Positions
No enemies currently visible.`);
    }
  }

  // Authorized peers
  sections.push(`# Authorized Peer Communication
You may communicate with: ${authorizedPeers.length > 0 ? authorizedPeers.join(', ') : '(none)'}`);

  // Peer status (situational awareness for coordination)
  if (peerStates && peerStates.length > 0) {
    const peerList = peerStates.map(p =>
      `- ${p.name} (${p.id}) at (${Math.round(p.position.x)}, ${Math.round(p.position.y)}) — troops: ${p.troopsAlive}/${p.troopsTotal}, morale: ${Math.round(p.averageMorale)}%, action: ${p.currentAction}`
    ).join('\n');
    sections.push(`# Peer Status
${peerList}`);
  }

  // Pending bus messages (support requests, peer comms, alerts)
  if (pendingBusMessages && pendingBusMessages.length > 0) {
    const msgList = pendingBusMessages.map(m =>
      `- [${m.type}] from ${m.from}: ${m.content}`
    ).join('\n');
    sections.push(`# Incoming Messages
${msgList}`);
  }

  // Terrain
  sections.push(`# Terrain
${terrain}`);

  // Working memory (persisted across LLM calls)
  if (memorySummary) {
    sections.push(`# Working Memory
This is your accumulated knowledge from previous assessments. Use it to inform decisions.
${memorySummary}`);
  }

  // Recent messages
  if (recentMessages.length > 0) {
    const messageList = recentMessages
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(m => `[${m.from}]: ${m.content}`)
      .join('\n');
    
    sections.push(`# Recent Messages
${messageList}`);
  }

  // Event vocabulary
  sections.push(`# Event Types (triggers for your flowchart nodes)
${EVENT_TYPES.map(e => `- ${e}`).join('\n')}`);

  // Action vocabulary
  sections.push(`# Action Types (what your troops can do)
${ACTION_TYPES.map(a => `- ${a}`).join('\n')}`);

  // Output format
  sections.push(`# Output Format
Respond with ONLY valid JSON matching this schema:
${OUTPUT_SCHEMA}

Rules:
1. Every directive needs at least one node.
2. Use conditions to create branching logic (e.g., "distance < 50").
3. Chain nodes with "next" for sequential actions.
4. Higher priority nodes are checked first for the same event.
5. Always include a fallback for "under_attack" (troops should defend themselves).
6. Report important observations up to your commander via "message_up".
7. Coordinate with authorized peers via "message_peers" when useful.
8. Use "response_to_player" to report status, warn about dangers, or push back on risky orders.
9. Use "updated_beliefs" to record key facts you want to remember (enemy positions, threat assessments, plans). These persist across calls.

Think about what your troops should do in response to each event type. Write comprehensive flowcharts that handle edge cases.`);

  return sections.join('\n\n');
}
