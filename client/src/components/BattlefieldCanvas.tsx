import { useRef, useEffect } from 'react';
import type { BattleState, VisibilityZone } from '../types';

interface Props {
  battleState: BattleState;
  selectedLieutenant: string | null;
}

const SCALE = 2;

export function BattlefieldCanvas({ battleState, selectedLieutenant }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);

    // Draw grid
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw fog of war
    const zones = battleState.visibilityZones;
    if (zones && zones.length > 0) {
      drawFogOfWar(ctx, w, h, zones);
    }

    // Draw agents
    for (const agent of battleState.agents) {
      if (!agent.alive) continue;

      const x = agent.position.x * SCALE;
      const y = agent.position.y * SCALE;

      const isLt = agent.type === 'lieutenant';
      const radius = isLt ? 8 : 5;

      const isPlayer = agent.team === 'player';
      const baseColor = isPlayer ? '#4a9eff' : '#ff4a4a';

      const healthRatio = agent.health / agent.maxHealth;
      ctx.globalAlpha = 0.3 + (healthRatio * 0.7);

      // Formation indicator
      drawFormationIndicator(ctx, x, y, agent.formation, baseColor, radius);

      // Unit circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = baseColor;
      ctx.fill();

      // Action indicator border
      if (agent.currentAction === 'engaging') {
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (agent.currentAction === 'moving' || agent.currentAction === 'falling_back') {
        ctx.strokeStyle = '#ffaa4a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // Health bar for damaged units
      if (healthRatio < 1) {
        const barWidth = radius * 2;
        const barHeight = 2;
        const barX = x - radius;
        const barY = y - radius - 4;

        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        ctx.fillStyle = healthRatio > 0.5 ? '#4aff6a' : healthRatio > 0.25 ? '#ffaa4a' : '#ff4a4a';
        ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);
      }
    }

    // Legend
    ctx.font = '12px Inter, sans-serif';
    ctx.fillStyle = '#4a9eff';
    ctx.fillText('● Player', 10, h - 30);
    ctx.fillStyle = '#ff4a4a';
    ctx.fillText('● Enemy', 10, h - 10);

    ctx.fillStyle = '#808090';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillText(`Tick ${battleState.tick}`, w - 80, h - 10);

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

function drawFogOfWar(ctx: CanvasRenderingContext2D, w: number, h: number, zones: VisibilityZone[]) {
  ctx.save();

  ctx.fillStyle = 'rgba(5, 5, 15, 0.6)';
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'destination-out';

  for (const zone of zones) {
    const cx = zone.position.x * SCALE;
    const cy = zone.position.y * SCALE;
    const r = zone.radius * SCALE;

    const gradient = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(0.7, 'rgba(0,0,0,0.8)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

function drawFormationIndicator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  formation: string,
  color: string,
  radius: number
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.15;
  ctx.lineWidth = 1;

  switch (formation) {
    case 'wedge':
      ctx.beginPath();
      ctx.moveTo(x, y - radius * 2);
      ctx.lineTo(x - radius * 1.5, y + radius);
      ctx.lineTo(x + radius * 1.5, y + radius);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'defensive_circle':
      ctx.beginPath();
      ctx.arc(x, y, radius * 2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'scatter':
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * radius * 2, y + Math.sin(angle) * radius * 2, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'column':
      ctx.beginPath();
      ctx.moveTo(x, y - radius * 2);
      ctx.lineTo(x, y + radius * 2);
      ctx.stroke();
      break;
    case 'pincer':
      ctx.beginPath();
      ctx.arc(x, y, radius * 2, -Math.PI * 0.7, -Math.PI * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, radius * 2, Math.PI * 0.3, Math.PI * 0.7);
      ctx.stroke();
      break;
  }

  ctx.restore();
}
