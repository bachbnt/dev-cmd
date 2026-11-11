// Copyright (c) 2026 bachbnt

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { VERSION } = require('../config');
const { TOOLS, callTool, defaultProcesses } = require('./tools');

async function startMcpServer() {
  const server = new Server(
    { name: 'devcmd', version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    return callTool(name, args);
  });

  server.onclose = () => defaultProcesses.stopAll();
  process.once('exit', () => defaultProcesses.stopAll());

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

module.exports = { TOOLS, callTool, startMcpServer };
