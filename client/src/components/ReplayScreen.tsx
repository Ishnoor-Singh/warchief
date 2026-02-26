import { useState, useRef, useEffect, useCallback } from 'react';
import { BattlefieldCanvas } from './BattlefieldCanvas';
import type { BattleState } from '../types';

interface ReplayFrame {
  type: 'state' | 'ready' | 'battle_end' | 'message' | 'lieutenants';
  data: unknown;
}

interface ReplayScreenProps {
  onBack: () => void;
}

export function ReplayScreen({ onBack }: ReplayScreenProps) {
  const [frames, setFrames] = useState<BattleState[]>([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [battleInfo, setBattleInfo] = useState<{ scenario?: string; winner?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playIntervalRef = useRef<number | null>(null);

  // Parse NDJSON recording file
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const lines = content.trim().split('\n');
        const stateFrames: BattleState[] = [];
        let info: { scenario?: string; winner?: string } = {};

        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed: ReplayFrame = JSON.parse(line);
          
          if (parsed.type === 'ready') {
            const readyData = parsed.data as { scenario?: string };
            info.scenario = readyData.scenario;
          } else if (parsed.type === 'state') {
            stateFrames.push(parsed.data as BattleState);
          } else if (parsed.type === 'battle_end') {
            const endData = parsed.data as { winner?: string };
            info.winner = endData.winner;
          }
        }

        if (stateFrames.length === 0) {
          setError('No battle state frames found in file');
          return;
        }

        setFrames(stateFrames);
        setBattleInfo(info);
        setCurrentFrame(0);
        setError(null);
      } catch (err) {
        setError(`Failed to parse recording: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
  }, []);

  // Playback controls
  useEffect(() => {
    if (isPlaying && frames.length > 0) {
      playIntervalRef.current = window.setInterval(() => {
        setCurrentFrame((prev) => {
          if (prev >= frames.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 100 / playbackSpeed);
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, frames.length]);

  const currentState = frames[currentFrame] || {
    tick: 0,
    agents: [],
    width: 400,
    height: 300,
    running: false,
    winner: null,
  };

  const playerAlive = currentState.agents.filter(a => a.team === 'player' && a.alive).length;
  const enemyAlive = currentState.agents.filter(a => a.team === 'enemy' && a.alive).length;

  return (
    <div className="replay-screen" style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>⏮️ Battle Replay</h1>
        <button onClick={onBack} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          ← Back
        </button>
      </div>

      {frames.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <h2>Upload a Battle Recording</h2>
          <p style={{ color: '#888', marginBottom: '20px' }}>
            Upload an NDJSON file from a headless battle or recorded game
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ndjson,.json,.txt"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '16px 32px',
              fontSize: '18px',
              cursor: 'pointer',
              backgroundColor: '#4a90d9',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
            }}
          >
            📁 Choose File
          </button>
          {error && <p style={{ color: '#e74c3c', marginTop: '20px' }}>{error}</p>}
        </div>
      ) : (
        <>
          {/* Battle info */}
          {battleInfo && (
            <div style={{ marginBottom: '10px', color: '#888' }}>
              {battleInfo.scenario && <span>Scenario: {battleInfo.scenario} | </span>}
              {battleInfo.winner && <span>Winner: {battleInfo.winner}</span>}
            </div>
          )}

          {/* Stats bar */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            padding: '10px 20px', 
            backgroundColor: '#1a1a2e',
            borderRadius: '8px',
            marginBottom: '10px'
          }}>
            <span>Tick: {currentState.tick}</span>
            <span>🔵 Player: {playerAlive} alive</span>
            <span>🔴 Enemy: {enemyAlive} alive</span>
            <span>Frame: {currentFrame + 1} / {frames.length}</span>
          </div>

          {/* Battlefield */}
          <div style={{ marginBottom: '20px' }}>
            <BattlefieldCanvas
              battleState={currentState}
              prevBattleState={frames[Math.max(0, currentFrame - 1)] || currentState}
              lieutenants={[]}
              selectedLieutenant={null}
            />
          </div>

          {/* Playback controls */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '20px',
            padding: '15px 20px',
            backgroundColor: '#1a1a2e',
            borderRadius: '8px'
          }}>
            <button
              onClick={() => setCurrentFrame(0)}
              style={{ padding: '8px 12px', cursor: 'pointer' }}
            >
              ⏮️
            </button>
            <button
              onClick={() => setCurrentFrame(Math.max(0, currentFrame - 10))}
              style={{ padding: '8px 12px', cursor: 'pointer' }}
            >
              ⏪
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{ 
                padding: '8px 20px', 
                cursor: 'pointer',
                backgroundColor: isPlaying ? '#e74c3c' : '#27ae60',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                minWidth: '80px'
              }}
            >
              {isPlaying ? '⏸️ Pause' : '▶️ Play'}
            </button>
            <button
              onClick={() => setCurrentFrame(Math.min(frames.length - 1, currentFrame + 10))}
              style={{ padding: '8px 12px', cursor: 'pointer' }}
            >
              ⏩
            </button>
            <button
              onClick={() => setCurrentFrame(frames.length - 1)}
              style={{ padding: '8px 12px', cursor: 'pointer' }}
            >
              ⏭️
            </button>

            {/* Speed control */}
            <div style={{ marginLeft: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>Speed:</span>
              {[0.5, 1, 2, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => setPlaybackSpeed(s)}
                  style={{
                    padding: '4px 8px',
                    cursor: 'pointer',
                    backgroundColor: playbackSpeed === s ? '#4a90d9' : '#333',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                  }}
                >
                  {s}x
                </button>
              ))}
            </div>

            {/* Scrubber */}
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={currentFrame}
              onChange={(e) => setCurrentFrame(parseInt(e.target.value))}
              style={{ flex: 1, marginLeft: '20px' }}
            />
          </div>

          {/* Load another */}
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ndjson,.json,.txt"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ padding: '8px 16px', cursor: 'pointer' }}
            >
              📁 Load Another Recording
            </button>
          </div>
        </>
      )}
    </div>
  );
}
