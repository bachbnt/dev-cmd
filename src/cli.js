// Copyright (c) 2026 bachbnt

const { BRAND, PACKAGE_MANAGERS, VERSION, frameworkDefinitions } = require('./config');
const { loadConfig } = require('./config/user');
const { getCompletion } = require('./commands/completion');
const { handleClone } = require('./handlers/clone');
const { handleMcp } = require('./handlers/mcp');
const { handleDeviceCommand, handleDeviceList } = require('./handlers/devices');
const { handleAgain, handleHistory, rebuildHistoryCommands } = require('./handlers/history');
const { runJson } = require('./handlers/json');
const { handleInspect, handleLifecycle } = require('./handlers/lifecycle');
const { handleDocker, handleEnv } = require('./handlers/tools');
const { handleParallel, handleTask, handleTrust } = require('./handlers/workflow');
const { LIFECYCLE_COMMANDS } = require('./constants');
const { applyConfigDefaults, handleInit, handleScaffold } = require('./handlers/scaffold');
const {
  handleConfig,
  handleDoctor,
  handleInfo,
  handleOpeners,
  handleProjects,
  handleRecipes,
  handleUpdate,
} = require('./handlers/system');
const { describeFailure, executeCommands } = require('./runtime/execute');
const { parseArgs, validateCommandFlags } = require('./utils/args');
const { getRecipeDefinitions, loadRecipeRegistry } = require('./recipes');
const { loadOpenerRegistry } = require('./openers');

function printHelp(pc, definitions = frameworkDefinitions, openerRegistry) {
  console.log(
    `\n${pc.bgCyan(pc.black(` ${BRAND} v${VERSION} `))} ${pc.bold('Development toolkit by bachbnt')}\n`
  );
  console.log(pc.bold('Usage:'));
  console.log('  dev <command> [target] [options]\n');
  console.log(pc.bold('Frameworks:'));
  console.log(`  ${pc.green('init'.padEnd(20))} ${pc.dim('Create a new project interactively')}`);
  for (const [name, definition] of Object.entries(definitions)) {
    console.log(`  ${pc.green(name.padEnd(20))} ${pc.dim(definition.description)}`);
  }
  console.log(`\n${pc.bold('Project Lifecycle:')}`);
  console.log(`  ${pc.magenta('doctor'.padEnd(16))} ${pc.dim('Check development tools')}`);
  console.log(`  ${pc.magenta('inspect'.padEnd(16))} ${pc.dim('Show detected project and lifecycle commands')}`);
  for (const action of LIFECYCLE_COMMANDS) {
    const label = action.charAt(0).toUpperCase() + action.slice(1);
    console.log(`  ${pc.magenta(action.padEnd(16))} ${pc.dim(`${label} the detected project`)}`);
  }
  console.log(`  ${pc.magenta('task'.padEnd(16))} ${pc.dim('List or run project tasks (package.json scripts, .devcmd.json)')}`);
  console.log(`  ${pc.magenta('parallel'.padEnd(16))} ${pc.dim('Run a lifecycle action in several projects at once')}`);
  console.log(`  ${pc.magenta('trust'.padEnd(16))} ${pc.dim('Review and trust the project .devcmd.json profile')}`);
  console.log(`  ${pc.magenta('env'.padEnd(16))} ${pc.dim('Create .env from .env.example, or check for missing variables')}`);
  console.log(`  ${pc.magenta('docker'.padEnd(16))} ${pc.dim('Run Docker Compose: up, down, build, ps, logs, restart')}`);
  console.log(`  ${pc.magenta('projects'.padEnd(16))} ${pc.dim('Show recently used projects')}`);
  console.log(`  ${pc.magenta('recipes'.padEnd(16))} ${pc.dim('List or validate framework recipes')}`);
  console.log(`  ${pc.magenta('openers'.padEnd(16))} ${pc.dim('List or validate project openers')}`);
  console.log(`  ${pc.magenta('config'.padEnd(16))} ${pc.dim('Show or update DevCmd defaults')}`);
  console.log(`  ${pc.magenta('completion'.padEnd(16))} ${pc.dim('Generate bash or zsh completion')}`);
  console.log(`\n${pc.bold('Tools:')}`);
  console.log(`  ${pc.magenta('clone'.padEnd(16))} ${pc.dim('Clone a repository and install dependencies')}`);
  console.log(`  ${pc.magenta('update'.padEnd(16))} ${pc.dim('Update DevCmd to the latest version')}`);
  console.log(`  ${pc.magenta('mcp'.padEnd(16))} ${pc.dim('Start the DevCmd MCP server (stdio transport)')}`);
  console.log(`\n${pc.bold('Openers:')}`);
  for (const opener of openerRegistry?.values() || []) {
    const aliases = opener.aliases?.length ? ` (${opener.aliases.join(', ')})` : '';
    const source = opener.source === 'user' ? ' [user]' : '';
    console.log(
      `  ${pc.cyan(opener.name.padEnd(20))} ${pc.dim(`${opener.description}${aliases}${source}`)}`
    );
  }
  console.log(`\n${pc.bold('Devices:')}`);
  console.log(`  ${pc.blue('devices'.padEnd(16))} ${pc.dim('List Android and iOS devices')}`);
  console.log(`  ${pc.blue('android'.padEnd(16))} ${pc.dim('Boot Android emulator')}`);
  console.log(`  ${pc.blue('ios'.padEnd(16))} ${pc.dim('Boot or manage iOS simulators')}`);
  console.log(`\n${pc.bold('History:')}`);
  console.log(`  ${pc.cyan('history'.padEnd(16))} ${pc.dim('Show recent successful commands [--clear] [--project <path>]')}`);
  console.log(`  ${pc.cyan('again'.padEnd(16))} ${pc.dim('Run a recent command again [n]')}`);
  console.log(`\n${pc.bold('Options:')}`);
  const printOption = (flags, description) => {
    console.log(`  ${flags.padEnd(31)} ${pc.dim(description)}`);
  };
  printOption('--dry-run', 'Print without executing');
  printOption('--typescript, --javascript', 'Select project language');
  printOption(
    PACKAGE_MANAGERS.map((manager) => `--${manager}`).join(', '),
    'Select package manager'
  );
  printOption('--git, --no-git', 'Toggle Git initialization');
  printOption('--eslint, --no-eslint', 'Toggle ESLint where supported');
  printOption('--no-install', 'Scaffold without installing dependencies');
  printOption('--python <executable>', 'Select Python executable');
  printOption('--set <name=value>', 'Set a custom recipe input');
  printOption('--editor <executable>', 'Override editor for dev open');
  printOption('--with <opener>', 'Select an opener for dev open');
  printOption('--list', 'List available openers');
  printOption('--filter <workspace>', 'Target one monorepo workspace (run, test, build, ...)');
  printOption('--fix', 'Apply automatic fixes (lint only)');
  printOption('--json', 'Print machine-readable JSON (inspect, doctor, ...)');
  printOption('--search <text>', 'Filter history by text (history only)');
  printOption('--yes, -y', 'Skip confirmation (trust only)');
  printOption('--cold-boot', 'Cold boot Android emulator');
  printOption('--shutdown-all', 'Shutdown all iOS simulators');
  printOption('--clear', 'Clear history (history only)');
  printOption('--project <path>', 'Filter history by project path (history only)');
  console.log('');
}

const COMMAND_HANDLERS = new Map([
  ['config', handleConfig],
  ['doctor', handleDoctor],
  ['projects', handleProjects],
  ['recipes', handleRecipes],
  ['openers', handleOpeners],
  ['inspect', handleInspect],
  ['info', handleInfo],
  ['history', handleHistory],
  ['again', handleAgain],
  ['init', handleInit],
  ['update', handleUpdate],
  ['clone', handleClone],
  ['mcp', handleMcp],
  ['task', handleTask],
  ['parallel', handleParallel],
  ['trust', handleTrust],
  ['env', handleEnv],
  ['docker', handleDocker],
  ['devices', handleDeviceList],
  ['android', handleDeviceCommand],
  ['ios', handleDeviceCommand],
]);
for (const cmd of LIFECYCLE_COMMANDS) COMMAND_HANDLERS.set(cmd, handleLifecycle);

async function dispatch(context) {
  const { command } = context;
  const definitions = context.frameworkDefinitions || frameworkDefinitions;
  const handler = COMMAND_HANDLERS.get(command);
  if (handler) return handler(context);
  if (definitions[command]) return handleScaffold(context);
  throw new Error(`Unsupported command: ${command}. Run dev help to see available commands.`);
}

async function main(argv) {
  const p = await import('@clack/prompts');
  const pc = (await import('picocolors')).default;
  let parsed;
  let recipeRegistry;
  let definitions;
  let openerRegistry;

  try {
    parsed = parseArgs(argv);
  } catch (error) {
    p.log.error(error.message);
    return 1;
  }

  const { command, options, positionals } = parsed;
  try {
    const validatingRecipe = command === 'recipes' && positionals[0] === 'validate';
    recipeRegistry = loadRecipeRegistry({ includeUser: !validatingRecipe });
    definitions = getRecipeDefinitions(recipeRegistry);
    const validatingOpener = command === 'openers' && positionals[0] === 'validate';
    openerRegistry = loadOpenerRegistry({ includeUser: !validatingOpener });
  } catch (error) {
    p.log.error(error.message);
    return 1;
  }
  if (!command || ['help', '-h', '--help'].includes(command)) {
    printHelp(pc, definitions, openerRegistry);
    return command ? 0 : 1;
  }

  if (command === 'completion') {
    try {
      process.stdout.write(getCompletion(
        positionals[0] || process.env.SHELL?.split('/').pop() || 'zsh',
        definitions,
        openerRegistry
      ));
      return 0;
    } catch (error) {
      p.log.error(error.message);
      return 1;
    }
  }

  try {
    validateCommandFlags(command, options, definitions);
    const config = loadConfig();
    if (options.json) return runJson({ command, options, positionals, config, recipeRegistry, openerRegistry });
    if (command !== 'mcp') p.intro(`${pc.bgCyan(pc.black(` ${BRAND} `))} ${pc.bold(command)}`);
    return await dispatch({
      p,
      pc,
      command,
      options,
      positionals,
      config,
      frameworkDefinitions: definitions,
      recipeRegistry,
      openerRegistry,
    });
  } catch (error) {
    p.log.error(error.message);
    return 1;
  }
}

module.exports = {
  applyConfigDefaults,
  describeFailure,
  dispatch,
  executeCommands,
  handleLifecycle,
  main,
  printHelp,
  rebuildHistoryCommands,
};
