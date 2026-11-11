// Copyright (c) 2026 bachbnt

const { buildLifecycleCommands, buildOpenCommands } = require('../commands/lifecycle');
const { inspectProject } = require('../commands/inspect');
const { detectProject } = require('../projects/detect');
const { getExistingProjects } = require('../projects/recent');
const { executeCommands } = require('../runtime/execute');
const { builtInOpenerRegistry, resolveOpener } = require('../openers');
const { LIFECYCLE_COMMANDS } = require('../constants');

function resolveLifecycleTarget(
  command,
  positionals,
  options = {},
  openerRegistry = builtInOpenerRegistry
) {
  if (command === 'open' && options.list) {
    if (positionals.length > 0) throw new Error('Usage: dev open --list');
    return { listOpeners: true };
  }
  if (command === 'open' && positionals[0] === 'recent') {
    if (positionals.length > 1) throw new Error('Usage: dev open recent');
    const recent = getExistingProjects()[0];
    if (!recent) throw new Error('No recent project is available.');
    return { projectPath: recent.path };
  }
  if (command === 'open') {
    if (options.opener) {
      if (positionals.length > 1) throw new Error('Usage: dev open [path] --with <opener>');
      return { openerName: options.opener, projectPath: positionals[0] || process.cwd() };
    }
    const opener = resolveOpener(openerRegistry, positionals[0]);
    if (opener) {
      if (positionals.length > 2) throw new Error(`Usage: dev open ${positionals[0]} [path]`);
      return { openerName: positionals[0], projectPath: positionals[1] || process.cwd() };
    }
  }
  if (positionals.length > 1) throw new Error(`Usage: dev ${command} [path]`);
  return { projectPath: positionals[0] || process.cwd() };
}

async function handleLifecycle(context) {
  const { p, pc, command, positionals, options, config } = context;
  const { projectPath, openerName, listOpeners } = resolveLifecycleTarget(
    command,
    positionals,
    options,
    context.openerRegistry
  );
  if (listOpeners) {
    const lines = [...context.openerRegistry.values()].map((opener) => {
      const aliases = opener.aliases?.length ? ` aliases: ${opener.aliases.join(', ')}` : '';
      return `${opener.name.padEnd(20)} [${opener.source}] ${opener.description}${aliases}`;
    });
    p.note(lines.join('\n'), 'Available openers');
    p.outro('Use: dev open <opener> [path]');
    return 0;
  }
  if (options.editor && openerName) {
    throw new Error('--editor cannot be combined with a named opener.');
  }
  const project = detectProject(projectPath, { registry: context.recipeRegistry });
  const commands = command === 'open'
    ? buildOpenCommands(project, openerName, config, context.openerRegistry, { editor: options.editor })
    : buildLifecycleCommands(command, project, { config, filter: options.filter, fix: options.fix });

  return executeCommands(p, pc, commands, {
    command,
    projectName: project.name,
    projectPath: project.root,
    projectType: project.type,
    config,
  }, options);
}

function handleInspect(context) {
  const { p, positionals, config } = context;
  if (positionals.length > 1) throw new Error('Usage: dev inspect [path]');
  const inspection = inspectProject(
    detectProject(positionals[0] || process.cwd(), { registry: context.recipeRegistry }),
    config,
    context.openerRegistry
  );
  const lines = [
    `Name: ${inspection.name}`,
    `Type: ${inspection.type}`,
    `Root: ${inspection.root}`,
  ];
  if (inspection.packageManager) lines.push(`Package manager: ${inspection.packageManager}`);
  if (inspection.xcode) lines.push(`Xcode: ${inspection.xcode.kind} ${inspection.xcode.file}`);
  if (inspection.recipeSource) lines.push(`Recipe: ${inspection.recipeSource}`);
  if (inspection.profile) {
    lines.push(`Profile: ${inspection.profile.file} (${inspection.profile.trusted ? 'trusted' : 'untrusted, run dev trust'})`);
  }
  if (inspection.workspaces.length) {
    lines.push(`Workspaces: ${inspection.workspaces.map((workspace) => workspace.name).join(', ')}`);
  }
  if (inspection.tasks.length) {
    lines.push(`Tasks: ${inspection.tasks.map((task) => task.name).join(', ')}`);
  }
  lines.push('');
  for (const action of inspection.actions) {
    lines.push(
      action.available
        ? `${action.action.padEnd(8)} ${action.command}`
        : `${action.action.padEnd(8)} unavailable: ${action.reason}`
    );
  }
  p.note(lines.join('\n'), 'Detected project');
  p.outro('Inspection complete.');
  return 0;
}

module.exports = {
  LIFECYCLE_COMMANDS,
  handleInspect,
  handleLifecycle,
  resolveLifecycleTarget,
};
