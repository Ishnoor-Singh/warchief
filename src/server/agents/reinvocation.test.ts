/**
 * Lieutenant re-invocation trigger tests — TDD red phase.
 *
 * Tracks significant events per lieutenant and signals when the LLM
 * should be re-called to reassess the situation.
 */

import { describe, it, expect } from 'vitest';
import {
  createReinvocationTracker,
  recordEvent,
  shouldReinvoke,
  markReinvoked,
  type ReinvocationTracker,
  REINVOCATION_COOLDOWN_TICKS,
  CASUALTY_THRESHOLD,
  SUPPORT_REQUEST_THRESHOLD,
  IDLE_THRESHOLD_TICKS,
} from './reinvocation.js';

describe('ReinvocationTracker', () => {
  describe('createReinvocationTracker', () => {
    it('should create tracker for a lieutenant', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      expect(tracker.lieutenantId).toBe('lt_alpha');
      expect(tracker.casualtiesSinceLastCall).toBe(0);
      expect(tracker.supportRequestsSinceLastCall).toBe(0);
      expect(tracker.ticksSinceLastCall).toBe(0);
      expect(tracker.peerMessagesPending).toBe(0);
      expect(tracker.lastCallTick).toBe(0);
    });
  });

  describe('recordEvent', () => {
    it('should track casualty events', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      recordEvent(tracker, 'casualty');
      expect(tracker.casualtiesSinceLastCall).toBe(1);
    });

    it('should track support request events', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      recordEvent(tracker, 'support_request');
      expect(tracker.supportRequestsSinceLastCall).toBe(1);
    });

    it('should track peer message events', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      recordEvent(tracker, 'peer_message');
      expect(tracker.peerMessagesPending).toBe(1);
    });

    it('should track tick events (time passing)', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      recordEvent(tracker, 'tick');
      expect(tracker.ticksSinceLastCall).toBe(1);
    });

    it('should track stalemate_warning events', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      recordEvent(tracker, 'stalemate_warning');
      expect(tracker.stalemateWarning).toBe(true);
    });
  });

  describe('shouldReinvoke', () => {
    it('should not trigger during cooldown period', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      tracker.casualtiesSinceLastCall = 100; // Way over threshold
      tracker.ticksSinceLastCall = REINVOCATION_COOLDOWN_TICKS - 1;
      expect(shouldReinvoke(tracker)).toBe(false);
    });

    it('should trigger when casualties exceed threshold', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      tracker.ticksSinceLastCall = REINVOCATION_COOLDOWN_TICKS;
      tracker.casualtiesSinceLastCall = CASUALTY_THRESHOLD;
      expect(shouldReinvoke(tracker)).toBe(true);
    });

    it('should trigger when support requests exceed threshold', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      tracker.ticksSinceLastCall = REINVOCATION_COOLDOWN_TICKS;
      tracker.supportRequestsSinceLastCall = SUPPORT_REQUEST_THRESHOLD;
      expect(shouldReinvoke(tracker)).toBe(true);
    });

    it('should trigger when idle too long', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      tracker.ticksSinceLastCall = IDLE_THRESHOLD_TICKS;
      expect(shouldReinvoke(tracker)).toBe(true);
    });

    it('should trigger on peer message after cooldown', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      tracker.ticksSinceLastCall = REINVOCATION_COOLDOWN_TICKS;
      tracker.peerMessagesPending = 1;
      expect(shouldReinvoke(tracker)).toBe(true);
    });

    it('should trigger on stalemate warning after cooldown', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      tracker.ticksSinceLastCall = REINVOCATION_COOLDOWN_TICKS;
      tracker.stalemateWarning = true;
      expect(shouldReinvoke(tracker)).toBe(true);
    });

    it('should not trigger when nothing significant happened', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      tracker.ticksSinceLastCall = REINVOCATION_COOLDOWN_TICKS;
      tracker.casualtiesSinceLastCall = 0;
      tracker.supportRequestsSinceLastCall = 0;
      tracker.peerMessagesPending = 0;
      expect(shouldReinvoke(tracker)).toBe(false);
    });
  });

  describe('markReinvoked', () => {
    it('should reset all counters', () => {
      const tracker = createReinvocationTracker('lt_alpha');
      tracker.casualtiesSinceLastCall = 5;
      tracker.supportRequestsSinceLastCall = 3;
      tracker.peerMessagesPending = 2;
      tracker.ticksSinceLastCall = 100;
      tracker.stalemateWarning = true;

      markReinvoked(tracker, 150);

      expect(tracker.casualtiesSinceLastCall).toBe(0);
      expect(tracker.supportRequestsSinceLastCall).toBe(0);
      expect(tracker.peerMessagesPending).toBe(0);
      expect(tracker.ticksSinceLastCall).toBe(0);
      expect(tracker.stalemateWarning).toBe(false);
      expect(tracker.lastCallTick).toBe(150);
    });
  });

  describe('thresholds', () => {
    it('cooldown should be 50 ticks (5 seconds)', () => {
      expect(REINVOCATION_COOLDOWN_TICKS).toBe(50);
    });

    it('casualty threshold should be 3', () => {
      expect(CASUALTY_THRESHOLD).toBe(3);
    });

    it('support request threshold should be 2', () => {
      expect(SUPPORT_REQUEST_THRESHOLD).toBe(2);
    });

    it('idle threshold should be 150 ticks (15 seconds)', () => {
      expect(IDLE_THRESHOLD_TICKS).toBe(150);
    });
  });
});
