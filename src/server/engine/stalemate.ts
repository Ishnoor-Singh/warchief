/**
 * Stalemate detection and escalation.
 *
 * Tracks ticks since the last combat damage was dealt by either side.
 * Fires two escalation levels:
 * - Warning (100 ticks / 10s): signals lieutenants that the battle is stalling
 * - Force advance (200 ticks / 20s): simulation forces all units toward center
 *
 * The tracker is a simple state machine: none → warning → force_advance.
 * Recording any combat resets it back to none.
 */

/** 10 seconds of no combat → fire warning to lieutenants. */
export const STALEMATE_WARNING_TICKS = 100;

/** 20 seconds of no combat → force all units to advance. */
export const STALEMATE_FORCE_ADVANCE_TICKS = 200;

export type StalemateStatus = 'none' | 'warning' | 'force_advance';

export interface StalemateTracker {
  ticksSinceLastCombat: number;
  warningFired: boolean;
  forceAdvanceFired: boolean;
}

export function createStalemateTracker(): StalemateTracker {
  return {
    ticksSinceLastCombat: 0,
    warningFired: false,
    forceAdvanceFired: false,
  };
}

/** Call when any damage is dealt in the simulation. Resets all stalemate state. */
export function recordCombat(tracker: StalemateTracker): void {
  tracker.ticksSinceLastCombat = 0;
  tracker.warningFired = false;
  tracker.forceAdvanceFired = false;
}

/**
 * Check stalemate status. Returns the transition that just occurred:
 * - 'warning': first time crossing warning threshold (fire once)
 * - 'force_advance': first time crossing force advance threshold (fire once)
 * - 'none': no transition this tick
 */
export function checkStalemate(tracker: StalemateTracker): StalemateStatus {
  if (!tracker.forceAdvanceFired &&
      tracker.ticksSinceLastCombat >= STALEMATE_FORCE_ADVANCE_TICKS) {
    tracker.forceAdvanceFired = true;
    return 'force_advance';
  }

  if (!tracker.warningFired &&
      tracker.ticksSinceLastCombat >= STALEMATE_WARNING_TICKS) {
    tracker.warningFired = true;
    return 'warning';
  }

  return 'none';
}
