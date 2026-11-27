// Copyright (c) 2026 bachbnt

const { filterHistory, readHistory } = require('../commands/history');
const { jsonResult, positiveInteger } = require('./shared');

// Tool that reads the DevCmd command history.

const definitions = [
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

const handlers = {
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

module.exports = { definitions, handlers };
