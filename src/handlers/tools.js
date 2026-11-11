// Copyright (c) 2026 bachbnt

const path = require('path');
const { buildDockerCommands } = require('../commands/docker');
const { checkEnv, initEnv } = require('../commands/env');
const { detectProject } = require('../projects/detect');
const { executeCommands } = require('../runtime/execute');

function resolveRoot(projectPath, context) {
  if (projectPath) return path.resolve(projectPath);
  try {
    return detectProject(process.cwd(), { registry: context.recipeRegistry }).root;
  } catch {
    return process.cwd();
  }
}

function handleEnv(context) {
  const { p, positionals, options } = context;
  const subcommand = ['init', 'check'].includes(positionals[0]) ? positionals[0] : 'init';
  const rest = ['init', 'check'].includes(positionals[0]) ? positionals.slice(1) : positionals;
  if (rest.length > 1) throw new Error('Usage: dev env [init|check] [path]');
  const root = resolveRoot(rest[0], context);

  if (subcommand === 'check') {
    const result = checkEnv(root);
    if (result.ok) {
      p.outro(`.env defines every variable from ${result.template}.`);
      return 0;
    }
    p.note(result.missing.join('\n'), `Missing from .env (see ${result.template})`);
    p.outro(`${result.missing.length} variable(s) missing.`);
    return 1;
  }
  if (options.dryRun) {
    p.outro(`Would create .env from the template in ${root} if it does not exist.`);
    return 0;
  }
  const result = initEnv(root);
  p.outro(result.created
    ? `Created .env from ${result.template}. Fill in the values.`
    : '.env already exists. Nothing was changed.');
  return 0;
}

async function handleDocker(context) {
  const { p, pc, positionals, options, config } = context;
  if (positionals.length < 1 || positionals.length > 2) {
    throw new Error('Usage: dev docker <up|down|build|ps|logs|restart> [path]');
  }
  const root = resolveRoot(positionals[1], context);
  const commands = buildDockerCommands(positionals[0], root);
  return executeCommands(p, pc, commands, {
    command: 'docker',
    action: positionals[0],
    projectPath: root,
    projectName: path.basename(root),
    projectType: 'docker',
    config,
  }, { ...options, requirements: ['docker'] });
}

module.exports = {
  handleDocker,
  handleEnv,
};
