// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { PACKAGE_MANAGERS } = require('../config');
const { loadConfig } = require('../config/user');
const { buildAndroidCommands, buildIOSBootCommands } = require('../commands/devices');
const { filterHistory, readHistory } = require('../commands/history');
const { inspectProject } = require('../commands/inspect');
const { buildLifecycleCommands, buildOpenCommands, buildTaskCommands } = require('../commands/lifecycle');
const { LIFECYCLE_COMMANDS } = require('../constants');
const { getAndroidDevices, getIOSDevices } = require('../devices');
const { loadOpenerRegistry } = require('../openers');
const { detectProject } = require('../projects/detect');
const { getRecipeDefinitions, loadRecipeRegistry } = require('../recipes');
const { checkTools } = require('../runner/check');
const { formatSequence } = require('../runner/command');
const { runSequenceCaptured } = require('../runner/captured');
const { validateProjectName } = require('../utils/args');
const { ProcessManager } = require('./processes');

const DEV_BINARY = path.join(__dirname, '..', '..', 'dev');
const DEFAULT_TIMEOUT_MS = 120000;
const RUN_TIMEOUT_MS = 30000;
const SCAFFOLD_TIMEOUT_MS = 600000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

const defaultProcesses = new ProcessManager();

const PATH_PROPERTY = { type: 'string', description: 'Project path (defaults to the server working directory).' };
const FILTER_PROPERTY = { type: 'string', description: 'Monorepo workspace name or directory (Node.js workspaces only).' };
const DRY_RUN_PROPERTY = { type: 'boolean', description: 'Return the resolved commands without executing them.' };
const TIMEOUT_PROPERTY = { type: 'integer', description: 'Maximum time to wait before terminating the process.' };
const OUTPUT_PROPERTY = { type: 'integer', description: 'Maximum captured output bytes to return.' };

const TOOLS = [
  {
    name: 'inspect_project',
    description: 'Detect the project and return its type, package manager, workspaces, tasks, profile trust state, and the exact command DevCmd would run for every lifecycle action.',
    inputSchema: { type: 'object', properties: { path: PATH_PROPERTY } },
  },
  {
    name: 'run_lifecycle',
    description: `Run a lifecycle action and return structured JSON with exit code and captured output. Actions: ${LIFECYCLE_COMMANDS.join(', ')}. Long-running servers (run) are stopped after the timeout; use start_process for those.`,
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: LIFECYCLE_COMMANDS, description: 'Lifecycle action to run.' },
        path: PATH_PROPERTY,
        filter: FILTER_PROPERTY,
        fix: { type: 'boolean', description: 'Apply automatic fixes (lint only).' },
        dryRun: DRY_RUN_PROPERTY,
        timeoutMs: TIMEOUT_PROPERTY,
        maxOutputBytes: OUTPUT_PROPERTY,
      },
    },
  },
  {
    name: 'run_task',
    description: 'Run a project task: a .devcmd.json task or a package.json script. Tasks are listed by inspect_project.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Task or script name.' },
        path: PATH_PROPERTY,
        filter: FILTER_PROPERTY,
        dryRun: DRY_RUN_PROPERTY,
        timeoutMs: TIMEOUT_PROPERTY,
        maxOutputBytes: OUTPUT_PROPERTY,
      },
    },
  },
  {
    name: 'start_process',
    description: 'Start a lifecycle action (for example run, to launch a dev server) in the background and return a process id. Use get_process_logs and stop_process to manage it.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: LIFECYCLE_COMMANDS.filter((action) => action !== 'open') },
        path: PATH_PROPERTY,
        filter: FILTER_PROPERTY,
      },
    },
  },
  {
    name: 'get_process_logs',
    description: 'Return the status and the most recent output lines of a background process.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        tail: { type: 'integer', description: 'Number of trailing lines to return (default 100).' },
      },
    },
  },
  {
    name: 'stop_process',
    description: 'Stop a background process started by this server.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
  },
  {
    name: 'list_processes',
    description: 'List background processes started by this server.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'scaffold_project',
    description: 'Create a new project from a framework recipe. dryRun defaults to true: review the command, then call again with dryRun false to create the project.',
    inputSchema: {
      type: 'object',
      required: ['framework', 'name'],
      properties: {
        framework: { type: 'string', description: 'Recipe name from list_frameworks.' },
        name: { type: 'string', description: 'Project directory name (letters, numbers, dots, underscores, hyphens).' },
        directory: { type: 'string', description: 'Existing parent directory (defaults to the server working directory).' },
        typescript: { type: 'boolean' },
        packageManager: { type: 'string', enum: PACKAGE_MANAGERS },
        git: { type: 'boolean' },
        eslint: { type: 'boolean' },
        install: { type: 'boolean', description: 'Set false to skip dependency installation.' },
        python: { type: 'string', description: 'Python executable for Python frameworks.' },
        values: { type: 'object', additionalProperties: { type: 'string' }, description: 'Custom recipe inputs.' },
        dryRun: { type: 'boolean', description: 'Default true.' },
        timeoutMs: TIMEOUT_PROPERTY,
      },
    },
  },
  {
    name: 'list_frameworks',
    description: 'List framework recipes that can be scaffolded, with their supported options and inputs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'doctor',
    description: 'Check which development tools are installed and how to install missing ones.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_devices',
    description: 'List Android emulators and iOS simulators with runtime and boot status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'boot_device',
    description: 'Boot an Android emulator (runs in the background; returns a process id) or an iOS simulator.',
    inputSchema: {
      type: 'object',
      required: ['platform', 'name'],
      properties: {
        platform: { type: 'string', enum: ['android', 'ios'] },
        name: { type: 'string', description: 'Device name or identifier from list_devices.' },
        coldBoot: { type: 'boolean', description: 'Android only: skip the saved snapshot.' },
      },
    },
  },
  {
    name: 'get_history',
    description: 'Return recent successful DevCmd commands, optionally filtered.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max entries to return (default 10, max 50).' },
        project: { type: 'string', description: 'Only entries for this project path.' },
        search: { type: 'string', description: 'Only entries containing this text.' },
      },
    },
  },
];

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function jsonResult(value, isError = false) {
  return textResult(JSON.stringify(value, null, 2), isError);
}

function errorResult(message) {
  return textResult(`Error: ${message}`, true);
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function loadContext(args, environment) {
  const root = args.path ? path.resolve(args.path) : process.cwd();
  const registry = loadRecipeRegistry({ includeUser: true });
  const config = environment.config || loadConfig();
  const project = detectProject(root, { registry });
  return { project, config, registry, trustFile: environment.trustFile };
}

async function runCaptured(commands, args, defaultTimeout, extra = {}) {
  const preview = formatSequence(commands);
  if (args.dryRun) return jsonResult({ dryRun: true, command: preview, ...extra });
  const timeoutMs = positiveInteger(args.timeoutMs, defaultTimeout);
  const maxOutputBytes = Number.isInteger(args.maxOutputBytes) && args.maxOutputBytes >= 0
    ? args.maxOutputBytes
    : MAX_OUTPUT_BYTES;
  const result = await runSequenceCaptured(commands, { timeoutMs, maxOutputBytes });
  return jsonResult({
    ok: result.ok,
    exitCode: result.exitCode,
    command: preview,
    ...(result.failedCommand ? { failedCommand: formatSequence([result.failedCommand]) } : {}),
    timedOut: Boolean(result.timedOut),
    outputTruncated: Boolean(result.outputTruncated),
    output: result.output || '',
    ...extra,
  }, !result.ok);
}

function lifecycleCommands(args, environment) {
  const { action } = args;
  if (!LIFECYCLE_COMMANDS.includes(action)) {
    throw new Error(`Unknown action "${action}". Valid: ${LIFECYCLE_COMMANDS.join(', ')}`);
  }
  const { project, config, trustFile } = loadContext(args, environment);
  const commands = action === 'open'
    ? buildOpenCommands(project, undefined, config, loadOpenerRegistry({ includeUser: true }))
    : buildLifecycleCommands(action, project, { config, filter: args.filter, fix: args.fix, trustFile });
  return { commands, project };
}

function scaffoldArguments(args, definitions) {
  const { framework, name } = args;
  if (!definitions[framework]) {
    throw new Error(`Unsupported framework: ${framework}. Use list_frameworks.`);
  }
  validateProjectName(name);
  const argv = [framework, name];
  if (args.typescript !== undefined) argv.push(args.typescript ? '--typescript' : '--javascript');
  if (args.packageManager !== undefined) {
    if (!PACKAGE_MANAGERS.includes(args.packageManager)) {
      throw new Error(`packageManager must be one of: ${PACKAGE_MANAGERS.join(', ')}`);
    }
    argv.push(`--${args.packageManager}`);
  }
  if (args.git !== undefined) argv.push(args.git ? '--git' : '--no-git');
  if (args.eslint !== undefined) argv.push(args.eslint ? '--eslint' : '--no-eslint');
  if (args.install === false) argv.push('--no-install');
  if (args.python !== undefined) {
    if (typeof args.python !== 'string' || !args.python || args.python.startsWith('-')) {
      throw new Error('python must be an executable name or path.');
    }
    argv.push('--python', args.python);
  }
  for (const [key, value] of Object.entries(args.values || {})) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || !value) {
      throw new Error(`Invalid recipe input: ${key}`);
    }
    argv.push('--set', `${key}=${value}`);
  }
  return argv;
}

async function scaffoldProject(args) {
  const definitions = getRecipeDefinitions(loadRecipeRegistry({ includeUser: true }));
  const argv = scaffoldArguments(args, definitions);
  const directory = args.directory ? path.resolve(args.directory) : process.cwd();
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Directory does not exist: ${directory}`);
  }
  const dryRun = args.dryRun !== false;
  if (dryRun) argv.push('--dry-run');
  const command = { executable: process.execPath, args: [DEV_BINARY, ...argv], cwd: directory };
  const result = await runSequenceCaptured([command], {
    timeoutMs: positiveInteger(args.timeoutMs, SCAFFOLD_TIMEOUT_MS),
    maxOutputBytes: MAX_OUTPUT_BYTES,
  });
  return jsonResult({
    ok: result.ok,
    exitCode: result.exitCode,
    dryRun,
    command: `dev ${argv.join(' ')}`,
    projectPath: path.join(directory, args.name),
    timedOut: Boolean(result.timedOut),
    output: result.output || '',
  }, !result.ok);
}

function describeFramework(name, definition) {
  return {
    name,
    description: definition.description,
    source: definition.source || 'built-in',
    capabilities: definition.capabilities,
  };
}

function bootDevice(args, environment) {
  const processes = environment.processes || defaultProcesses;
  const { platform, name } = args;
  if (!['android', 'ios'].includes(platform)) throw new Error('platform must be android or ios.');
  if (typeof name !== 'string' || !name || name.startsWith('-')) {
    throw new Error('name must be a device name or identifier.');
  }
  if (platform === 'android') {
    const commands = buildAndroidCommands(name, { coldBoot: Boolean(args.coldBoot) });
    return jsonResult({ ...processes.start({ label: `android:${name}`, commands }) });
  }
  return runCaptured(buildIOSBootCommands(name), {}, DEFAULT_TIMEOUT_MS, { platform, name });
}

const HANDLERS = {
  inspect_project(args, environment) {
    const { project, config } = loadContext(args, environment);
    return jsonResult(inspectProject(
      project,
      config,
      loadOpenerRegistry({ includeUser: true }),
      { trustFile: environment.trustFile }
    ));
  },
  run_lifecycle(args, environment) {
    const { commands } = lifecycleCommands(args, environment);
    return runCaptured(commands, args, args.action === 'run' ? RUN_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  },
  run_task(args, environment) {
    const { project, config, trustFile } = loadContext(args, environment);
    if (typeof args.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_.-]*$/.test(args.name)) {
      throw new Error('Invalid task name.');
    }
    const commands = buildTaskCommands(project, args.name, { config, filter: args.filter, trustFile });
    return runCaptured(commands, args, DEFAULT_TIMEOUT_MS);
  },
  start_process(args, environment) {
    if (args.action === 'open') throw new Error('open cannot run as a background process.');
    const { commands, project } = lifecycleCommands(args, environment);
    const processes = environment.processes || defaultProcesses;
    return jsonResult(processes.start({ label: `${args.action}:${project.name}`, commands }));
  },
  get_process_logs(args, environment) {
    return jsonResult((environment.processes || defaultProcesses).logs(args.id, { tail: args.tail }));
  },
  async stop_process(args, environment) {
    return jsonResult(await (environment.processes || defaultProcesses).stop(args.id));
  },
  list_processes(args, environment) {
    return jsonResult((environment.processes || defaultProcesses).list());
  },
  scaffold_project: (args) => scaffoldProject(args),
  list_frameworks() {
    const definitions = getRecipeDefinitions(loadRecipeRegistry({ includeUser: true }));
    return jsonResult(Object.entries(definitions).map(([name, definition]) => describeFramework(name, definition)));
  },
  doctor(args, environment) {
    const config = environment.config || loadConfig();
    const tools = checkTools(config).map(({ name, executable, required, found, path: toolPath, version, hint }) => ({
      name, executable, required: Boolean(required), found, path: toolPath, version, hint,
    }));
    return jsonResult({ ready: tools.every((tool) => !tool.required || tool.found), tools });
  },
  list_devices() {
    return jsonResult({ android: getAndroidDevices(), ios: getIOSDevices() });
  },
  boot_device: bootDevice,
  get_history(args) {
    const limit = Math.min(positiveInteger(args.limit, 10), 50);
    return jsonResult(filterHistory(readHistory(), args).slice(0, limit).map((entry) => ({
      command: entry.command,
      projectName: entry.projectName,
      projectPath: entry.projectPath,
      projectType: entry.projectType,
      commandLine: entry.commandLine,
      executedAt: entry.executedAt,
    })));
  },
};

async function callTool(name, args = {}, environment = {}) {
  if (!Object.hasOwn(HANDLERS, name)) return errorResult(`Unknown tool: ${name}`);
  try {
    return await HANDLERS[name](args, environment);
  } catch (error) {
    return errorResult(error.message);
  }
}

module.exports = {
  TOOLS,
  callTool,
  defaultProcesses,
};
