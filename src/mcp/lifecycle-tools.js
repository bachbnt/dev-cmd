// Copyright (c) 2026 bachbnt

const { inspectProject } = require('../commands/inspect');
const { buildLifecycleCommands, buildOpenCommands, buildTaskCommands } = require('../commands/lifecycle');
const { LIFECYCLE_COMMANDS } = require('../constants');
const { loadOpenerRegistry } = require('../openers');
const {
  DEFAULT_TIMEOUT_MS, DRY_RUN_PROPERTY, FILTER_PROPERTY, OUTPUT_PROPERTY, PATH_PROPERTY, TIMEOUT_PROPERTY,
  jsonResult, loadContext, runCaptured,
} = require('./shared');

// Tools that inspect a project and run its lifecycle actions and tasks.

const RUN_TIMEOUT_MS = 30000;

const definitions = [
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
];

// The commands of one lifecycle action; also used by start_process.
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

const handlers = {
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
};

module.exports = { definitions, handlers, lifecycleCommands };
