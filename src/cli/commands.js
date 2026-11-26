// Copyright (c) 2026 bachbnt

// The single list of DevCmd commands. This file is pure data (handlers load lazily on first use),
// so `constants.js`, help, completion, and dispatch all derive from it without loading handler code.
//
//   kind     'lifecycle' (runs on a detected project), 'device', or 'system'
//   section  where `dev help` lists it: frameworks, project, tools, devices, history; none = hidden
//   json     supports --json
//   filter   supports --filter <workspace>
//   handler  () => function, resolved on first use; absent for commands main() answers itself
//   plain    (options) => true when the output must be only the data (no intro banner)

function lazy(modulePath, exportName) {
  return () => require(modulePath)[exportName];
}

const LIFECYCLE = [
  'install', 'run', 'test', 'build', 'check', 'lint', 'format',
  'outdated', 'upgrade', 'audit', 'clean', 'reset', 'open',
];
const FILTERABLE = new Set(['run', 'test', 'build', 'check', 'lint', 'format']);

const lifecycle = LIFECYCLE.map((name) => ({
  name,
  kind: 'lifecycle',
  section: 'project',
  description: `${name.charAt(0).toUpperCase()}${name.slice(1)} the detected project`,
  filter: FILTERABLE.has(name),
  handler: lazy('../handlers/lifecycle', 'handleLifecycle'),
}));

const COMMANDS = [
  { name: 'init', kind: 'system', section: 'frameworks', description: 'Create a new project interactively', handler: lazy('../handlers/scaffold', 'handleInit') },
  { name: 'doctor', kind: 'system', section: 'project', description: 'Check development tools', json: true, handler: lazy('../handlers/system', 'handleDoctor') },
  { name: 'inspect', kind: 'system', section: 'project', description: 'Show detected project and lifecycle commands', json: true, handler: lazy('../handlers/lifecycle', 'handleInspect') },
  ...lifecycle,
  { name: 'task', kind: 'system', section: 'project', description: 'List or run project tasks (package.json scripts, .devcmd.json)', filter: true, handler: lazy('../handlers/workflow', 'handleTask') },
  { name: 'parallel', kind: 'system', section: 'project', description: 'Run a lifecycle action in several projects at once', handler: lazy('../handlers/workflow', 'handleParallel') },
  { name: 'trust', kind: 'system', section: 'project', description: 'Review and trust the project .devcmd.json profile', handler: lazy('../handlers/workflow', 'handleTrust') },
  { name: 'env', kind: 'system', section: 'project', description: 'Create .env from .env.example, or check for missing variables', handler: lazy('../handlers/tools', 'handleEnv') },
  { name: 'docker', kind: 'system', section: 'project', description: 'Run Docker Compose: up, down, build, ps, logs, restart', handler: lazy('../handlers/tools', 'handleDocker') },
  { name: 'projects', kind: 'system', section: 'project', description: 'Show recently used projects', json: true, handler: lazy('../handlers/system', 'handleProjects') },
  { name: 'recipes', kind: 'system', section: 'project', description: 'List or validate framework recipes', json: true, handler: lazy('../handlers/system', 'handleRecipes') },
  { name: 'openers', kind: 'system', section: 'project', description: 'List or validate project openers', json: true, handler: lazy('../handlers/system', 'handleOpeners') },
  { name: 'config', kind: 'system', section: 'project', description: 'Show or update DevCmd defaults', json: true, handler: lazy('../handlers/system', 'handleConfig') },
  { name: 'completion', kind: 'system', section: 'project', description: 'Generate bash or zsh completion' },
  { name: 'clone', kind: 'system', section: 'tools', description: 'Clone a repository and install dependencies', handler: lazy('../handlers/clone', 'handleClone') },
  { name: 'update', kind: 'system', section: 'tools', description: 'Update DevCmd to the latest version', handler: lazy('../handlers/system', 'handleUpdate') },
  {
    name: 'ai', kind: 'system', section: 'tools', description: 'Show what AI coding tools cost: dev ai [today|week|month|report|clients]', json: true,
    plain: (options) => Boolean(
      options.short || options.check || options.showTools || options.showPrices || options.statuslineConfig || options.machines
      || options.importSnapshot || options.exportSnapshot || options.sessions || options.efficiency || (options.format && options.format !== 'table')
    ),
    handler: lazy('../handlers/ai', 'handleAi'),
  },
  {
    name: 'disk', kind: 'system', section: 'tools', description: 'Show what takes disk space: project folders, tool caches, big files', json: true,
    handler: lazy('../handlers/disk', 'handleDisk'),
  },
  {
    name: 'prune', kind: 'system', section: 'tools', description: 'Clean caches and rebuildable folders: dev prune [caches|projects|browsers|app-caches|apps|trash|maintenance]', json: true,
    handler: lazy('../handlers/prune', 'handlePrune'),
  },
  { name: 'mcp', kind: 'system', section: 'tools', description: 'Start the DevCmd MCP server (stdio transport)', handler: lazy('../handlers/mcp', 'handleMcp') },
  { name: 'devices', kind: 'device', section: 'devices', description: 'List Android and iOS devices', json: true, handler: lazy('../handlers/devices', 'handleDeviceList') },
  { name: 'android', kind: 'device', section: 'devices', description: 'Boot Android emulator', handler: lazy('../handlers/devices', 'handleDeviceCommand') },
  { name: 'ios', kind: 'device', section: 'devices', description: 'Boot or manage iOS simulators', handler: lazy('../handlers/devices', 'handleDeviceCommand') },
  { name: 'history', kind: 'system', section: 'history', description: 'Show recent successful commands [--clear] [--project <path>]', json: true, handler: lazy('../handlers/history', 'handleHistory') },
  { name: 'again', kind: 'system', section: 'history', description: 'Run a recent command again [n]', handler: lazy('../handlers/history', 'handleAgain') },
  { name: 'info', kind: 'system', description: 'List supported frameworks', handler: lazy('../handlers/system', 'handleInfo') },
];

const BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));

function getCommand(name) {
  return BY_NAME.get(name);
}

module.exports = { COMMANDS, getCommand };
