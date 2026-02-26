/**
 * Message bus tests — TDD red phase.
 *
 * The message bus is the backbone for all agent-to-agent communication.
 * It routes typed, prioritized messages between agents in the hierarchy.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createMessageBus,
  send,
  subscribe,
  drain,
  drainFor,
  type BusMessage,
  type MessageBus,
} from './message-bus.js';

describe('MessageBus', () => {
  describe('createMessageBus', () => {
    it('should create an empty bus', () => {
      const bus = createMessageBus();
      expect(bus.queue).toEqual([]);
      expect(bus.subscribers.size).toBe(0);
    });
  });

  describe('send', () => {
    it('should enqueue a message', () => {
      const bus = createMessageBus();
      send(bus, {
        from: 'troop_1',
        to: 'lt_alpha',
        type: 'support_request',
        payload: { message: 'Under heavy fire' },
        priority: 5,
        tick: 10,
      });
      expect(bus.queue).toHaveLength(1);
      expect(bus.queue[0]!.from).toBe('troop_1');
    });

    it('should enqueue multiple messages', () => {
      const bus = createMessageBus();
      send(bus, {
        from: 'lt_alpha',
        to: 'lt_bravo',
        type: 'peer_message',
        payload: { content: 'Flank left' },
        priority: 3,
        tick: 10,
      });
      send(bus, {
        from: 'lt_bravo',
        to: 'lt_alpha',
        type: 'peer_message',
        payload: { content: 'Copy that' },
        priority: 3,
        tick: 11,
      });
      expect(bus.queue).toHaveLength(2);
    });

    it('should accept broadcast messages (to = null)', () => {
      const bus = createMessageBus();
      send(bus, {
        from: 'lt_alpha',
        to: null,
        type: 'intel_report',
        payload: { enemyCount: 5, position: { x: 200, y: 150 } },
        priority: 7,
        tick: 15,
      });
      expect(bus.queue).toHaveLength(1);
      expect(bus.queue[0]!.to).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('should register a subscriber for a specific agent', () => {
      const bus = createMessageBus();
      const handler = vi.fn();
      subscribe(bus, 'lt_alpha', handler);
      expect(bus.subscribers.get('lt_alpha')).toEqual([handler]);
    });

    it('should allow multiple subscribers for the same agent', () => {
      const bus = createMessageBus();
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      subscribe(bus, 'lt_alpha', handler1);
      subscribe(bus, 'lt_alpha', handler2);
      expect(bus.subscribers.get('lt_alpha')).toHaveLength(2);
    });

    it('should register a broadcast subscriber (agent = "*")', () => {
      const bus = createMessageBus();
      const handler = vi.fn();
      subscribe(bus, '*', handler);
      expect(bus.subscribers.get('*')).toEqual([handler]);
    });
  });

  describe('drain', () => {
    it('should deliver messages to targeted subscribers', () => {
      const bus = createMessageBus();
      const handler = vi.fn();
      subscribe(bus, 'lt_alpha', handler);

      send(bus, {
        from: 'troop_1',
        to: 'lt_alpha',
        type: 'support_request',
        payload: { message: 'Need help' },
        priority: 5,
        tick: 10,
      });

      drain(bus);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        from: 'troop_1',
        to: 'lt_alpha',
        type: 'support_request',
      }));
    });

    it('should deliver messages in priority order (highest first)', () => {
      const bus = createMessageBus();
      const received: string[] = [];
      subscribe(bus, 'lt_alpha', (msg) => received.push(msg.type));

      send(bus, { from: 'a', to: 'lt_alpha', type: 'low_priority', payload: {}, priority: 1, tick: 10 });
      send(bus, { from: 'b', to: 'lt_alpha', type: 'high_priority', payload: {}, priority: 10, tick: 10 });
      send(bus, { from: 'c', to: 'lt_alpha', type: 'medium_priority', payload: {}, priority: 5, tick: 10 });

      drain(bus);

      expect(received).toEqual(['high_priority', 'medium_priority', 'low_priority']);
    });

    it('should deliver broadcast messages to all subscribers', () => {
      const bus = createMessageBus();
      const alphaHandler = vi.fn();
      const bravoHandler = vi.fn();
      subscribe(bus, 'lt_alpha', alphaHandler);
      subscribe(bus, 'lt_bravo', bravoHandler);

      send(bus, {
        from: 'commander',
        to: null,
        type: 'intel_report',
        payload: { info: 'Enemy spotted' },
        priority: 7,
        tick: 15,
      });

      drain(bus);

      expect(alphaHandler).toHaveBeenCalledTimes(1);
      expect(bravoHandler).toHaveBeenCalledTimes(1);
    });

    it('should not deliver broadcast messages back to sender', () => {
      const bus = createMessageBus();
      const alphaHandler = vi.fn();
      subscribe(bus, 'lt_alpha', alphaHandler);

      send(bus, {
        from: 'lt_alpha',
        to: null,
        type: 'intel_report',
        payload: {},
        priority: 5,
        tick: 10,
      });

      drain(bus);

      expect(alphaHandler).not.toHaveBeenCalled();
    });

    it('should deliver to wildcard (*) subscribers for all messages', () => {
      const bus = createMessageBus();
      const wildcardHandler = vi.fn();
      subscribe(bus, '*', wildcardHandler);

      send(bus, { from: 'a', to: 'lt_alpha', type: 'msg', payload: {}, priority: 1, tick: 10 });
      send(bus, { from: 'b', to: 'lt_bravo', type: 'msg', payload: {}, priority: 1, tick: 10 });

      drain(bus);

      expect(wildcardHandler).toHaveBeenCalledTimes(2);
    });

    it('should empty the queue after drain', () => {
      const bus = createMessageBus();
      subscribe(bus, 'lt_alpha', vi.fn());

      send(bus, { from: 'a', to: 'lt_alpha', type: 'msg', payload: {}, priority: 1, tick: 10 });
      drain(bus);

      expect(bus.queue).toHaveLength(0);
    });

    it('should not fail if no subscriber exists for target', () => {
      const bus = createMessageBus();
      send(bus, { from: 'a', to: 'nobody', type: 'msg', payload: {}, priority: 1, tick: 10 });
      expect(() => drain(bus)).not.toThrow();
      expect(bus.queue).toHaveLength(0);
    });
  });

  describe('drainFor', () => {
    it('should return only messages for a specific agent', () => {
      const bus = createMessageBus();

      send(bus, { from: 'a', to: 'lt_alpha', type: 'msg1', payload: {}, priority: 1, tick: 10 });
      send(bus, { from: 'b', to: 'lt_bravo', type: 'msg2', payload: {}, priority: 1, tick: 10 });
      send(bus, { from: 'c', to: 'lt_alpha', type: 'msg3', payload: {}, priority: 1, tick: 11 });

      const messages = drainFor(bus, 'lt_alpha');

      expect(messages).toHaveLength(2);
      expect(messages[0]!.type).toBe('msg1');
      expect(messages[1]!.type).toBe('msg3');
    });

    it('should include broadcast messages', () => {
      const bus = createMessageBus();

      send(bus, { from: 'a', to: null, type: 'broadcast', payload: {}, priority: 5, tick: 10 });
      send(bus, { from: 'b', to: 'lt_alpha', type: 'direct', payload: {}, priority: 1, tick: 10 });

      const messages = drainFor(bus, 'lt_alpha');

      expect(messages).toHaveLength(2);
    });

    it('should not include broadcasts from self', () => {
      const bus = createMessageBus();

      send(bus, { from: 'lt_alpha', to: null, type: 'broadcast', payload: {}, priority: 5, tick: 10 });

      const messages = drainFor(bus, 'lt_alpha');
      expect(messages).toHaveLength(0);
    });

    it('should remove drained messages from queue, leaving others', () => {
      const bus = createMessageBus();

      send(bus, { from: 'a', to: 'lt_alpha', type: 'msg1', payload: {}, priority: 1, tick: 10 });
      send(bus, { from: 'b', to: 'lt_bravo', type: 'msg2', payload: {}, priority: 1, tick: 10 });

      drainFor(bus, 'lt_alpha');

      expect(bus.queue).toHaveLength(1);
      expect(bus.queue[0]!.to).toBe('lt_bravo');
    });

    it('should return messages sorted by priority (highest first)', () => {
      const bus = createMessageBus();

      send(bus, { from: 'a', to: 'lt_alpha', type: 'low', payload: {}, priority: 1, tick: 10 });
      send(bus, { from: 'b', to: 'lt_alpha', type: 'high', payload: {}, priority: 10, tick: 10 });

      const messages = drainFor(bus, 'lt_alpha');
      expect(messages[0]!.type).toBe('high');
      expect(messages[1]!.type).toBe('low');
    });
  });
});
