# Terrain System

Terrain features transform the flat battlefield into a tactical landscape where positioning matters. Hills, forests, and rivers each provide distinct advantages and disadvantages.

## Terrain Types

### Hill
Elevated ground that provides a defensive advantage and better visibility.

| Modifier | Value | Effect |
|----------|-------|--------|
| Defense | 0.75x | Takes **25% less damage** |
| Speed | 0.85x | **15% slower** movement |
| Visibility | +20 | **+20 units** vision range |
| Concealment | 1.0x | No concealment change |

**Tactical Use:** Hold hills for a strong defensive position. The visibility bonus lets you spot approaching enemies earlier. The defense bonus makes your troops harder to kill. Worth the slight movement penalty.

### Forest
Dense cover that hides units and provides protection, at the cost of speed.

| Modifier | Value | Effect |
|----------|-------|--------|
| Defense | 0.80x | Takes **20% less damage** |
| Speed | 0.70x | **30% slower** movement |
| Visibility | -10 | **-10 units** vision range |
| Concealment | 0.5x | **50% harder** for enemies to spot |

**Tactical Use:** Use forests for ambushes and flanking. Units in forests are very hard to spot (enemy detection range halved), but they move slowly and have reduced visibility themselves. Send scouts through forests to get behind enemy lines.

### River
Water obstacle that makes crossing units extremely vulnerable.

| Modifier | Value | Effect |
|----------|-------|--------|
| Defense | 1.40x | Takes **40% MORE damage** |
| Speed | 0.45x | **55% slower** movement |
| Visibility | 0 | No change |
| Concealment | 1.0x | No concealment change |

**Tactical Use:** Rivers are kill zones. Never fight in a river if you can help it. Cross quickly and in force. The defender holding the far bank has a massive advantage. Consider flanking through forests to avoid the river crossing entirely.

## Modifier Stacking

When terrain features overlap, their effects stack **multiplicatively** for multipliers and **additively** for bonuses:

| Combo | Defense | Speed | Visibility |
|-------|---------|-------|------------|
| Hill + Forest | 0.60x | 0.60x | +10 |
| Forest + River | 1.12x | 0.32x | -10 |
| Hill + River | 1.05x | 0.38x | +20 |

## Visibility and Concealment

Terrain affects the fog of war in two ways:

1. **Viewer bonus:** Units on hills see further (+20 range)
2. **Target concealment:** Units in forests are harder to spot (enemies need to be 50% closer)

### Effective Detection Range

```
effective_range = (base_radius + viewer_terrain_bonus) * target_concealment
```

Example: A troop (60 base vision) on a hill looking at an enemy in a forest:
```
effective_range = (60 + 20) * 0.5 = 40 units
```

The hill helps, but the forest concealment still makes the enemy hard to see.

## Scenarios with Terrain

### Basic Scenario
Open field — no terrain features. Pure combat test.

### Assault Scenario
Enemy defends a **hilltop position**. Attackers must push uphill against a 25% defense bonus.

### River Crossing Scenario
A **river** runs vertically through the center. Enemy holds a **hill** behind the river. **Forests** on the flanks provide concealed flanking routes.

```
 Forest           River          Hill
 (cover)           |||          (enemy)
                   |||
 Player -->        |||      <-- Enemy
                   |||
 Forest            |||
 (cover)
```

## Terrain Events

Units entering or leaving terrain features fire flowchart events:
- `terrain_entered: { terrainType: 'hill' | 'forest' | 'river', position: Vec2 }` — fires when a unit moves into a terrain feature
- `terrain_exited: { terrainType: 'hill' | 'forest' | 'river', position: Vec2 }` — fires when a unit leaves a terrain feature

These events are tracked per-agent via a `TerrainTracker` and detected every 10 ticks. Lieutenants can program reactions to terrain transitions — for example, switching to defensive_circle when entering a hill, or scatter when crossing a river.

## Implementation Details

Terrain features are axis-aligned rectangles defined by:
- `position: Vec2` — top-left corner
- `size: Vec2` — width and height

Query functions:
- `getTerrainAt(pos, map)` — first terrain feature at position
- `getAllTerrainAt(pos, map)` — all overlapping features
- `getTerrainModifiers(pos, map)` — combined modifiers at position
- `getEffectiveVisibilityRadius(viewer, target, baseRadius, map)` — fog of war calculation
