// Lieutenant output schema - validated with Zod

import { z } from 'zod';

export const FlowchartNodeSchema = z.object({
  id: z.string(),
  on: z.enum([
    'enemy_spotted', 'under_attack', 'flanked', 'message',
    'ally_down', 'casualty_threshold', 'order_received',
    'tick', 'arrived', 'no_enemies_visible',
  ]),
  condition: z.string().optional(),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('moveTo'), position: z.object({ x: z.number(), y: z.number() }) }),
    z.object({ type: z.literal('setFormation'), formation: z.enum(['line', 'wedge', 'scatter', 'pincer', 'defensive_circle', 'column']) }),
    z.object({ type: z.literal('engage'), targetId: z.string().optional() }),
    z.object({ type: z.literal('fallback'), position: z.object({ x: z.number(), y: z.number() }) }),
    z.object({ type: z.literal('hold') }),
    z.object({ type: z.literal('requestSupport'), message: z.string() }),
    z.object({ type: z.literal('emit'), eventType: z.enum(['report', 'alert']), message: z.string() }),
  ]),
  next: z.string().optional(),
  else: z.string().optional(),
  priority: z.number().optional(),
});

export type FlowchartNodeInput = z.infer<typeof FlowchartNodeSchema>;

export const FlowchartDirectiveSchema = z.object({
  unit: z.string(),
  nodes: z.array(FlowchartNodeSchema),
});

export type FlowchartDirective = z.infer<typeof FlowchartDirectiveSchema>;

export const PeerMessageSchema = z.object({
  to: z.string(),
  content: z.string(),
});

export const LieutenantOutputSchema = z.object({
  directives: z.array(FlowchartDirectiveSchema),
  self_directives: z.array(FlowchartDirectiveSchema).optional(),
  message_up: z.string().optional(),
  message_peers: z.array(PeerMessageSchema).optional(),
});

export type LieutenantOutput = z.infer<typeof LieutenantOutputSchema>;

export interface ValidationResult {
  success: boolean;
  data?: LieutenantOutput;
  error?: string;
}

export function validateLieutenantOutput(raw: unknown): ValidationResult {
  const result = LieutenantOutputSchema.safeParse(raw);

  if (result.success) {
    return { success: true, data: result.data };
  } else {
    const errors = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    });
    return { success: false, error: errors.join('; ') };
  }
}

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1]!.trim();
  }
  return text.trim();
}

export function parseLieutenantOutput(jsonString: string): ValidationResult {
  try {
    const cleaned = extractJSON(jsonString);
    const raw = JSON.parse(cleaned);
    return validateLieutenantOutput(raw);
  } catch (e) {
    return { success: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
}
