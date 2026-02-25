import { useRef, useEffect } from 'react';
import type { BattleState, VisibilityZone, Lieutenant } from '../types';

interface Props {
  battleState: BattleState;
  prevBattleState: BattleState;
  selectedLieutenant: string | null;
  lieutenants: Lieutenant[];
}

const SCALE = 2;

// Distinct color palettes per lieutenant (for player side)
const LIEUTENANT_COLORS: string[] = [
  '#4a9eff', // blue (Alpha)
  '#6bff6b', // green (Bravo)
  '#c06bff', // purple (Charlie)
  '#ffaa4a', // orange (fallback)
];

const LIEUTENANT_TROOP_COLORS: string[] = [
  '#3a7ecc', // dimmer blue
  '#4ecc4e', // dimmer green
  '#9a4ecc', // dimmer purple
  '#cc8a3a', // dimmer orange
];

const ENEMY_COLOR = '#ff4a4a';
const ENEMY_DIM_COLOR = '#cc3a3a';
const COMBAT_RANGE = 25;

// VFX state stored outside React to avoid re-renders
interface VFXEffect {
  type: 'death' | 'hit' | 'combat_flash';
  x: number;
  y: number;
  startTime: number;
  duration: number;
  team: string;
}

const vfxEffects: VFXEffect[] = [];

export function BattlefieldCanvas({ battleState, prevBattleState, selectedLieutenant, lieutenants }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  // Detect new deaths and combat hits by diffing state
  useEffect(() => {
    const now = Date.now();
    const prevAgentMap = new Map(prevBattleState.agents.map(a => [a.id, a]));

    for (const agent of battleState.agents) {
      const prev = prevAgentMap.get(agent.id);
      if (!prev) continue;

      // Death effect
      if (prev.alive && !agent.alive) {
        vfxEffects.push({
          type: 'death',
          x: agent.position.x * SCALE,
          y: agent.position.y * SCALE,
          startTime: now,
          duration: 1200,
          team: agent.team,
        });
      }

      // Hit flash (health dropped)
      if (agent.alive && prev.health > agent.health) {
        vfxEffects.push({
          type: 'hit',
          x: agent.position.x * SCALE,
          y: agent.position.y * SCALE,
          startTime: now,
          duration: 300,
          team: agent.team,
        });
      }
    }

    // Cap VFX list size
    if (vfxEffects.length > 200) {
      vfxEffects.splice(0, vfxEffects.length - 100);
    }
  }, [battleState, prevBattleState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function draw() {
      if (!ctx || !canvas) return;

      const w = canvas.width;
      const h = canvas.height;
      const now = Date.now();

      // Build lieutenant index -> color mapping
      const ltColorMap = new Map<string, { lt: string; troop: string }>();
      lieutenants.forEach((lt, i) => {
        ltColorMap.set(lt.id, {
          lt: LIEUTENANT_COLORS[i] || LIEUTENANT_COLORS[LIEUTENANT_COLORS.length - 1]!,
          troop: LIEUTENANT_TROOP_COLORS[i] || LIEUTENANT_TROOP_COLORS[LIEUTENANT_TROOP_COLORS.length - 1]!,
        });
      });

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

      // Draw combat engagement lines between fighting units
      const aliveAgents = battleState.agents.filter(a => a.alive);
      for (let i = 0; i < aliveAgents.length; i++) {
        for (let j = i + 1; j < aliveAgents.length; j++) {
          const a = aliveAgents[i]!;
          const b = aliveAgents[j]!;
          if (a.team === b.team) continue;

          const dx = a.position.x - b.position.x;
          const dy = a.position.y - b.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= COMBAT_RANGE) {
            const ax = a.position.x * SCALE;
            const ay = a.position.y * SCALE;
            const bx = b.position.x * SCALE;
            const by = b.position.y * SCALE;

            // Pulsing red line between combatants
            const pulse = 0.3 + Math.sin(now / 150) * 0.15;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = '#ff4a4a';
            ctx.globalAlpha = pulse;
            ctx.lineWidth = 1.5;
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

        let baseColor: string;
        if (!isPlayer) {
          baseColor = isLt ? ENEMY_COLOR : ENEMY_DIM_COLOR;
        } else if (isLt) {
          baseColor = ltColorMap.get(agent.id)?.lt || '#4a9eff';
        } else {
          baseColor = ltColorMap.get(agent.lieutenantId || '')?.troop || '#3a7ecc';
        }

        const isSelectedGroup = !selectedLieutenant
          || agent.id === selectedLieutenant
          || agent.lieutenantId === selectedLieutenant;

        const healthRatio = agent.health / agent.maxHealth;
        const selectionDim = isSelectedGroup ? 1.0 : 0.35;
        ctx.globalAlpha = (0.3 + (healthRatio * 0.7)) * selectionDim;

        // Formation indicator
        drawFormationIndicator(ctx, x, y, agent.formation, baseColor, radius);

        // Lieutenant: draw diamond shape
        if (isLt) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(x, y - radius);
          ctx.lineTo(x + radius, y);
          ctx.lineTo(x, y + radius);
          ctx.lineTo(x - radius, y);
          ctx.closePath();
          ctx.fillStyle = baseColor;
          ctx.fill();
        } else {
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

      // Draw VFX effects
      for (let i = vfxEffects.length - 1; i >= 0; i--) {
        const fx = vfxEffects[i]!;
        const elapsed = now - fx.startTime;
        if (elapsed > fx.duration) {
          vfxEffects.splice(i, 1);
          continue;
        }

        const progress = elapsed / fx.duration;

        if (fx.type === 'death') {
          // Expanding ring + fade
          const ringRadius = 8 + progress * 20;
          const alpha = (1 - progress) * 0.7;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = fx.team === 'player' ? '#4a9eff' : '#ff4a4a';
          ctx.lineWidth = 2 * (1 - progress);
          ctx.globalAlpha = alpha;
          ctx.stroke();

          // X mark at death location
          if (progress < 0.8) {
            const xAlpha = (1 - progress / 0.8) * 0.5;
            ctx.globalAlpha = xAlpha;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            const s = 4;
            ctx.beginPath();
            ctx.moveTo(fx.x - s, fx.y - s);
            ctx.lineTo(fx.x + s, fx.y + s);
            ctx.moveTo(fx.x + s, fx.y - s);
            ctx.lineTo(fx.x - s, fx.y + s);
            ctx.stroke();
          }

          ctx.globalAlpha = 1;
        } else if (fx.type === 'hit') {
          // Quick white flash
          const alpha = (1 - progress) * 0.8;
          const flashRadius = 6 + progress * 4;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, flashRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = alpha;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // Legend
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'start';

      let legendY = h - 10;
      ctx.fillStyle = ENEMY_COLOR;
      ctx.fillText('\u25CF Enemy', 10, legendY);
      legendY -= 18;

      for (let i = lieutenants.length - 1; i >= 0; i--) {
        const lt = lieutenants[i]!;
        const color = LIEUTENANT_COLORS[i] || LIEUTENANT_COLORS[LIEUTENANT_COLORS.length - 1]!;
        ctx.fillStyle = color;
        ctx.fillText(`\u25C6 ${lt.name}`, 10, legendY);
        legendY -= 18;
      }

      ctx.fillStyle = '#808090';
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillText(`Tick ${battleState.tick}`, w - 80, h - 10);

      // Continue animation loop for VFX
      if (vfxEffects.length > 0 || battleState.running) {
        animFrameRef.current = requestAnimationFrame(draw);
      }
    }

    // Cancel previous frame and start new
    cancelAnimationFrame(animFrameRef.current);
    draw();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
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
