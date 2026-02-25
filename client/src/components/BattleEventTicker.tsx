import { useRef, useEffect } from 'react';
import type { BattleEvent } from '../types';

interface Props {
  events: BattleEvent[];
}

function eventIcon(type: BattleEvent['type'], team: BattleEvent['team']): string {
  switch (type) {
    case 'kill': return team === 'player' ? '\u2620' : '\u2694'; // skull vs swords
    case 'engagement': return '\u26A0'; // warning
    case 'squad_wiped': return '\u{1F4A5}'; // explosion
    case 'casualty_milestone': return '\u{1F6A8}'; // siren
    case 'retreat': return '\u21A9'; // return arrow
    default: return '\u25CF'; // bullet
  }
}

export function BattleEventTicker({ events }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [events]);

  // Show last 50 events
  const recentEvents = events.slice(-50);

  return (
    <div className="event-ticker" ref={scrollRef}>
      {recentEvents.length === 0 ? (
        <div className="ticker-empty">Awaiting battle events...</div>
      ) : (
        recentEvents.map((evt, i) => (
          <div
            key={`${evt.tick}-${i}`}
            className={`ticker-event ${evt.type} ${evt.team}`}
          >
            <span className="ticker-icon">{eventIcon(evt.type, evt.team)}</span>
            <span className="ticker-tick">T{evt.tick}</span>
            <span className="ticker-msg">{evt.message}</span>
          </div>
        ))
      )}
    </div>
  );
}
