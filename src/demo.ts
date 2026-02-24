// Phase 2 Demo: Lieutenant receives order, interprets it, compiles flowcharts
// Run with: npm run demo

import { createLieutenant, processOrder, LieutenantConfig } from './server/agents/lieutenant.js';
import { compileDirectives } from './server/agents/compiler.js';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

async function demo() {
  console.log(`\n${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}                    WARCHIEF - Phase 2 Demo                  ${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}\n`);

  // Create lieutenant
  const config: LieutenantConfig = {
    id: 'lt_adaeze',
    name: 'Lt. Adaeze',
    personality: 'aggressive',
    stats: { initiative: 8, discipline: 5, communication: 7 },
    troopIds: ['squad_1_0', 'squad_1_1', 'squad_1_2', 'squad_1_3', 'squad_1_4'],
    authorizedPeers: ['lt_chen'],
  };

  const lt = createLieutenant(config);

  console.log(`${colors.bright}Lieutenant:${colors.reset} ${lt.name} (${lt.personality})`);
  console.log(`${colors.dim}Initiative: ${lt.stats.initiative}/10 | Discipline: ${lt.stats.discipline}/10 | Communication: ${lt.stats.communication}/10${colors.reset}`);
  console.log(`${colors.dim}Commanding: ${lt.troopIds.join(', ')}${colors.reset}\n`);

  // Context
  const context = {
    currentOrders: '',
    visibleUnits: [
      { id: 'squad_1_0', position: { x: 50, y: 100 }, health: 100, morale: 95 },
      { id: 'squad_1_1', position: { x: 65, y: 100 }, health: 100, morale: 90 },
      { id: 'squad_1_2', position: { x: 80, y: 100 }, health: 85, morale: 85 },
      { id: 'squad_1_3', position: { x: 95, y: 100 }, health: 100, morale: 88 },
      { id: 'squad_1_4', position: { x: 110, y: 100 }, health: 75, morale: 80 },
    ],
    terrain: 'Open field with a ridge at x=200. Enemy positions spotted near x=300.',
  };

  // Order from commander
  const order = "Take the ridge at x=200. Hold it until I give further orders. If you take heavy casualties, fall back to the treeline at x=50.";

  console.log(`${colors.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}${colors.yellow}COMMANDER:${colors.reset} ${order}`);
  console.log(`${colors.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  console.log(`${colors.dim}Sending to Claude...${colors.reset}\n`);

  // Process order
  const startTime = Date.now();
  const result = await processOrder(lt, order, context);
  const elapsed = Date.now() - startTime;

  if (!result.success) {
    console.log(`${colors.red}Error: ${result.error}${colors.reset}`);
    return;
  }

  // Show lieutenant response
  console.log(`${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}${colors.green}${lt.name.toUpperCase()}:${colors.reset} ${result.output?.message_up || '(no message)'}`);
  console.log(`${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  console.log(`${colors.dim}Response received in ${elapsed}ms${colors.reset}\n`);

  // Show directives
  console.log(`${colors.bright}${colors.magenta}Directives issued:${colors.reset}`);
  for (const directive of result.output?.directives || []) {
    console.log(`\n  ${colors.cyan}Unit: ${directive.unit}${colors.reset}`);
    for (const node of directive.nodes) {
      const condStr = node.condition ? ` [if ${node.condition}]` : '';
      const prioStr = node.priority ? ` (priority: ${node.priority})` : '';
      console.log(`    ${colors.dim}•${colors.reset} on ${colors.yellow}${node.on}${colors.reset}${condStr} → ${colors.green}${node.action.type}${colors.reset}${prioStr}`);
      
      if (node.action.type === 'moveTo' || node.action.type === 'fallback') {
        const pos = (node.action as { position: { x: number; y: number } }).position;
        console.log(`      ${colors.dim}position: (${pos.x}, ${pos.y})${colors.reset}`);
      }
    }
  }

  // Compile flowcharts
  console.log(`\n${colors.bright}${colors.magenta}Compiling flowcharts...${colors.reset}`);
  const compiled = compileDirectives(result.output!, lt.troopIds);

  if (compiled.errors.length > 0) {
    console.log(`${colors.red}Compile errors: ${compiled.errors.join(', ')}${colors.reset}`);
  }

  console.log(`${colors.green}✓ Compiled ${Object.keys(compiled.flowcharts).length} flowcharts for troops${colors.reset}`);

  // Show sample flowchart
  const sampleId = lt.troopIds[0]!;
  const sample = compiled.flowcharts[sampleId];
  if (sample) {
    console.log(`\n${colors.dim}Sample flowchart for ${sampleId}:${colors.reset}`);
    console.log(`${colors.dim}  Nodes: ${sample.nodes.length}${colors.reset}`);
    console.log(`${colors.dim}  Default action: ${sample.defaultAction.type}${colors.reset}`);
  }

  console.log(`\n${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}                         Demo Complete                       ${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}════════════════════════════════════════════════════════════${colors.reset}\n`);
}

demo().catch(console.error);
