import { useState, useCallback } from 'react';
import usePartySocket from 'partysocket/react';

export type WSStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseWebSocketReturn {
  status: WSStatus;
  send: (message: unknown) => void;
  lastMessage: unknown | null;
}

// PartyKit connection config
const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || (
  import.meta.env.DEV
    ? 'localhost:1999'
    : window.location.host
);

export function useWebSocket(room: string, onMessage?: (message: unknown) => void): UseWebSocketReturn {
  const [status, setStatus] = useState<WSStatus>('connecting');
  const [lastMessage, setLastMessage] = useState<unknown | null>(null);

  const ws = usePartySocket({
    host: PARTYKIT_HOST,
    room,
    onOpen() {
      setStatus('connected');
    },
    onClose() {
      setStatus('disconnected');
    },
    onError() {
      setStatus('error');
    },
    onMessage(event) {
      try {
        const message = JSON.parse(event.data);
        setLastMessage(message);
        onMessage?.(message);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    },
  });

  const send = useCallback((message: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, [ws]);

  return { status, send, lastMessage };
}
