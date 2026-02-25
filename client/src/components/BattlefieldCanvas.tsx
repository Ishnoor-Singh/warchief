import { useRef, useEffect } from 'react';
import type { BattleState, VisibilityZone, Lieutenant } from '../types';

interface Props {
  battleState: BattleState;
  selectedLieutenant: string | null;
  lieutenants: Lieutenant[];
}

const SCALE = 2;

// Distinct color palettes per lieutenant (for player side)
// Each lieutenant gets a unique hue so their troops are visually grouped
const LIEUTENANT_COLORS: string[] = [
  '#4a9eff', // blue (Alpha)
  '#6bff6b', // green (Bravo)
  '#c06bff', // purple (Charlie)
  '#ffaa4a', // orange (fallback)
];

// Dimmed versions for troops (slightly less saturated)
const LIEUTENANT_TROOP_COLORS: string[] = [
  '#3a7ecc', // dimmer blue
  '#4ecc4e', // dimmer green
  '#9a4ecc', // dimmer purple
  '#cc8a3a', // dimmer orange
];

const ENEMY_COLOR = '#ff4a4a';
const ENEMY_DIM_COLOR = '#cc3a3a';

export function BattlefieldCanvas({ battleState, selectedLieutenant, lieutenants }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Build lieutenant index → color mapping
    const ltColorMap = new Map<string, { lt: string; troop: string }>();
    lieutenants.forEach((lt, i) => {
      ltColorMap.set(lt.id, {
        lt: LIEUTENANT_COLORS[i] || LIEUTENANT_COLORS[LIEUTENANT_COLORS.length - 1]!,
        troop: LIEUTENANT_TROOP_COLORS[i] || LIEUTENANT_TROOP_COLORS[LIEUTENANT_TROOP_COLORS.length - 1]!,
      });
    });

    // Build a lookup: lieutenant id → name
    const ltNameMap = new Map<string, string>();
    for (const lt of lieutenants) {
      ltNameMap.set(lt.id, lt.name);
    }

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

    // Collect lieutenant positions for drawing connection lines
    const ltPositions = new Map<string, { x: number; y: number }>();
    for (const agent of battleState.agents) {
      if (!agent.alive) continue;
      if (agent.type === 'lieutenant') {
        ltPositions.set(agent.id, {
          x: agent.position.x * SCALE,
          y: agent.position.y * SCALE,
        });
      }
    }

    // Draw faint connection lines from troops to their lieutenant (only for selected lt)
    if (selectedLieutenant) {
      const ltPos = ltPositions.get(selectedLieutenant);
      if (ltPos) {
        for (const agent of battleState.agents) {
          if (!agent.alive || agent.type !== 'troop') continue;
          if (agent.lieutenantId !== selectedLieutenant) continue;

          const tx = agent.position.x * SCALE;
          const ty = agent.position.y * SCALE;

          ctx.beginPath();
          ctx.moveTo(ltPos.x, ltPos.y);
          ctx.lineTo(tx, ty);
          ctx.strokeStyle = (ltColorMap.get(selectedLieutenant)?.lt || '#4a9eff');
          ctx.globalAlpha = 0.12;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    // Draw agents
    for (const agent of battleState.agents) {
      if (!agent.alive) continue;

      const x = agent.position.x * SCALE;
      const y = agent.position.y * SCALE;

      const isLt = agent.type === 'lieutenant';
      const radius = isLt ? 8 : 5;
      const isPlayer = agent.team === 'player';

      // Determine color based on team and lieutenant assignment
      let baseColor: string;
      if (!isPlayer) {
        baseColor = isLt ? ENEMY_COLOR : ENEMY_DIM_COLOR;
      } else if (isLt) {
        baseColor = ltColorMap.get(agent.id)?.lt || '#4a9eff';
      } else {
        baseColor = ltColorMap.get(agent.lieutenantId || '')?.troop || '#3a7ecc';
      }

      // Dim units not belonging to the selected lieutenant
      const isSelectedGroup = !selectedLieutenant
        || agent.id === selectedLieutenant
        || agent.lieutenantId === selectedLieutenant;

      const healthRatio = agent.health / agent.maxHealth;
      const selectionDim = isSelectedGroup ? 1.0 : 0.35;
      ctx.globalAlpha = (0.3 + (healthRatio * 0.7)) * selectionDim;

      // Formation indicator
      drawFormationIndicator(ctx, x, y, agent.formation, baseColor, radius);

      // Lieutenant: draw diamond shape instead of circle
      if (isLt) {
        // Outer glow ring for lieutenants
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Diamond shape
        ctx.beginPath();
        ctx.moveTo(x, y - radius);
        ctx.lineTo(x + radius, y);
        ctx.lineTo(x, y + radius);
        ctx.lineTo(x - radius, y);
        ctx.closePath();
        ctx.fillStyle = baseColor;
        ctx.fill();
      } else {
        // Troop: circle
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = baseColor;
        ctx.fill();
      }

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

      // Lieutenant name label
      if (isLt && isPlayer) {
        const name = ltNameMap.get(agent.id) || agent.id;
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = baseColor;
        ctx.textAlign = 'center';
        ctx.globalAlpha = isSelectedGroup ? 0.9 : 0.3;
        ctx.fillText(name, x, y - radius - 8);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'start';
      }

      // Health bar for damaged units
      if (healthRatio < 1) {
        const barWidth = radius * 2;
        const barHeight = 2;
        const barX = x - radius;
        const barY = y - radius - (isLt && isPlayer ? 16 : 4);

        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        ctx.fillStyle = healthRatio > 0.5 ? '#4aff6a' : healthRatio > 0.25 ? '#ffaa4a' : '#ff4a4a';
        ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);
      }
    }

    // Legend
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'start';

    let legendY = h - 10;
    // Enemy legend
    ctx.fillStyle = ENEMY_COLOR;
    ctx.fillText('● Enemy', 10, legendY);
    legendY -= 18;

    // Lieutenant legends (in reverse so first lt is closest to bottom)
    for (let i = lieutenants.length - 1; i >= 0; i--) {
      const lt = lieutenants[i]!;
      const color = LIEUTENANT_COLORS[i] || LIEUTENANT_COLORS[LIEUTENANT_COLORS.length - 1]!;
      ctx.fillStyle = color;
      ctx.fillText(`◆ ${lt.name}`, 10, legendY);
      legendY -= 18;
    }

    ctx.fillStyle = '#808090';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillText(`Tick ${battleState.tick}`, w - 80, h - 10);

  }, [battleState, selectedLieutenant, lieutenants]);

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
