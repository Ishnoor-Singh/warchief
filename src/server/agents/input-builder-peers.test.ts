/**
 * Peer state in lieutenant prompts — TDD red phase.
 *
 * Tests that lieutenant prompts include information about their
 * authorized peers' current situation, enabling informed coordination.
 */

import { describe, it, expect } from 'vitest';
import {
  buildLieutenantPrompt,
  type LieutenantContext,
  type PeerStateInfo,
} from './input-builder.js';

describe('Peer state in lieutenant prompts', () => {
  const baseContext: LieutenantContext = {
    identity: {
      id: 'lt_alpha',
      name: 'Lt. Alpha',
      personality: 'aggressive',
      stats: { initiative: 7, discipline: 5, communication: 6 },
    },
    currentOrders: 'Advance east.',
    visibleUnits: [
      { id: 'p_s1_0', position: { x: 100, y: 100 }, health: 100, morale: 80 },
    ],
    authorizedPeers: ['lt_bravo'],
    terrain: 'Open field.',
    recentMessages: [],
  };

  it('should include peer state section when peerStates is provided', () => {
    const ctx: LieutenantContext = {
      ...baseContext,
      peerStates: [
        {
          id: 'lt_bravo',
          name: 'Lt. Bravo',
          troopsAlive: 8,
          troopsTotal: 10,
          averageMorale: 75,
          currentAction: 'engaging',
          position: { x: 200, y: 150 },
        },
      ],
    };

    const prompt = buildLieutenantPrompt(ctx);

    expect(prompt).toContain('Peer Status');
    expect(prompt).toContain('Lt. Bravo');
    expect(prompt).toContain('8/10');
    expect(prompt).toContain('75');
    expect(prompt).toContain('engaging');
  });

  it('should show multiple peers', () => {
    const ctx: LieutenantContext = {
      ...baseContext,
      authorizedPeers: ['lt_bravo', 'lt_charlie'],
      peerStates: [
        {
          id: 'lt_bravo',
          name: 'Lt. Bravo',
          troopsAlive: 8,
          troopsTotal: 10,
          averageMorale: 75,
          currentAction: 'engaging',
          position: { x: 200, y: 150 },
        },
        {
          id: 'lt_charlie',
          name: 'Lt. Charlie',
          troopsAlive: 3,
          troopsTotal: 10,
          averageMorale: 30,
          currentAction: 'falling_back',
          position: { x: 50, y: 200 },
        },
      ],
    };

    const prompt = buildLieutenantPrompt(ctx);

    expect(prompt).toContain('Lt. Bravo');
    expect(prompt).toContain('Lt. Charlie');
    expect(prompt).toContain('3/10');
    expect(prompt).toContain('falling_back');
  });

  it('should not include peer status section when peerStates is undefined', () => {
    const prompt = buildLieutenantPrompt(baseContext);
    expect(prompt).not.toContain('Peer Status');
  });

  it('should not include peer status section when peerStates is empty', () => {
    const ctx: LieutenantContext = {
      ...baseContext,
      peerStates: [],
    };
    const prompt = buildLieutenantPrompt(ctx);
    expect(prompt).not.toContain('Peer Status');
  });

  it('should include pending bus messages in context', () => {
    const ctx: LieutenantContext = {
      ...baseContext,
      pendingBusMessages: [
        { from: 'p_s1_3', type: 'support_request', content: 'Under heavy fire at east flank' },
        { from: 'lt_bravo', type: 'peer_message', content: 'Flanking from the south' },
      ],
    };

    const prompt = buildLieutenantPrompt(ctx);

    expect(prompt).toContain('Incoming Messages');
    expect(prompt).toContain('Under heavy fire');
    expect(prompt).toContain('support_request');
    expect(prompt).toContain('Flanking from the south');
  });

  it('should not include incoming messages section when none pending', () => {
    const prompt = buildLieutenantPrompt(baseContext);
    expect(prompt).not.toContain('Incoming Messages');
  });
});
