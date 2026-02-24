// Lieutenant LLM client: manages individual lieutenant agents

import Anthropic from '@anthropic-ai/sdk';
import { LieutenantStats } from '../../shared/types/index.js';
import { buildLieutenantPrompt, LieutenantContext, RecentMessage, VisibleUnitInfo } from './input-builder.js';
import { parseLieutenantOutput, LieutenantOutput } from './schema.js';

export interface LieutenantConfig {
  id: string;
  name: string;
  personality: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
  stats: LieutenantStats;
  troopIds: string[];
  authorizedPeers: string[];
}

export interface Lieutenant {
  id: string;
  name: string;
  personality: 'aggressive' | 'cautious' | 'disciplined' | 'impulsive';
  stats: LieutenantStats;
  troopIds: string[];
  authorizedPeers: string[];
  messageHistory: RecentMessage[];
  busy: boolean;
  lastOutput: LieutenantOutput | null;
}

export interface OrderContext {
  currentOrders: string;
  visibleUnits: VisibleUnitInfo[];
  terrain: string;
}

export interface ProcessResult {
  success: boolean;
  output?: LieutenantOutput;
  error?: string;
}

// LLM client interface for dependency injection
export interface LLMClient {
  messages: {
    create: (params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    }) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

// Default Anthropic client
let defaultClient: LLMClient | null = null;

export function getDefaultClient(): LLMClient {
  if (!defaultClient) {
    defaultClient = new Anthropic() as LLMClient;
  }
  return defaultClient;
}

// Create a new lieutenant instance
export function createLieutenant(config: LieutenantConfig): Lieutenant {
  return {
    id: config.id,
    name: config.name,
    personality: config.personality,
    stats: config.stats,
    troopIds: config.troopIds,
    authorizedPeers: config.authorizedPeers,
    messageHistory: [],
    busy: false,
    lastOutput: null,
  };
}

// Process an order and get lieutenant response
export async function processOrder(
  lieutenant: Lieutenant,
  order: string,
  context: OrderContext,
  client?: LLMClient  // Optional client for testing
): Promise<ProcessResult> {
  // Mark as busy
  lieutenant.busy = true;
  
  // Add order to message history
  const timestamp = Date.now();
  lieutenant.messageHistory.push({
    from: 'commander',
    content: order,
    timestamp,
  });
  
  // Keep only last 10 messages
  if (lieutenant.messageHistory.length > 10) {
    lieutenant.messageHistory = lieutenant.messageHistory.slice(-10);
  }
  
  // Build the prompt
  const lieutenantContext: LieutenantContext = {
    identity: {
      id: lieutenant.id,
      name: lieutenant.name,
      personality: lieutenant.personality,
      stats: lieutenant.stats,
    },
    currentOrders: context.currentOrders || order,
    visibleUnits: context.visibleUnits,
    authorizedPeers: lieutenant.authorizedPeers,
    terrain: context.terrain,
    recentMessages: lieutenant.messageHistory,
  };
  
  const systemPrompt = buildLieutenantPrompt(lieutenantContext);
  const llmClient = client || getDefaultClient();
  
  try {
    // First attempt
    let result = await callLLM(llmClient, systemPrompt, order);
    
    if (!result.success && result.error) {
      // Retry once with error context
      const retryPrompt = `${order}\n\nYour previous response was invalid: ${result.error}\nPlease respond with valid JSON only.`;
      result = await callLLM(llmClient, systemPrompt, retryPrompt);
    }
    
    if (result.success && result.output) {
      lieutenant.lastOutput = result.output;
    }
    
    lieutenant.busy = false;
    return result;
    
  } catch (error) {
    lieutenant.busy = false;
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

// Make LLM call and parse response
async function callLLM(
  client: LLMClient,
  systemPrompt: string,
  userMessage: string
): Promise<ProcessResult> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });
  
  // Extract text content
  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || !('text' in textContent)) {
    return { success: false, error: 'No text response from LLM' };
  }
  
  // Parse and validate
  const parseResult = parseLieutenantOutput(textContent.text!);
  
  if (parseResult.success) {
    return { success: true, output: parseResult.data };
  } else {
    return { success: false, error: parseResult.error };
  }
}

// Send a message from one lieutenant to another (peer communication)
export function sendPeerMessage(
  from: Lieutenant,
  to: Lieutenant,
  content: string
): void {
  const timestamp = Date.now();
  
  to.messageHistory.push({
    from: from.id,
    content,
    timestamp,
  });
  
  // Keep only last 10 messages
  if (to.messageHistory.length > 10) {
    to.messageHistory = to.messageHistory.slice(-10);
  }
}
