# Unit Stats Guide

Every unit in Warchief has stats that determine how it fights, moves, and breaks. Understanding these stats is key to effective tactical decision-making.

## Troop Stats

### Combat (1-10)
Attack and defense effectiveness. Determines how much damage a unit deals and how well it withstands attacks.

- **Damage dealt** scales linearly: combat 8 vs combat 4 = 2x damage
- **Damage taken** scales inversely: combat 4 vs combat 8 = 0.5x damage dealt to the attacker
- Default: 5

### Speed
Movement rate in world units per tick.

- Affects movement speed on the battlefield
- Affects **charge bonus** damage (faster = harder charge)
- Modified by terrain (forests slow you down, rivers nearly stop you)
- Default: 2.0

### Courage (1-10)
Threshold before breaking formation under fire.

- Determines resistance to **routing** when morale drops
- High courage = holds the line longer under pressure
- Does NOT prevent routing at morale 0, just makes it less likely
- Default: 5

### Discipline (1-10)
How precisely the unit follows flowchart logic.

- Currently affects how reliably troops execute orders
- Higher discipline = more predictable, reliable execution
- Default: 5

## Lieutenant Stats

### Initiative (1-10)
Likelihood of acting without explicit orders.

- High initiative: Lieutenants will make tactical decisions on their own
- Low initiative: Waits for player orders before acting
- Affects LLM prompt — shapes how proactive the lieutenant is

### Discipline (1-10)
How literally they interpret orders.

- High discipline: Follows orders precisely, minimal interpretation
- Low discipline: Takes creative liberties with orders
- Affects LLM prompt — shapes response fidelity

### Communication (1-10)
Quality and frequency of reports upward.

- High communication: Detailed, frequent status reports
- Low communication: Sparse, sometimes unclear reports
- Affects LLM prompt — shapes reporting behavior

### Personality
One of four types that shape all tactical decision-making:

| Personality | Style | Strengths | Weaknesses |
|-------------|-------|-----------|------------|
| **Aggressive** | Bold, attack-oriented | Fast decisive action | Accepts too many casualties |
| **Cautious** | Conservative, calculated | Preserves forces | May miss opportunities |
| **Disciplined** | By-the-book, precise | Reliable execution | Predictable, slow to adapt |
| **Impulsive** | Quick instinct, reactive | Rapid adaptation | Poor communication, erratic |

## Unit Presets

Pre-configured troop archetypes with balanced stat tradeoffs:

| Preset | Combat | Speed | Courage | Discipline | Role |
|--------|--------|-------|---------|------------|------|
| **Infantry** | 5 | 2.0 | 5 | 5 | Balanced all-rounder |
| **Scout** | 3 | 4.0 | 4 | 4 | Fast reconnaissance |
| **Vanguard** | 8 | 1.5 | 7 | 6 | Heavy front-line fighter |
| **Archer** | 4 | 2.0 | 4 | 8 | Disciplined ranged support |
| **Berserker** | 9 | 3.0 | 3 | 2 | Devastating but fragile |
| **Guardian** | 6 | 1.5 | 9 | 8 | Immovable defensive anchor |
| **Militia** | 3 | 2.0 | 3 | 3 | Cheap expendable units |

## Lieutenant Presets

| Preset | Initiative | Discipline | Communication | Personality |
|--------|-----------|------------|---------------|-------------|
| **Aggressive** | 8 | 4 | 5 | aggressive |
| **Cautious** | 3 | 7 | 8 | cautious |
| **Disciplined** | 5 | 9 | 6 | disciplined |
| **Impulsive** | 9 | 3 | 3 | impulsive |

## Health and Morale

All units start with:
- **100 HP** (max health)
- **100 Morale** (max morale)

### Health
- Reduced by combat damage
- Unit dies at 0 HP
- No natural recovery (damage is permanent)

### Morale
- Reduced by ally deaths (-5), routing panic (-8)
- Can trigger routing when below threshold (40)
- Recovers at 0.5/tick when not in combat
- Full recovery from 0 to 100 takes ~200 ticks (20 seconds)

## Visibility

| Unit Type | Visibility Radius |
|-----------|------------------|
| Troop | 60 units |
| Lieutenant | 150 units |

Visibility is modified by terrain:
- Hills: +20 bonus
- Forests: -10 penalty (but also gives concealment)
