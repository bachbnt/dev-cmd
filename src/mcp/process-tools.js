// Copyright (c) 2026 bachbnt

const { LIFECYCLE_COMMANDS } = require('../constants');
const { FILTER_PROPERTY, PATH_PROPERTY, defaultProcesses, jsonResult } = require('./shared');
const { lifecycleCommands } = require('./lifecycle-tools');

// Tools that start, watch and stop background processes owned by this server.

const definitions = [
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
];

const handlers = {
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
};

module.exports = { definitions, handlers };
