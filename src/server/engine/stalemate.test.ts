/**
 * Stalemate detection tests — TDD red phase.
 *
 * Detects when neither side is dealing damage and escalates by
 * firing events and eventually forcing advancement.
 */

import { describe, it, expect } from 'vitest';
import {
  createStalemateTracker,
  recordCombat,
  checkStalemate,
  STALEMATE_WARNING_TICKS,
  STALEMATE_FORCE_ADVANCE_TICKS,
  type StalemateTracker,
  type StalemateStatus,
} from './stalemate.js';

describe('StalemateTracker', () => {
  describe('createStalemateTracker', () => {
    it('should initialize with zero ticks since combat', () => {
      const tracker = createStalemateTracker();
      expect(tracker.ticksSinceLastCombat).toBe(0);
      expect(tracker.warningFired).toBe(false);
      expect(tracker.forceAdvanceFired).toBe(false);
    });
  });

  describe('recordCombat', () => {
    it('should reset ticks since last combat', () => {
      const tracker = createStalemateTracker();
      tracker.ticksSinceLastCombat = 50;
      tracker.warningFired = true;
      recordCombat(tracker);
      expect(tracker.ticksSinceLastCombat).toBe(0);
      expect(tracker.warningFired).toBe(false);
    });

    it('should also reset forceAdvanceFired', () => {
      const tracker = createStalemateTracker();
      tracker.forceAdvanceFired = true;
      recordCombat(tracker);
      expect(tracker.forceAdvanceFired).toBe(false);
    });
  });

  describe('checkStalemate', () => {
    it('should return "none" when below warning threshold', () => {
      const tracker = createStalemateTracker();
      tracker.ticksSinceLastCombat = STALEMATE_WARNING_TICKS - 1;
      const status = checkStalemate(tracker);
      expect(status).toBe('none');
    });

    it('should return "warning" at warning threshold', () => {
      const tracker = createStalemateTracker();
      tracker.ticksSinceLastCombat = STALEMATE_WARNING_TICKS;
      const status = checkStalemate(tracker);
      expect(status).toBe('warning');
    });

    it('should only return "warning" once (then none until force_advance)', () => {
      const tracker = createStalemateTracker();
      tracker.ticksSinceLastCombat = STALEMATE_WARNING_TICKS;
      expect(checkStalemate(tracker)).toBe('warning');
      expect(tracker.warningFired).toBe(true);

      // Calling again before force_advance threshold should return "none"
      tracker.ticksSinceLastCombat = STALEMATE_WARNING_TICKS + 10;
      expect(checkStalemate(tracker)).toBe('none');
    });

    it('should return "force_advance" at force advance threshold', () => {
      const tracker = createStalemateTracker();
      tracker.ticksSinceLastCombat = STALEMATE_FORCE_ADVANCE_TICKS;
      tracker.warningFired = true;
      const status = checkStalemate(tracker);
      expect(status).toBe('force_advance');
    });

    it('should only return "force_advance" once', () => {
      const tracker = createStalemateTracker();
      tracker.ticksSinceLastCombat = STALEMATE_FORCE_ADVANCE_TICKS;
      tracker.warningFired = true;
      expect(checkStalemate(tracker)).toBe('force_advance');
      expect(tracker.forceAdvanceFired).toBe(true);

      tracker.ticksSinceLastCombat = STALEMATE_FORCE_ADVANCE_TICKS + 10;
      expect(checkStalemate(tracker)).toBe('none');
    });

    it('should reset all flags when combat resumes after stalemate', () => {
      const tracker = createStalemateTracker();
      tracker.ticksSinceLastCombat = STALEMATE_FORCE_ADVANCE_TICKS;
      tracker.warningFired = true;
      checkStalemate(tracker);
      expect(tracker.forceAdvanceFired).toBe(true);

      recordCombat(tracker);
      expect(tracker.ticksSinceLastCombat).toBe(0);
      expect(tracker.warningFired).toBe(false);
      expect(tracker.forceAdvanceFired).toBe(false);
    });
  });

  describe('thresholds', () => {
    it('warning should fire at 10 seconds (100 ticks)', () => {
      expect(STALEMATE_WARNING_TICKS).toBe(100);
    });

    it('force advance should fire at 20 seconds (200 ticks)', () => {
      expect(STALEMATE_FORCE_ADVANCE_TICKS).toBe(200);
    });
  });
});
