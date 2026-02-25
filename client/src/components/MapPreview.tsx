import type { TroopInfo, Lieutenant } from '../types';

// Colors matching personality classes
const LT_COLORS: Record<string, string> = {
  aggressive: '#ff6b6b',
  cautious:   '#6bff6b',
  disciplined: '#6b6bff',
  impulsive:  '#ffff6b',
};
const LT_COLORS_DIM: Record<string, string> = {
  aggressive: 'rgba(255,107,107,0.15)',
  cautious:   'rgba(107,255,107,0.15)',
  disciplined: 'rgba(107,107,255,0.15)',
  impulsive:  'rgba(255,255,107,0.15)',
};

interface Props {
  mapWidth: number;
  mapHeight: number;
  troopInfo: Record<string, TroopInfo[]>;
  lieutenants: Lieutenant[];
}

// Scale a map coordinate into SVG space
function scaleX(x: number, mapW: number, svgW: number) {
  return 32 + (x / mapW) * (svgW - 64);
}
function scaleY(y: number, mapH: number, svgH: number) {
  return 20 + (y / mapH) * (svgH - 40);
}

export function MapPreview({ mapWidth, mapHeight, troopInfo, lieutenants }: Props) {
  const SVG_W = 340;
  const SVG_H = Math.round(SVG_W * (mapHeight / mapWidth));

  // Build per-lieutenant squad clusters
  type SquadCluster = {
    squadId: string;
    ltId: string;
    ltName: string;
    personality: string;
    cx: number;
    cy: number;
    count: number;
  };

  const clusters: SquadCluster[] = [];

  for (const lt of lieutenants) {
    const troops = troopInfo[lt.id] ?? [];
    // Group by squad
    const squads = new Map<string, TroopInfo[]>();
    for (const t of troops) {
      const arr = squads.get(t.squadId) ?? [];
      arr.push(t);
      squads.set(t.squadId, arr);
    }
    for (const [squadId, members] of squads.entries()) {
      const avgX = members.reduce((s, t) => s + t.position.x, 0) / members.length;
      const avgY = members.reduce((s, t) => s + t.position.y, 0) / members.length;
      clusters.push({
        squadId,
        ltId: lt.id,
        ltName: lt.name,
        personality: lt.personality,
        cx: scaleX(avgX, mapWidth, SVG_W),
        cy: scaleY(avgY, mapHeight, SVG_H),
        count: members.length,
      });
    }
  }

  // Enemy zone: right side of map (x > 60% of width)
  const enemyZoneX = scaleX(mapWidth * 0.6, mapWidth, SVG_W);
  const enemyZoneW = SVG_W - 32 - enemyZoneX;

  return (
    <div className="map-preview">
      <div className="map-preview-title">Battlefield Layout</div>
      <svg
        width={SVG_W}
        height={SVG_H}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="map-preview-svg"
      >
        {/* Background */}
        <rect x={32} y={20} width={SVG_W - 64} height={SVG_H - 40} fill="#0d1117" rx={4} />

        {/* Enemy zone (right ~40%) */}
        <rect
          x={enemyZoneX}
          y={20}
          width={enemyZoneW}
          height={SVG_H - 40}
          fill="rgba(255,74,74,0.07)"
          rx={2}
        />
        <text
          x={enemyZoneX + enemyZoneW / 2}
          y={32}
          textAnchor="middle"
          fontSize={8}
          fill="rgba(255,74,74,0.4)"
          fontFamily="JetBrains Mono, monospace"
          letterSpacing={1}
        >
          ENEMY SIDE
        </text>

        {/* Player zone (left ~60%) */}
        <text
          x={32 + (enemyZoneX - 32) / 2}
          y={32}
          textAnchor="middle"
          fontSize={8}
          fill="rgba(74,158,255,0.45)"
          fontFamily="JetBrains Mono, monospace"
          letterSpacing={1}
        >
          YOUR SIDE
        </text>

        {/* Center dividing line */}
        <line
          x1={scaleX(mapWidth / 2, mapWidth, SVG_W)}
          y1={24}
          x2={scaleX(mapWidth / 2, mapWidth, SVG_W)}
          y2={SVG_H - 24}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />

        {/* Lieutenant zone halos */}
        {clusters.map(c => (
          <circle
            key={`halo-${c.squadId}`}
            cx={c.cx}
            cy={c.cy}
            r={18}
            fill={LT_COLORS_DIM[c.personality] ?? 'rgba(255,255,255,0.08)'}
          />
        ))}

        {/* Squad dots */}
        {clusters.map(c => (
          <g key={c.squadId}>
            <circle
              cx={c.cx}
              cy={c.cy}
              r={7}
              fill={LT_COLORS[c.personality] ?? '#888'}
              opacity={0.85}
            />
            {/* Squad label */}
            <text
              x={c.cx}
              y={c.cy + 16}
              textAnchor="middle"
              fontSize={7}
              fill={LT_COLORS[c.personality] ?? '#888'}
              fontFamily="JetBrains Mono, monospace"
              opacity={0.85}
            >
              {c.squadId}
            </text>
            {/* Troop count */}
            <text
              x={c.cx}
              y={c.cy + 3}
              textAnchor="middle"
              fontSize={6}
              fill="#000"
              fontWeight="bold"
              fontFamily="JetBrains Mono, monospace"
            >
              {c.count}
            </text>
          </g>
        ))}

        {/* Compass: cardinal labels on edges */}
        {/* NORTH (top) */}
        <text x={SVG_W / 2} y={14} textAnchor="middle" fontSize={8} fill="#555" fontFamily="JetBrains Mono, monospace">N</text>
        {/* SOUTH (bottom) */}
        <text x={SVG_W / 2} y={SVG_H - 4} textAnchor="middle" fontSize={8} fill="#555" fontFamily="JetBrains Mono, monospace">S</text>
        {/* WEST (left) */}
        <text x={6} y={SVG_H / 2 + 3} textAnchor="middle" fontSize={8} fill="#555" fontFamily="JetBrains Mono, monospace">W</text>
        {/* EAST (right) */}
        <text x={SVG_W - 6} y={SVG_H / 2 + 3} textAnchor="middle" fontSize={8} fill="#555" fontFamily="JetBrains Mono, monospace">E</text>

        {/* Map border */}
        <rect x={32} y={20} width={SVG_W - 64} height={SVG_H - 40} fill="none" stroke="#2a2a3a" strokeWidth={1} rx={4} />
      </svg>

      {/* Legend */}
      <div className="map-preview-legend">
        {lieutenants.map(lt => (
          <div key={lt.id} className="map-legend-item">
            <span className="map-legend-dot" style={{ background: LT_COLORS[lt.personality] ?? '#888' }} />
            <span className="map-legend-name">{lt.name}</span>
            <span className="map-legend-personality" style={{ color: LT_COLORS[lt.personality] ?? '#888' }}>
              {lt.personality}
            </span>
          </div>
        ))}
        <div className="map-legend-item">
          <span className="map-legend-dot enemy-dot" />
          <span className="map-legend-name" style={{ color: 'rgba(255,74,74,0.6)' }}>Enemy zone</span>
        </div>
      </div>
    </div>
  );
}
