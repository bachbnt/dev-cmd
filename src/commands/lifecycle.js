// Copyright (c) 2026 bachbnt

const { getProjectAdapter } = require('../projects/adapters');
const { scriptCommands } = require('../projects/adapters/node');
const { buildProfileLifecycle, buildProfileTask } = require('../projects/profile');
const { createCommand } = require('../runner/command');
const { buildRecipeLifecycleCommands } = require('../recipes');
const { buildOpenerCommands, builtInOpenerRegistry, resolveOpener } = require('../openers');
const { unsupported } = require('../projects/adapters/common');

function buildLifecycleCommands(action, project, options = {}) {
  const custom = buildProfileLifecycle(project, action, options);
  if (custom) return custom;
  if (project.type === 'custom') return unsupported(action, project);
  const adapter = getProjectAdapter(project);
  if (options.filter && adapter.id !== 'node') {
    throw new Error('--filter requires a Node.js workspace project.');
  }
  if (options.fix && action !== 'lint') {
    throw new Error('--fix is only supported by the lint command.');
  }
  return adapter.build(action, project, options);
}

function listTasks(project) {
  const tasks = new Map();
  for (const [name, definition] of Object.entries(project.profile?.tasks || {})) {
    tasks.set(name, { name, source: 'profile', description: definition.description });
  }
  for (const name of Object.keys(project.packageJson?.scripts || {})) {
    if (!tasks.has(name)) tasks.set(name, { name, source: 'package.json' });
  }
  return [...tasks.values()];
}

function buildTaskCommands(project, name, options = {}) {
  const custom = buildProfileTask(project, name, options);
  if (custom) return custom;
  if (project.packageJson && getProjectAdapter(project).id === 'node') {
    return scriptCommands(project, name, options.filter);
  }
  throw new Error(`Unknown task: ${name}. Run dev task to list available tasks.`);
}

function buildOpenCommands(
  project,
  openerName,
  config,
  openerRegistry = builtInOpenerRegistry,
  options = {}
) {
  if (!openerName && options.editor) return [createCommand(options.editor, [project.root])];
  if (!openerName && !config.opener && config.editor) {
    return [createCommand(config.editor, [project.root])];
  }
  if (!openerName && project.recipe?.lifecycle?.open && !project.recipe.lifecycle.adapter) {
    return buildRecipeLifecycleCommands(project.recipe, 'open', project, { config });
  }
  const requested = openerName || config.opener || 'vscode';
  const opener = resolveOpener(openerRegistry, requested);
  if (!opener) throw new Error(`Unknown opener: ${requested}. Run dev open --list.`);
  return buildOpenerCommands(opener, project, options);
}

module.exports = {
  buildLifecycleCommands,
  buildOpenCommands,
  buildTaskCommands,
  listTasks,
};
