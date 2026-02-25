# Formations Guide

Formations determine how troops arrange themselves around their lieutenant and provide combat bonuses that affect damage dealt and received.

## Formation Types

### Line
```
  o o o o o o o o
         Lt
```
The default formation. Troops spread horizontally in a row, centered on the lieutenant. Balanced with no combat bonuses or penalties.

| Attack | Defense | Best Use |
|--------|---------|----------|
| 1.0x | 1.0x | General purpose, balanced front |

### Wedge
```
        o
       o o
      o o o
     o o o o
         Lt
```
V-shaped offensive formation pointing toward the enemy. Strong attack bonus but weaker defense — designed to punch through enemy lines.

| Attack | Defense | Best Use |
|--------|---------|----------|
| 1.3x | 0.8x | Breaking through, aggressive charges |

### Defensive Circle
```
      o o o
    o       o
    o  Lt   o
    o       o
      o o o
```
Troops form a protective ring around the lieutenant. Strong defense but weak offense — use when holding against superior numbers.

| Attack | Defense | Best Use |
|--------|---------|----------|
| 0.7x | 1.4x | Holding position, protecting lieutenant |

### Scatter
```
    o     o
        o
      o     o
    o   Lt    o
        o
      o     o
```
Loose grid spread around the lieutenant. Harder to hit but deals less damage. Good for surviving focused attacks and avoiding area effects.

| Attack | Defense | Best Use |
|--------|---------|----------|
| 0.85x | 1.15x | Under heavy fire, need survivability |

### Pincer
```
  o o o           o o o
  o o               o o
         Lt
  o o               o o
  o o o           o o o
```
Troops split into two flanking groups. Built-in flanking bonus with slightly weaker defense.

| Attack | Defense | Best Use |
|--------|---------|----------|
| 1.2x | 0.9x | Enveloping enemy, flanking attacks |

### Column
```
    o
    o
    o
    o
    Lt
    o
    o
    o
```
Single-file line. Terrible in combat but the natural formation for rapid movement through narrow terrain.

| Attack | Defense | Best Use |
|--------|---------|----------|
| 0.6x | 0.7x | Movement only, NEVER fight in column |

## Formation Maintenance

Formations are **actively maintained** during battle:
- Every tick, non-engaged troops update their position to match their formation slot relative to their lieutenant's current position
- When a lieutenant moves, the formation moves with them
- After combat ends, surviving troops naturally re-form
- Formation slots are stable — each troop has a consistent index

## Changing Formations

Lieutenants can change formations via the `setFormation` action:
```ts
{ type: 'setFormation', formation: 'wedge' }
```

When a lieutenant changes formation:
1. All troops under that lieutenant receive the new formation
2. Each troop calculates its new slot position
3. Troops move to their new positions

## Formation + Terrain Combos

The strongest defensive positions combine formation and terrain bonuses:

| Setup | Damage Taken | Notes |
|-------|-------------|-------|
| Circle on Hill | 0.75 * (1/1.4) = 0.54x | Takes about half damage |
| Circle in Forest | 0.80 * (1/1.4) = 0.57x | Half damage + concealment |
| Wedge charging through river | 1.40 * (1/0.8) = 1.75x | Nearly double damage taken |
| Line on open ground | 1.0 * (1/1.0) = 1.0x | Baseline |

## Tactical Tips

1. **Start in line** for balanced approach, switch to **wedge** when charging
2. **Circle up** when surrounded or under heavy pressure
3. **Never fight in column** — switch to any combat formation first
4. **Scatter** when the enemy has concentrated firepower
5. **Pincer** works best with a second group attacking from another angle
6. Consider terrain — a **wedge charge through a river** is suicide
