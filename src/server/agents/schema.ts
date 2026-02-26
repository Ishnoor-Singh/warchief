// Lieutenant output schema - validated with Zod
// This is the contract between LLM output and the flowchart compiler

import { z } from 'zod';

// Flowchart node schema (matches runtime/flowchart.ts)
export const FlowchartNodeSchema = z.object({
  id: z.string(),
  on: z.enum([
    'enemy_spotted',
    'under_attack',
    'flanked',
    'message',
    'ally_down',
    'casualty_threshold',
    'order_received',
    'tick',
    'arrived',
    'no_enemies_visible',
    'formation_broken',
    'morale_low',
    'enemy_retreating',
    'terrain_entered',
    'terrain_exited',
  ]),
  condition: z.string().optional(),
  action: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('moveTo'),
      position: z.object({ x: z.number(), y: z.number() }),
    }),
    z.object({
      type: z.literal('setFormation'),
      formation: z.enum(['line', 'wedge', 'scatter', 'pincer', 'defensive_circle', 'column']),
    }),
    z.object({
      type: z.literal('engage'),
      targetId: z.string().optional(),
    }),
    z.object({
      type: z.literal('fallback'),
      position: z.object({ x: z.number(), y: z.number() }),
    }),
    z.object({
      type: z.literal('hold'),
    }),
    z.object({
      type: z.literal('requestSupport'),
      message: z.string(),
    }),
    z.object({
      type: z.literal('emit'),
      eventType: z.enum(['report', 'alert']),
      message: z.string(),
    }),
  ]),
  next: z.string().optional(),
  else: z.string().optional(),
  priority: z.number().optional(),
});

export type FlowchartNodeInput = z.infer<typeof FlowchartNodeSchema>;

// Directive for a unit or group of units
export const FlowchartDirectiveSchema = z.object({
  unit: z.string(), // unit id, 'all', or 'squad_*' pattern
  nodes: z.array(FlowchartNodeSchema),
});

export type FlowchartDirective = z.infer<typeof FlowchartDirectiveSchema>;

// Peer message
export const PeerMessageSchema = z.object({
  to: z.string(),
  content: z.string(),
});

// Complete lieutenant output
export const LieutenantOutputSchema = z.object({
  directives: z.array(FlowchartDirectiveSchema),
  self_directives: z.array(FlowchartDirectiveSchema).optional(),
  message_up: z.string().optional(), // report to commander
  message_peers: z.array(PeerMessageSchema).optional(),
  response_to_player: z.string().optional(), // direct message to the player
  updated_beliefs: z.record(z.string(), z.unknown()).optional(), // beliefs to persist in memory
});

export type LieutenantOutput = z.infer<typeof LieutenantOutputSchema>;

// Validation result
export interface ValidationResult {
  success: boolean;
  data?: LieutenantOutput;
  error?: string;
}

// Validate lieutenant output
export function validateLieutenantOutput(raw: unknown): ValidationResult {
  const result = LieutenantOutputSchema.safeParse(raw);
  
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    // Flatten Zod errors into readable format
    const errors = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    });
    return { 
      success: false, 
      error: errors.join('; ')
    };
  }
}

// Strip markdown code fences and surrounding text from LLM output
function extractJSON(text: string): string {
  // Try to extract from markdown fences first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1]!.trim();
  }
  return text.trim();
}

// Parse JSON string and validate
export function parseLieutenantOutput(jsonString: string): ValidationResult {
  try {
    const cleaned = extractJSON(jsonString);
    const raw = JSON.parse(cleaned);
    return validateLieutenantOutput(raw);
  } catch (e) {
    return { success: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
}
