// Copyright (c) 2026 bachbnt

async function handleMcp() {
  // Loaded here so every other command avoids the cost of the MCP SDK.
  const { startMcpServer } = require('../mcp/server');
  await startMcpServer();
  return 0;
}

module.exports = { handleMcp };
