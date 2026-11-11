// Copyright (c) 2026 bachbnt

const { buildLifecycleCommands, buildOpenCommands } = require('./lifecycle');
const { formatSequence } = require('../runner/command');
const { LIFECYCLE_COMMANDS } = require('../constants');
const { isTrusted } = require('../projects/profile');
const { listTasks } = require('./lifecycle');

function inspectAction(action, project, config, openerRegistry, options = {}) {
  try {
    const commands = action === 'open'
      ? buildOpenCommands(project, undefined, config, openerRegistry)
      : buildLifecycleCommands(action, project, { config, trustFile: options.trustFile });
    return {
      action,
      available: true,
      command: formatSequence(commands),
      commands,
    };
  } catch (error) {
    return { action, available: false, reason: error.message };
  }
}

function inspectProject(project, config, openerRegistry, options = {}) {
  return {
    name: project.name,
    type: project.type,
    root: project.root,
    packageManager: project.packageManager,
    xcode: project.xcode,
    recipeSource: project.recipe?.source,
    profile: project.profile
      ? { file: project.profile.file, trusted: isTrusted(project.profile, options) }
      : undefined,
    workspaces: (project.workspaces || []).map(({ name, dir }) => ({ name, dir })),
    tasks: listTasks(project),
    actions: LIFECYCLE_COMMANDS.map(
      (action) => inspectAction(action, project, config, openerRegistry, options)
    ),
  };
}

module.exports = {
  INSPECT_ACTIONS: LIFECYCLE_COMMANDS,
  inspectAction,
  inspectProject,
};
