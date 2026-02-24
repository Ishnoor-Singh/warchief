import { useRef, useEffect } from 'react';
import type { BattleState } from '../types';

interface Props {
  battleState: BattleState;
  selectedLieutenant: string | null;
}

const SCALE = 2; // Scale up for better visibility

export function BattlefieldCanvas({ battleState, selectedLieutenant }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw agents
    for (const agent of battleState.agents) {
      if (!agent.alive) continue;

      const x = agent.position.x * SCALE;
      const y = agent.position.y * SCALE;
      const radius = agent.type === 'lieutenant' ? 8 : 5;

      // Color based on team
      const baseColor = agent.team === 'player' ? '#4a9eff' : '#ff4a4a';
      
      // Health indicator (darker when damaged)
      const healthRatio = agent.health / agent.maxHealth;
      ctx.globalAlpha = 0.3 + (healthRatio * 0.7);

      // Draw unit
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = baseColor;
      ctx.fill();

      // Highlight if selected lieutenant's troop
      // (We'd need troop->lieutenant mapping for this)
      
      ctx.globalAlpha = 1;

      // Draw health bar for damaged units
      if (healthRatio < 1) {
        const barWidth = radius * 2;
        const barHeight = 2;
        const barX = x - radius;
        const barY = y - radius - 4;

        // Background
        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        // Health
        ctx.fillStyle = healthRatio > 0.5 ? '#4aff6a' : healthRatio > 0.25 ? '#ffaa4a' : '#ff4a4a';
        ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);
      }
    }

    // Draw legend
    ctx.font = '12px Inter, sans-serif';
    ctx.fillStyle = '#4a9eff';
    ctx.fillText('● Player', 10, canvas.height - 30);
    ctx.fillStyle = '#ff4a4a';
    ctx.fillText('● Enemy', 10, canvas.height - 10);

  }, [battleState, selectedLieutenant]);

  return (
    <canvas
      ref={canvasRef}
      width={battleState.width * SCALE}
      height={battleState.height * SCALE}
      className="battlefield"
    />
  );
}
