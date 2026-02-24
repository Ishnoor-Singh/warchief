// Warchief - Phase 1 Test Runner
// Run a battle in the terminal to verify simulation works

import { createSimulation, startSimulation, stopSimulation, getBattleSummary, SimulationState } from './server/sim/simulation.js';
import { createBasicScenario, createAssaultScenario } from './server/sim/scenario.js';

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function renderBattlefield(state: SimulationState): void {
  const { battle } = state;
  const width = 60;
  const height = 20;
  
  // Create grid
  const grid: string[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = '·';
    }
  }
  
  // Place agents
  for (const agent of battle.agents.values()) {
    if (!agent.alive) continue;
    
    // Scale position to grid
    const gridX = Math.floor((agent.position.x / battle.width) * (width - 1));
    const gridY = Math.floor((agent.position.y / battle.height) * (height - 1));
    
    if (gridX >= 0 && gridX < width && gridY >= 0 && gridY < height) {
      const char = agent.team === 'player' ? 'P' : 'E';
      const color = agent.team === 'player' ? colors.blue : colors.red;
      grid[gridY][gridX] = `${color}${char}${colors.reset}`;
    }
  }
  
  // Clear screen and render
  console.clear();
  console.log(`${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}                      WARCHIEF - Battle                        ${colors.reset}`);
  console.log(`${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log();
  
  // Top border
  console.log('┌' + '─'.repeat(width) + '┐');
  
  // Grid
  for (const row of grid) {
    console.log('│' + row.join('') + '│');
  }
  
  // Bottom border
  console.log('└' + '─'.repeat(width) + '┘');
  
  // Stats
  console.log();
  console.log(getBattleSummary(state));
  console.log();
  
  // Legend
  console.log(`${colors.blue}P${colors.reset} = Player troops   ${colors.red}E${colors.reset} = Enemy troops`);
}

async function runBattle(scenarioName: 'basic' | 'assault'): Promise<void> {
  console.log(`\n${colors.cyan}Starting ${scenarioName} scenario...${colors.reset}\n`);
  
  // Create scenario
  const scenario = scenarioName === 'assault' ? createAssaultScenario() : createBasicScenario();
  
  // Create simulation
  const state = createSimulation(scenario.width, scenario.height, scenario.agents, scenario.flowcharts);
  
  // Set up callbacks
  let tickCount = 0;
  state.onTick = (s) => {
    tickCount++;
    if (tickCount % 5 === 0) {  // Render every 5 ticks (2x per second)
      renderBattlefield(s);
    }
  };
  
  state.onBattleEnd = (winner) => {
    console.log();
    console.log(`${colors.bright}════════════════════════════════════════════════════════════${colors.reset}`);
    if (winner === 'player') {
      console.log(`${colors.green}${colors.bright}                    VICTORY! Player wins!                    ${colors.reset}`);
    } else {
      console.log(`${colors.red}${colors.bright}                    DEFEAT! Enemy wins!                      ${colors.reset}`);
    }
    console.log(`${colors.bright}════════════════════════════════════════════════════════════${colors.reset}`);
    console.log();
    console.log(`Battle lasted ${state.battle.tick} ticks (${(state.battle.tick / 10).toFixed(1)} seconds)`);
    console.log();
  };
  
  // Start simulation
  const timer = startSimulation(state);
  
  // Wait for battle to end (max 60 seconds)
  const maxTicks = 600;
  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      if (!state.battle.running || state.battle.tick >= maxTicks) {
        clearInterval(checkInterval);
        stopSimulation(state, timer);
        
        if (state.battle.tick >= maxTicks && state.battle.running) {
          console.log(`\n${colors.yellow}Battle timed out after 60 seconds${colors.reset}`);
        }
        
        resolve();
      }
    }, 100);
  });
  
  // Final render
  renderBattlefield(state);
}

// Main
const scenario = (process.argv[2] as 'basic' | 'assault') || 'basic';

console.log(`${colors.bright}╔═══════════════════════════════════════════════════════════════╗${colors.reset}`);
console.log(`${colors.bright}║                                                               ║${colors.reset}`);
console.log(`${colors.bright}║   ${colors.cyan}W A R C H I E F${colors.reset}${colors.bright}                                            ║${colors.reset}`);
console.log(`${colors.bright}║   ${colors.dim}Phase 1 - Simulation Core${colors.reset}${colors.bright}                               ║${colors.reset}`);
console.log(`${colors.bright}║                                                               ║${colors.reset}`);
console.log(`${colors.bright}╚═══════════════════════════════════════════════════════════════╝${colors.reset}`);

runBattle(scenario).then(() => {
  console.log(`${colors.dim}Simulation complete.${colors.reset}`);
  process.exit(0);
});
