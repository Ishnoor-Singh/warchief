// RED: Tests for lieutenant output schema validation
import { describe, it, expect } from 'vitest';
import { validateLieutenantOutput, parseLieutenantOutput, LieutenantOutput } from './schema.js';

describe('LieutenantOutput Schema Validation', () => {
  describe('validateLieutenantOutput', () => {
    it('accepts valid minimal output', () => {
      const input: LieutenantOutput = {
        directives: [],
      };
      
      const result = validateLieutenantOutput(input);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(input);
    });

    it('accepts valid output with hold directive', () => {
      const input: LieutenantOutput = {
        directives: [
          {
            unit: 'squad_1',
            nodes: [
              {
                id: 'hold_position',
                on: 'tick',
                action: { type: 'hold' },
              },
            ],
          },
        ],
      };
      
      const result = validateLieutenantOutput(input);
      expect(result.success).toBe(true);
    });

    it('accepts valid output with moveTo directive', () => {
      const input: LieutenantOutput = {
        directives: [
          {
            unit: 'all',
            nodes: [
              {
                id: 'advance',
                on: 'order_received',
                action: { type: 'moveTo', position: { x: 200, y: 150 } },
                priority: 10,
              },
            ],
          },
        ],
        message_up: 'Moving to position as ordered.',
      };
      
      const result = validateLieutenantOutput(input);
      expect(result.success).toBe(true);
      expect(result.data?.message_up).toBe('Moving to position as ordered.');
    });

    it('accepts valid output with conditional engage', () => {
      const input: LieutenantOutput = {
        directives: [
          {
            unit: 'squad_1',
            nodes: [
              {
                id: 'engage_close',
                on: 'enemy_spotted',
                condition: 'distance < 50',
                action: { type: 'engage' },
                priority: 5,
              },
              {
                id: 'fallback_far',
                on: 'enemy_spotted',
                condition: 'distance >= 50',
                action: { type: 'fallback', position: { x: 100, y: 100 } },
                else: 'engage_close',
              },
            ],
          },
        ],
      };
      
      const result = validateLieutenantOutput(input);
      expect(result.success).toBe(true);
    });

    it('accepts valid output with peer messages', () => {
      const input: LieutenantOutput = {
        directives: [],
        message_up: 'Requesting support on left flank.',
        message_peers: [
          { to: 'lt_bravo', content: 'Can you cover our retreat?' },
        ],
      };
      
      const result = validateLieutenantOutput(input);
      expect(result.success).toBe(true);
      expect(result.data?.message_peers).toHaveLength(1);
    });

    it('accepts all formation types', () => {
      const formations = ['line', 'wedge', 'scatter', 'pincer', 'defensive_circle', 'column'] as const;
      
      for (const formation of formations) {
        const input: LieutenantOutput = {
          directives: [
            {
              unit: 'all',
              nodes: [
                {
                  id: 'set_formation',
                  on: 'order_received',
                  action: { type: 'setFormation', formation },
                },
              ],
            },
          ],
        };
        
        const result = validateLieutenantOutput(input);
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid event type', () => {
      const input = {
        directives: [
          {
            unit: 'squad_1',
            nodes: [
              {
                id: 'bad_node',
                on: 'invalid_event',
                action: { type: 'hold' },
              },
            ],
          },
        ],
      };
      
      const result = validateLieutenantOutput(input);
      expect(result.success).toBe(false);
      expect(result.error).toContain('on');
    });

    it('rejects invalid action type', () => {
      const input = {
        directives: [
          {
            unit: 'squad_1',
            nodes: [
              {
                id: 'bad_node',
                on: 'tick',
                action: { type: 'explode' },
              },
            ],
          },
        ],
      };
      
      const result = validateLieutenantOutput(input);
      expect(result.success).toBe(false);
    });

    it('rejects moveTo without position', () => {
      const input = {
        directives: [
          {
            unit: 'squad_1',
            nodes: [
              {
                id: 'bad_move',
                on: 'tick',
                action: { type: 'moveTo' },
              },
            ],
          },
        ],
      };
      
      const result = validateLieutenantOutput(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing directives', () => {
      const input = {
        message_up: 'Hello commander',
      };
      
      const result = validateLieutenantOutput(input);
      expect(result.success).toBe(false);
    });
  });

  describe('parseLieutenantOutput', () => {
    it('parses valid JSON string', () => {
      const json = JSON.stringify({
        directives: [
          {
            unit: 'all',
            nodes: [
              { id: 'hold', on: 'tick', action: { type: 'hold' } },
            ],
          },
        ],
      });
      
      const result = parseLieutenantOutput(json);
      expect(result.success).toBe(true);
    });

    it('rejects invalid JSON', () => {
      const result = parseLieutenantOutput('{ invalid json }');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('rejects valid JSON with invalid schema', () => {
      const json = JSON.stringify({ invalid: 'schema' });
      const result = parseLieutenantOutput(json);
      expect(result.success).toBe(false);
    });

    it('handles JSON with extra whitespace and formatting', () => {
      const json = `
        {
          "directives": [
            {
              "unit": "squad_1",
              "nodes": [
                {
                  "id": "engage",
                  "on": "enemy_spotted",
                  "action": { "type": "engage" }
                }
              ]
            }
          ]
        }
      `;
      
      const result = parseLieutenantOutput(json);
      expect(result.success).toBe(true);
    });
  });
});
