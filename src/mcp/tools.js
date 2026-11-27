// Copyright (c) 2026 bachbnt

const aiCost = require('./ai-tool');
const device = require('./device-tools');
const history = require('./history-tools');
const lifecycle = require('./lifecycle-tools');
const processes = require('./process-tools');
const scaffold = require('./scaffold-tools');
const { defaultProcesses, errorResult } = require('./shared');

// The MCP tool list, assembled from one module per domain. Each domain exports
// `{ definitions, handlers }`; a new tool goes into its domain, and a new domain is added here.

const DOMAINS = [
  lifecycle,
  processes,
  scaffold,
  device,
  history,
  { definitions: [aiCost.definition], handlers: { ai_cost: aiCost.handler } },
];

const TOOLS = DOMAINS.flatMap((domain) => domain.definitions);
const HANDLERS = Object.assign({}, ...DOMAINS.map((domain) => domain.handlers));

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
