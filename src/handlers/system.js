// Copyright (c) 2026 bachbnt

const { CONFIG_FILE, OPENERS_DIR, PROJECTS_FILE, RECIPES_DIR, VERSION, frameworkDefinitions } = require('../config');
const { setConfigValue } = require('../config/user');
const { getExistingProjects } = require('../projects/recent');
const { checkTools } = require('../runner/check');
const { loadRecipeFile } = require('../recipes');
const { loadOpenerFile } = require('../openers');
const { executeCommands } = require('../runtime/execute');

const PACKAGE_SPEC = '@bachbntdev/devcmd@latest';

function printConfig(p, config) {
  p.note(JSON.stringify(config, null, 2), `Config: ${CONFIG_FILE}`);
}

function handleConfig(context) {
  const { p, positionals, config } = context;
  if (positionals.length === 0 || (positionals[0] === 'show' && positionals.length === 1)) {
    printConfig(p, config);
    p.outro('Use: dev config set <key> <value>');
    return 0;
  }
  if (positionals[0] === 'set' && positionals.length === 3) {
    printConfig(p, setConfigValue(positionals[1], positionals[2]));
    p.outro('Configuration saved.');
    return 0;
  }
  throw new Error('Usage: dev config [show] or dev config set <key> <value>');
}

async function handleUpdate(context) {
  const { p, pc, options } = context;
  p.log.info(`Current version: ${VERSION}`);
  return executeCommands(p, pc, [
    { executable: 'npm', args: ['install', '--global', PACKAGE_SPEC] },
  ], { command: 'update' }, options);
}

function handleDoctor(context) {
  const { p, pc, config } = context;
  const checks = checkTools(config);
  p.note(checks.map((check) => {
    const marker = check.found ? pc.green('OK') : check.required ? pc.red('MISSING') : pc.yellow('optional');
    return `${marker.padEnd(18)} ${check.name.padEnd(18)} ${check.version || check.path || ''}`;
  }).join('\n'), 'Development environment');
  const hints = checks.filter((check) => !check.found && check.hint);
  if (hints.length > 0) {
    p.note(hints.map((check) => `${check.name.padEnd(18)} ${check.hint}`).join('\n'), 'How to install missing tools');
  }
  const missing = checks.filter((check) => check.required && !check.found);
  p.outro(missing.length ? 'Required tools are missing.' : 'DevCmd is ready.');
  return missing.length ? 1 : 0;
}

function handleProjects(context) {
  const { p } = context;
  const projects = getExistingProjects();
  if (projects.length === 0) {
    p.outro('No recent projects yet.');
    return 0;
  }
  p.note(
    projects.map((project, index) => `${index + 1}. ${project.name} [${project.type}]\n   ${project.path}`).join('\n'),
    `Recent projects: ${PROJECTS_FILE}`
  );
  p.outro(`${projects.length} project(s).`);
  return 0;
}

function handleInfo(context) {
  const { p, pc } = context;
  const definitions = context.frameworkDefinitions || frameworkDefinitions;
  p.note(
    Object.entries(definitions)
      .map(([name, definition]) => {
        const source = definition.source === 'user' ? ' [user recipe]' : '';
        return `${pc.bold(name)}: ${definition.description}${source}`;
      })
      .join('\n'),
    'Supported frameworks'
  );
  p.outro('Run dev help for usage and options.');
  return 0;
}

function handleRecipes(context) {
  const { p, positionals, recipeRegistry } = context;
  if (positionals.length === 0 || (positionals[0] === 'list' && positionals.length === 1)) {
    const lines = [...recipeRegistry.values()].map(
      (recipe) => `${recipe.name.padEnd(20)} [${recipe.source}] ${recipe.description}`
    );
    p.note(lines.join('\n'), 'Available recipes');
    p.outro(`User recipe directory: ${RECIPES_DIR}`);
    return 0;
  }
  if (positionals[0] === 'validate' && positionals.length === 2) {
    const recipes = loadRecipeFile(positionals[1], 'user');
    p.note(recipes.map((recipe) => `${recipe.name}: ${recipe.description}`).join('\n'), 'Valid recipes');
    p.outro(`${recipes.length} recipe(s) validated.`);
    return 0;
  }
  throw new Error('Usage: dev recipes [list] or dev recipes validate <file>');
}

function handleOpeners(context) {
  const { p, positionals, openerRegistry } = context;
  if (positionals.length === 0 || (positionals[0] === 'list' && positionals.length === 1)) {
    const lines = [...openerRegistry.values()].map((opener) => {
      const aliases = opener.aliases?.length ? ` aliases: ${opener.aliases.join(', ')}` : '';
      return `${opener.name.padEnd(20)} [${opener.source}] ${opener.description}${aliases}`;
    });
    p.note(lines.join('\n'), 'Available openers');
    p.outro(`User opener directory: ${OPENERS_DIR}`);
    return 0;
  }
  if (positionals[0] === 'validate' && positionals.length === 2) {
    const openers = loadOpenerFile(positionals[1], 'user');
    p.note(openers.map((opener) => `${opener.name}: ${opener.description}`).join('\n'), 'Valid openers');
    p.outro(`${openers.length} opener(s) validated.`);
    return 0;
  }
  throw new Error('Usage: dev openers [list] or dev openers validate <file>');
}

module.exports = {
  handleConfig,
  handleDoctor,
  handleInfo,
  handleOpeners,
  handleProjects,
  handleRecipes,
  handleUpdate,
  printConfig,
};
