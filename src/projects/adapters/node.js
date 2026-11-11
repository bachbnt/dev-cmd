// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { createCommand } = require('../../runner/command');
const { resolveWorkspace } = require('../workspaces');
const { internalCleaner, internalResetter, unsupported } = require('./common');

function runScript(project, script, workspace) {
  const manager = project.packageManager;
  if (workspace && manager === 'pnpm') {
    return createCommand(manager, ['--filter', workspace.name, 'run', script], { cwd: project.root });
  }
  if (workspace && manager === 'yarn') {
    return createCommand(manager, ['workspace', workspace.name, 'run', script], { cwd: project.root });
  }
  if (workspace) {
    return createCommand(manager, ['run', script, '--workspace', workspace.name], { cwd: project.root });
  }
  return createCommand(manager, ['run', script], { cwd: project.root });
}

function scriptsOf(project, workspace) {
  return (workspace?.packageJson || project.packageJson)?.scripts || {};
}

function findScript(project, names, workspace) {
  const scripts = scriptsOf(project, workspace);
  return names.find((name) => scripts[name]);
}

function requireScript(project, names, action, workspace) {
  const script = findScript(project, names, workspace);
  if (!script) {
    const where = workspace ? ` in workspace ${workspace.name}` : '';
    throw new Error(
      `No package.json script is available for dev ${action}${where}. Expected: ${names.join(' or ')}.`
    );
  }
  return script;
}

function packageManagerCommand(project, args) {
  return [createCommand(project.packageManager, args, { cwd: project.root })];
}

function yarnBerry(project) {
  return fs.existsSync(path.join(project.root, '.yarnrc.yml'));
}

function scriptCommands(project, script, filter) {
  const workspace = filter ? resolveWorkspace(project, filter) : undefined;
  if (!scriptsOf(project, workspace)[script]) {
    const where = workspace ? ` in workspace ${workspace.name}` : '';
    throw new Error(`Unknown task: ${script}${where}. Run dev task to list available tasks.`);
  }
  return [runScript(project, script, workspace)];
}

const FILTERABLE_ACTIONS = new Set(['run', 'test', 'build', 'check', 'lint', 'format']);

function build(action, project, context = {}) {
  if (context.filter && !FILTERABLE_ACTIONS.has(action)) {
    throw new Error(`--filter is not supported by dev ${action}.`);
  }
  const workspace = context.filter ? resolveWorkspace(project, context.filter) : undefined;
  const manager = project.packageManager;

  if (action === 'install') return packageManagerCommand(project, ['install']);
  if (action === 'run') return [runScript(project, requireScript(project, ['dev', 'start'], action, workspace), workspace)];
  if (action === 'test') return [runScript(project, requireScript(project, ['test'], action, workspace), workspace)];
  if (action === 'build') return [runScript(project, requireScript(project, ['build'], action, workspace), workspace)];
  if (action === 'format') return [runScript(project, requireScript(project, ['format'], action, workspace), workspace)];
  if (action === 'lint') {
    const names = context.fix ? ['lint:fix'] : ['lint'];
    return [runScript(project, requireScript(project, names, action, workspace), workspace)];
  }
  if (action === 'reset') {
    return [...internalResetter(project), createCommand(manager, ['install'], { cwd: project.root })];
  }
  if (action === 'clean') {
    return project.packageJson.scripts?.clean ? [runScript(project, 'clean')] : internalCleaner(project);
  }
  if (action === 'check') {
    const scripts = ['lint', 'typecheck', 'test', 'build'].filter(
      (script) => scriptsOf(project, workspace)[script]
    );
    if (scripts.length === 0) {
      throw new Error('No quality scripts were found. Add one of: lint, typecheck, test, build.');
    }
    return scripts.map((script) => runScript(project, script, workspace));
  }
  if (action === 'outdated') return packageManagerCommand(project, ['outdated']);
  if (action === 'upgrade') {
    return packageManagerCommand(project, [manager === 'yarn' ? 'upgrade' : 'update']);
  }
  if (action === 'audit') {
    return packageManagerCommand(
      project,
      manager === 'yarn' && yarnBerry(project) ? ['npm', 'audit'] : ['audit']
    );
  }
  return unsupported(action, project);
}

module.exports = {
  build,
  findScript,
  id: 'node',
  scriptCommands,
  matches: (project) => Boolean(project.packageJson),
};
