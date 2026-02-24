import { useState, useRef, useEffect } from 'react';
import type { Message, Lieutenant } from '../types';

interface Props {
  messages: Message[];
  lieutenants: Lieutenant[];
  selectedLieutenant: string | null;
  onSendOrder: (lieutenantId: string, order: string) => void;
}

export function MessagePanel({ messages, lieutenants, selectedLieutenant, onSendOrder }: Props) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Filter messages for selected lieutenant
  const filteredMessages = selectedLieutenant
    ? messages.filter(m => m.from === selectedLieutenant || m.to === selectedLieutenant)
    : messages;

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredMessages]);

  const handleSend = () => {
    if (!input.trim() || !selectedLieutenant) return;
    
    onSendOrder(selectedLieutenant, input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const lieutenant = lieutenants.find(lt => lt.id === selectedLieutenant);

  return (
    <div className="message-panel">
      <div className="messages-container">
        {filteredMessages.length === 0 ? (
          <div className="message-empty">
            {selectedLieutenant 
              ? `No messages with ${lieutenant?.name || 'this lieutenant'} yet.`
              : 'Select a lieutenant to send orders.'}
          </div>
        ) : (
          filteredMessages.map(msg => (
            <div key={msg.id} className={`message ${msg.type}`}>
              <div className="message-from">
                {msg.from === 'commander' ? 'You' : lieutenant?.name || msg.from}
              </div>
              <div className="message-content">{msg.content}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="message-input-container">
        <input
          type="text"
          className="message-input"
          placeholder={
            selectedLieutenant
              ? `Order ${lieutenant?.name || 'lieutenant'}...`
              : 'Select a lieutenant first'
          }
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!selectedLieutenant}
        />
        <button
          className="send-button"
          onClick={handleSend}
          disabled={!selectedLieutenant || !input.trim() || lieutenant?.busy}
        >
          {lieutenant?.busy ? '⏳' : 'Send'}
        </button>
      </div>
    </div>
  );
}
