# Morale and Routing

Morale is the psychological state of a unit. It determines whether troops hold the line or break and flee. This system transforms battles from predictable HP races into dynamic, momentum-driven engagements.

## Morale Basics

- Every unit starts with **100 morale** (max)
- Morale is a value from **0 to 100**
- Morale drops when bad things happen (allies die, getting flanked, routing panic)
- Morale recovers slowly when **not in combat**

## What Reduces Morale

| Event | Morale Loss | Range |
|-------|------------|-------|
| Nearby ally dies | -5 | Within 50 units |
| Nearby ally routs (panic) | -8 | Within 40 units |

Morale losses can chain: one routing unit panics its neighbors, who may then rout themselves, panicking more neighbors. This cascade effect can cause an entire flank to collapse.

## The Routing Check

Every simulation tick, each troop with morale below the **ROUT_MORALE_THRESHOLD (40)** has a chance of routing:

```
rout_chance = (1 - morale/40) * (1 - courage/12)
```

### Courage's Role

The **courage stat** (1-10) determines how resistant a unit is to routing:

| Courage | Rout Chance at Morale 0 | Rout Chance at Morale 20 |
|---------|------------------------|--------------------------|
| 1 | ~92% | ~46% |
| 3 | ~75% | ~38% |
| 5 | ~58% | ~29% |
| 7 | ~42% | ~21% |
| 10 | ~17% | ~8% |

Even at morale 0, a courage-10 unit still has a ~17% chance of routing per tick. Courage can delay routing but can't prevent it indefinitely at zero morale.

### Above Threshold

If morale is **40 or above**, routing is **impossible**. No random check occurs.

## What Happens When a Unit Routs

1. The unit's `currentAction` is set to `'routing'`
2. Flowchart logic is **overridden** — the unit ignores all flowchart commands
3. The unit **flees toward its spawn side** (player units flee west, enemy units flee east)
4. A `retreat` battle event is emitted for the UI ticker
5. **Routing panic** hits nearby same-team units within 40 units (-8 morale each)

## Routing Recovery

A routing unit can recover if its morale rises back above **50**:
- Its `currentAction` returns to `'holding'`
- It resumes responding to flowchart logic
- It will re-form with its formation

## Morale Recovery

Units that are **not in combat** recover morale at **0.5 per tick** (5 per second):

- It takes **20 seconds** to recover from morale 0 to morale 100
- Recovery stops immediately if the unit enters combat
- Routing units also recover if they flee far enough from combat

## Tactical Implications

### For the Player

- **Protect your flanks.** Side/rear attacks deal more damage and the casualties cause morale cascades.
- **Use high-courage units** (guardians, vanguard) as your front line. They hold longer.
- **Berserkers are glass cannons.** High combat, low courage. They'll deal massive damage then break.
- **Militia break easily.** Use them as reserves, not as your main force.
- **Rally broken units.** If you can disengage routing troops, they'll recover morale and return to fight.

### For Lieutenants

Lieutenants can program responses to morale events:
- `casualty_threshold` event fires at 25/50/75% squad losses
- `ally_down` event fires when nearby allies die
- `flanked` event fires when attacked from the side or rear
- `morale_low` event fires when average squad morale drops below **40**, reporting `averageMorale` and `lowestMorale` — lets lieutenants trigger defensive behaviors, retreats, or formation changes before a cascade
- `enemy_retreating` event fires when a visible enemy is routing, reporting `enemyId`, `position`, and `distance` — lets lieutenants opportunistically pursue or reposition

Smart lieutenant briefings should include fallback plans for when morale collapses.

## Unit Presets and Courage

| Preset | Courage | Routing Resistance |
|--------|---------|-------------------|
| Berserker | 3 | Very Low |
| Militia | 3 | Very Low |
| Scout | 4 | Low |
| Archer | 4 | Low |
| Infantry | 5 | Medium |
| Vanguard | 7 | High |
| Guardian | 9 | Very High |
