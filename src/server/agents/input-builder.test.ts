// RED: Tests for lieutenant input builder (state → system prompt)
import { describe, it, expect } from 'vitest';
import { 
  buildLieutenantPrompt, 
  LieutenantContext,
  LieutenantIdentity 
} from './input-builder.js';

describe('Lieutenant Input Builder', () => {
  const baseIdentity: LieutenantIdentity = {
    id: 'lt_alpha',
    name: 'Lt. Adaeze',
    personality: 'aggressive',
    stats: { initiative: 7, discipline: 5, communication: 6 },
  };

  const baseContext: LieutenantContext = {
    identity: baseIdentity,
    currentOrders: 'Hold the ridge until further notice.',
    visibleUnits: [
      { id: 'p_s1_0', position: { x: 100, y: 100 }, health: 100, morale: 80 },
      { id: 'p_s1_1', position: { x: 115, y: 100 }, health: 75, morale: 70 },
    ],
    authorizedPeers: ['lt_bravo'],
    terrain: 'Open ground with a ridge to the east.',
    recentMessages: [],
  };

  describe('buildLieutenantPrompt', () => {
    it('includes lieutenant identity', () => {
      const prompt = buildLieutenantPrompt(baseContext);
      
      expect(prompt).toContain('Lt. Adaeze');
      expect(prompt).toContain('aggressive');
      expect(prompt).toContain('lt_alpha');
    });

    it('includes lieutenant stats', () => {
      const prompt = buildLieutenantPrompt(baseContext);
      
      expect(prompt).toContain('initiative');
      expect(prompt).toContain('7');
      expect(prompt).toContain('discipline');
      expect(prompt).toContain('communication');
    });

    it('includes current orders', () => {
      const prompt = buildLieutenantPrompt(baseContext);
      
      expect(prompt).toContain('Hold the ridge until further notice.');
    });

    it('includes visible units', () => {
      const prompt = buildLieutenantPrompt(baseContext);
      
      expect(prompt).toContain('p_s1_0');
      expect(prompt).toContain('100, 100');
      expect(prompt).toContain('health');
    });

    it('includes authorized peers', () => {
      const prompt = buildLieutenantPrompt(baseContext);
      
      expect(prompt).toContain('lt_bravo');
    });

    it('includes terrain context', () => {
      const prompt = buildLieutenantPrompt(baseContext);
      
      expect(prompt).toContain('ridge');
      expect(prompt).toContain('Open ground');
    });

    it('includes recent messages when present', () => {
      const contextWithMessages: LieutenantContext = {
        ...baseContext,
        recentMessages: [
          { from: 'commander', content: 'Advance when ready.', timestamp: 100 },
          { from: 'lt_bravo', content: 'Enemy spotted on the left.', timestamp: 95 },
        ],
      };
      
      const prompt = buildLieutenantPrompt(contextWithMessages);
      
      expect(prompt).toContain('Advance when ready');
      expect(prompt).toContain('Enemy spotted on the left');
      expect(prompt).toContain('commander');
      expect(prompt).toContain('lt_bravo');
    });

    it('includes output schema instructions', () => {
      const prompt = buildLieutenantPrompt(baseContext);
      
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('directives');
      expect(prompt).toContain('nodes');
    });

    it('includes event vocabulary', () => {
      const prompt = buildLieutenantPrompt(baseContext);
      
      expect(prompt).toContain('enemy_spotted');
      expect(prompt).toContain('under_attack');
      expect(prompt).toContain('flanked');
    });

    it('includes action vocabulary', () => {
      const prompt = buildLieutenantPrompt(baseContext);
      
      expect(prompt).toContain('moveTo');
      expect(prompt).toContain('engage');
      expect(prompt).toContain('fallback');
      expect(prompt).toContain('hold');
    });

    it('adapts tone based on personality', () => {
      const aggressivePrompt = buildLieutenantPrompt(baseContext);

      const cautiousContext: LieutenantContext = {
        ...baseContext,
        identity: { ...baseIdentity, personality: 'cautious' },
      };
      const cautiousPrompt = buildLieutenantPrompt(cautiousContext);

      // Both should work but have different guidance
      expect(aggressivePrompt).not.toBe(cautiousPrompt);
    });

    it('includes visible enemy positions when provided', () => {
      const contextWithEnemies: LieutenantContext = {
        ...baseContext,
        visibleEnemies: [
          { id: 'e_s1_0', position: { x: 300, y: 100 }, distance: 200 },
          { id: 'e_s1_1', position: { x: 310, y: 110 }, distance: 210 },
        ],
      };

      const prompt = buildLieutenantPrompt(contextWithEnemies);

      expect(prompt).toContain('e_s1_0');
      expect(prompt).toContain('300');
      expect(prompt).toContain('Enemy');
    });

    it('shows no enemies when visibleEnemies is empty', () => {
      const contextNoEnemies: LieutenantContext = {
        ...baseContext,
        visibleEnemies: [],
      };

      const prompt = buildLieutenantPrompt(contextNoEnemies);

      expect(prompt).toContain('No enemies currently visible');
    });
  });
});
