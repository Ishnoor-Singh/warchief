/**
 * Message bus — typed, prioritized pub-sub for agent-to-agent communication.
 *
 * This is the backbone for all communication in the game:
 * - Troop → Lieutenant (support requests, status reports)
 * - Lieutenant → Lieutenant (peer coordination)
 * - Lieutenant → Commander (reports up)
 * - Commander → Lieutenant (orders down)
 * - Broadcast (intel reports, alerts)
 *
 * Messages are prioritized (higher = processed first) and can target
 * a specific agent or broadcast to all (to = null).
 */

export interface BusMessage {
  from: string;
  to: string | null;  // null = broadcast to all
  type: string;
  payload: Record<string, unknown>;
  priority: number;   // higher = processed first
  tick: number;       // simulation tick when sent
}

export type MessageHandler = (message: BusMessage) => void;

export interface MessageBus {
  queue: BusMessage[];
  subscribers: Map<string, MessageHandler[]>;
}

/** Create an empty message bus. */
export function createMessageBus(): MessageBus {
  return {
    queue: [],
    subscribers: new Map(),
  };
}

/** Enqueue a message for delivery on next drain. */
export function send(bus: MessageBus, message: BusMessage): void {
  bus.queue.push(message);
}

/** Register a handler for messages targeting a specific agent.
 *  Use agent = "*" to receive all messages (wildcard). */
export function subscribe(bus: MessageBus, agent: string, handler: MessageHandler): void {
  const handlers = bus.subscribers.get(agent) ?? [];
  handlers.push(handler);
  bus.subscribers.set(agent, handlers);
}

/**
 * Drain all messages, delivering to subscribers in priority order.
 * Clears the queue after delivery.
 */
export function drain(bus: MessageBus): void {
  // Sort by priority descending
  const sorted = bus.queue.splice(0).sort((a, b) => b.priority - a.priority);

  for (const msg of sorted) {
    if (msg.to !== null) {
      // Targeted message — deliver to target's subscribers
      deliver(bus, msg.to, msg);
    } else {
      // Broadcast — deliver to all subscribers except sender
      for (const agentId of bus.subscribers.keys()) {
        if (agentId === msg.from || agentId === '*') continue;
        deliver(bus, agentId, msg);
      }
    }

    // Always deliver to wildcard subscribers
    const wildcardHandlers = bus.subscribers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(msg);
      }
    }
  }
}

/**
 * Drain only messages for a specific agent, returning them sorted by priority.
 * Removes drained messages from the queue, leaving others.
 */
export function drainFor(bus: MessageBus, agentId: string): BusMessage[] {
  const forAgent: BusMessage[] = [];
  const remaining: BusMessage[] = [];

  for (const msg of bus.queue) {
    const isTargeted = msg.to === agentId;
    const isBroadcast = msg.to === null && msg.from !== agentId;

    if (isTargeted || isBroadcast) {
      forAgent.push(msg);
    } else {
      remaining.push(msg);
    }
  }

  bus.queue = remaining;
  forAgent.sort((a, b) => b.priority - a.priority);
  return forAgent;
}

function deliver(bus: MessageBus, agentId: string, msg: BusMessage): void {
  const handlers = bus.subscribers.get(agentId);
  if (!handlers) return;
  for (const handler of handlers) {
    handler(msg);
  }
}
