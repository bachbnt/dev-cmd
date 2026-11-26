// Copyright (c) 2026 bachbnt

const { AI_TOOLS } = require('../ai/constants');
const { loadConfig } = require('../config/user');
const { parseArgs } = require('../utils/args');

// MCP tool `ai_cost`: read-only totals of what AI coding tools cost on this computer.
//
// Privacy decision: an agent may ask for totals by day, week, month, model or tool, never by
// project, session, branch or client (those names would leak to the agent), and the result leaves
// out file paths. Nothing is written: no daily history, no cache.

const PERIODS = ['today', 'week', 'month'];
const GROUPS = ['day', 'week', 'month', 'model', 'tool'];

const definition = {
  name: 'ai_cost',
  description: 'Read-only: what Claude Code, Codex and other AI coding tools cost on this computer at API prices, from their local logs. Totals only; no project, session, branch or client names are returned.',
  inputSchema: {
    type: 'object',
    properties: {
      period: { type: 'string', enum: PERIODS, description: 'today, the last 7 days, or this month (default).' },
      group_by: { type: 'string', enum: GROUPS, description: 'How to group the rows.' },
      tool: { type: 'string', enum: AI_TOOLS, description: 'Only this tool.' },
    },
  },
};

async function handler(args = {}, environment = {}) {
  const period = args.period ?? 'month';
  if (!PERIODS.includes(period)) throw new Error(`period must be one of: ${PERIODS.join(', ')}`);
  if (args.group_by !== undefined && !GROUPS.includes(args.group_by)) throw new Error(`group_by must be one of: ${GROUPS.join(', ')}`);
  if (args.tool !== undefined && !AI_TOOLS.includes(args.tool)) throw new Error(`tool must be one of: ${AI_TOOLS.join(', ')}`);
  const argv = ['ai', period, '--dry-run', '--no-cache'];
  if (args.group_by) argv.push('--by', args.group_by);
  if (args.tool) argv.push('--tool', args.tool);
  const { options, positionals } = parseArgs(argv);
  // Loaded here, not at the top: the scan code is only needed when this tool is called.
  const { collectAi } = require('../handlers/ai');
  const { report } = await collectAi({
    options, positionals, config: environment.config || loadConfig(), homeDir: environment.homeDir,
  });
  const {
    group_by: groupBy, since, until, rows, total, unpriced,
  } = report;
  return {
    content: [{ type: 'text', text: JSON.stringify({
      group_by: groupBy, since, until, rows, total, unpriced,
    }, null, 2) }],
  };
}

module.exports = { definition, handler };
