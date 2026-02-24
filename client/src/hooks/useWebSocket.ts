import { useEffect, useRef, useState, useCallback } from 'react';

export type WSStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseWebSocketReturn {
  status: WSStatus;
  send: (message: unknown) => void;
  lastMessage: unknown | null;
}

export function useWebSocket(url: string, onMessage?: (message: unknown) => void): UseWebSocketReturn {
  const [status, setStatus] = useState<WSStatus>('connecting');
  const [lastMessage, setLastMessage] = useState<unknown | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Store onMessage in a ref so changing it doesn't trigger reconnect
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
      };

      ws.onclose = () => {
        setStatus('disconnected');
        // Reconnect after 2 seconds
        reconnectTimeout.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        setStatus('error');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);
          onMessageRef.current?.(message);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };
    } catch (e) {
      setStatus('error');
    }
  }, [url]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { status, send, lastMessage };
}
