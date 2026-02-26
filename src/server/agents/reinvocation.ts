/**
 * Lieutenant re-invocation triggers.
 *
 * Tracks significant battlefield events per lieutenant and determines
 * when the LLM should be re-called to reassess the situation. This closes
 * the feedback loop: instead of fire-and-forget flowcharts, lieutenants
 * now react to changing conditions.
 *
 * Trigger conditions (any of these after cooldown):
 * - Casualties exceed threshold (troops dying under their command)
 * - Support requests from troops accumulate
 * - Peer messages arrive from other lieutenants
 * - Stalemate warning from the simulation
 * - Idle too long without any LLM call (periodic reassessment)
 */

/** Minimum ticks between re-invocations (5 seconds at 10 ticks/sec). */
export const REINVOCATION_COOLDOWN_TICKS = 50;

/** Number of troop deaths before triggering re-invocation. */
export const CASUALTY_THRESHOLD = 3;

/** Number of support requests before triggering re-invocation. */
export const SUPPORT_REQUEST_THRESHOLD = 2;

/** Ticks of inactivity before forcing a reassessment (15 seconds). */
export const IDLE_THRESHOLD_TICKS = 150;

export type ReinvocationEventType =
  | 'casualty'
  | 'support_request'
  | 'peer_message'
  | 'tick'
  | 'stalemate_warning';

export interface ReinvocationTracker {
  lieutenantId: string;
  casualtiesSinceLastCall: number;
  supportRequestsSinceLastCall: number;
  peerMessagesPending: number;
  ticksSinceLastCall: number;
  stalemateWarning: boolean;
  lastCallTick: number;
}

export function createReinvocationTracker(lieutenantId: string): ReinvocationTracker {
  return {
    lieutenantId,
    casualtiesSinceLastCall: 0,
    supportRequestsSinceLastCall: 0,
    peerMessagesPending: 0,
    ticksSinceLastCall: 0,
    stalemateWarning: false,
    lastCallTick: 0,
  };
}

export function recordEvent(tracker: ReinvocationTracker, event: ReinvocationEventType): void {
  switch (event) {
    case 'casualty':
      tracker.casualtiesSinceLastCall++;
      break;
    case 'support_request':
      tracker.supportRequestsSinceLastCall++;
      break;
    case 'peer_message':
      tracker.peerMessagesPending++;
      break;
    case 'tick':
      tracker.ticksSinceLastCall++;
      break;
    case 'stalemate_warning':
      tracker.stalemateWarning = true;
      break;
  }
}

/**
 * Check whether a lieutenant should be re-invoked.
 *
 * Returns true if enough time has passed since the last call (cooldown)
 * AND at least one significant trigger condition is met.
 * The idle threshold bypasses the need for a trigger — it fires on its own.
 */
export function shouldReinvoke(tracker: ReinvocationTracker): boolean {
  // Idle threshold bypasses cooldown — if we haven't called in 15s, just call
  if (tracker.ticksSinceLastCall >= IDLE_THRESHOLD_TICKS) {
    return true;
  }

  // Respect cooldown for all other triggers
  if (tracker.ticksSinceLastCall < REINVOCATION_COOLDOWN_TICKS) {
    return false;
  }

  // Any significant trigger?
  if (tracker.casualtiesSinceLastCall >= CASUALTY_THRESHOLD) return true;
  if (tracker.supportRequestsSinceLastCall >= SUPPORT_REQUEST_THRESHOLD) return true;
  if (tracker.peerMessagesPending > 0) return true;
  if (tracker.stalemateWarning) return true;

  return false;
}

/** Reset the tracker after a lieutenant LLM call completes. */
export function markReinvoked(tracker: ReinvocationTracker, currentTick: number): void {
  tracker.casualtiesSinceLastCall = 0;
  tracker.supportRequestsSinceLastCall = 0;
  tracker.peerMessagesPending = 0;
  tracker.ticksSinceLastCall = 0;
  tracker.stalemateWarning = false;
  tracker.lastCallTick = currentTick;
}
