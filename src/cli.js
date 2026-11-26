// Copyright (c) 2026 bachbnt

const { BRAND, frameworkDefinitions } = require('./config');
const { loadConfig } = require('./config/user');
const { getCompletion } = require('./commands/completion');
const { getCommand } = require('./cli/commands');
const { printHelp } = require('./cli/help');
const { parseArgs, validateCommandFlags } = require('./utils/args');
const { getRecipeDefinitions, loadRecipeRegistry } = require('./recipes');
const { loadOpenerRegistry } = require('./openers');

// Handler modules load on first use, so a command only pays for the code it runs.
async function dispatch(context) {
  const { command } = context;
  const definitions = context.frameworkDefinitions || frameworkDefinitions;
  const entry = getCommand(command);
  if (entry?.handler) return entry.handler()(context);
  if (definitions[command]) return require('./handlers/scaffold').handleScaffold(context);
  throw new Error(`Unsupported command: ${command}. Run dev help to see available commands.`);
}

// The prompt library is only needed for interactive output, not for help, completion, or --json.
const loadPrompts = () => import('@clack/prompts');

async function main(argv) {
  const pc = (await import('picocolors')).default;
  let parsed;
  let recipeRegistry;
  let definitions;
  let openerRegistry;

  try {
    parsed = parseArgs(argv);
  } catch (error) {
    (await loadPrompts()).log.error(error.message);
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
    (await loadPrompts()).log.error(error.message);
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
      (await loadPrompts()).log.error(error.message);
      return 1;
    }
  }

  try {
    validateCommandFlags(command, options, definitions);
    const config = loadConfig();
    if (options.json) {
      const { runJson } = require('./handlers/json');
      return await runJson({ command, options, positionals, config, recipeRegistry, openerRegistry });
    }
    // A command whose output is only data never shows a banner, so it does not need the prompt library.
    const plain = getCommand(command)?.plain?.(options);
    const p = plain ? undefined : await loadPrompts();
    if (p && command !== 'mcp') p.intro(`${pc.bgCyan(pc.black(` ${BRAND} `))} ${pc.bold(command)}`);
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
    (await loadPrompts()).log.error(error.message);
    return 1;
  }
}

module.exports = {
  dispatch,
  main,
  printHelp,
  // Re-exported lazily for tests and callers that used to import them from here.
  get applyConfigDefaults() { return require('./handlers/scaffold').applyConfigDefaults; },
  get describeFailure() { return require('./runtime/execute').describeFailure; },
  get executeCommands() { return require('./runtime/execute').executeCommands; },
  get handleLifecycle() { return require('./handlers/lifecycle').handleLifecycle; },
  get rebuildHistoryCommands() { return require('./handlers/history').rebuildHistoryCommands; },
};
