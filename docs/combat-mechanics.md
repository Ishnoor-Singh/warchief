# Combat Mechanics

This document describes all combat systems in Warchief. Every number here is authoritative — if the code disagrees with this doc, the doc is wrong and should be updated.

## Base Combat

Combat happens when two opposing units are within **COMBAT_RANGE (25 world units)** of each other. Both combatants deal damage simultaneously each tick (10 ticks/second).

### Damage Formula

```
base_damage = BASE_DAMAGE (10) * (attacker_combat / defender_combat) * (1 +/- 20% variance)
```

- `BASE_DAMAGE`: 10 HP per tick
- `attacker_combat` / `defender_combat`: stat ratio (1-10 each)
- Random variance: +/- 20% (controlled by RNG)
- Minimum damage: always at least 1 HP

### Example

A combat-8 attacker vs combat-4 defender:
```
10 * (8/4) * 1.0 = 20 damage per tick
```

At 10 ticks/sec, that's 200 DPS against a 100 HP unit = dead in 0.5 seconds.

---

## Formation Combat Modifiers

Each formation type provides attack and defense multipliers that change the effectiveness of units in combat. These are **multiplicative** on top of the base damage formula.

| Formation | Attack Mult. | Defense Mult. | Best For |
|-----------|-------------|---------------|----------|
| `line` | 1.0x | 1.0x | Balanced front |
| `wedge` | 1.3x | 0.8x | Breaking through enemy lines |
| `defensive_circle` | 0.7x | 1.4x | Holding against superior numbers |
| `scatter` | 0.85x | 1.15x | Surviving focused attacks |
| `pincer` | 1.2x | 0.9x | Flanking and enveloping |
| `column` | 0.6x | 0.7x | March movement only (terrible in combat) |

### How They Apply

When unit A (in formation FA) attacks unit B (in formation FB):

```
modified_damage = base_damage * FA.attackMultiplier / FB.defenseMultiplier
```

So a wedge attacker (1.3x) vs a line defender (1.0x):
```
damage = base * 1.3 / 1.0 = base * 1.3
```

A wedge attacker (1.3x) vs a defensive_circle defender (1.4x):
```
damage = base * 1.3 / 1.4 = base * 0.93
```

The circle's defense nearly cancels the wedge's attack bonus.

---

## Flanking

Attacks from the side or rear deal bonus damage. The game detects flanking based on the **angle between the defender's facing direction and the attacker's position**.

### Flanking Zones

Using the dot product of the defender's facing vector and the attacker direction vector:

- **Front** (cos > 0.5, within ~60 degrees): **1.0x** damage (no bonus)
- **Side** (cos between -0.5 and 0.5, 60-120 degrees): **1.3x** damage
- **Rear** (cos < -0.5, beyond 120 degrees): **1.6x** damage

### Facing Direction

- Player units face **east** (positive X direction)
- Enemy units face **west** (negative X direction)

This means:
- Attacking the enemy from the west is a **frontal** attack
- Attacking from north or south is a **side** attack
- Getting behind the enemy (attacking from the east) is a **rear** attack

### Flanked Events

When a unit is flanked (side or rear attack), the `flanked` event fires on that unit's flowchart runtime. Lieutenants can program responses to flanking:

```ts
{ type: 'flanked', direction: 'left' | 'right' | 'rear' }
```

---

## Charge Momentum

Units that are **moving when they first enter combat** deal bonus damage on their first hit. This rewards aggressive movement and punishes static play.

### Charge Formula

```
charge_bonus = min(base_damage * 1.0, base_damage * speed * 0.15)
```

- Only applies on the **first combat tick** of a new engagement
- Scales with the unit's **speed stat** (higher speed = bigger charge)
- Capped at **100% of base damage** (so max is doubling the first hit)
- One-time per engagement — resets when combat ends

### Example

A speed-4 berserker charging into combat:
```
charge_bonus = min(10 * 1.0, 10 * 4 * 0.15) = min(10, 6) = 6 extra damage
First hit: 10 + 6 = 16 damage (60% bonus)
```

A speed-1.5 guardian trying to charge:
```
charge_bonus = min(10, 10 * 1.5 * 0.15) = min(10, 2.25) = 2 extra damage
First hit: 10 + 2 = 12 damage (20% bonus)
```

---

## Terrain Effects on Combat

Terrain features modify incoming damage via a **defense multiplier**:

| Terrain | Defense Multiplier | Effect |
|---------|-------------------|--------|
| Hill | 0.75x | Takes 25% less damage |
| Forest | 0.80x | Takes 20% less damage |
| River | 1.40x | Takes 40% MORE damage |
| Open ground | 1.0x | No modifier |

These apply to the **defender's position**. If you're standing on a hill, you take 25% less damage from all attacks. If you're wading through a river, you take 40% more damage.

### Stacking

When terrain features overlap, their modifiers stack **multiplicatively**:
- On a forested hill: `0.75 * 0.80 = 0.60` (40% less damage taken)
- In a river at a forest edge: `1.40 * 0.80 = 1.12` (12% more damage)

---

## Damage Application Order

All modifiers are applied in this order:

1. **Base damage** (stat ratio + variance)
2. **Formation attack/defense multipliers**
3. **Flanking multiplier** (on the defender)
4. **Terrain defense multiplier** (on the defender)
5. **Charge bonus** (additive, first hit only)
6. **Minimum damage** floor (always at least 1)

---

## Death and Aftermath

When a unit reaches 0 HP:
- `alive` is set to `false`
- Nearby allies (within 50 units) lose **5 morale**
- `ally_down` event fires for affected allies
- Squad casualty percentage is updated
- Casualty threshold events fire at **25%, 50%, 75%** squad losses
- Kill battle event is emitted for the UI ticker

## Win Condition

The battle ends when either team drops below **20%** troop strength (alive troops / total troops). Lieutenants don't count toward strength totals.
