// Copyright (c) 2026 bachbnt

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { VERSION } = require('../config');
const { loadConfig } = require('../config/user');
const { readHistory } = require('../commands/history');
const { buildLifecycleCommands } = require('../commands/lifecycle');
const { LIFECYCLE_COMMANDS } = require('../constants');
const { detectProject } = require('../projects/detect');
const { getRecipeDefinitions, loadRecipeRegistry } = require('../recipes');
const { formatSequence } = require('../runner/command');
const { runSequenceCaptured } = require('../runner/captured');

const MCP_DEFAULT_TIMEOUT_MS = 120000;
const MCP_RUN_TIMEOUT_MS = 30000;
const MCP_MAX_OUTPUT_BYTES = 1024 * 1024;

const TOOLS = [
  {
    name: 'inspect_project',
    description: 'Detect and describe the project at the given path (defaults to current directory).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the project root.' },
      },
    },
  },
  {
    name: 'run_lifecycle',
    description: `Run a lifecycle command on a project. Available actions: ${LIFECYCLE_COMMANDS.join(', ')}.`,
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: LIFECYCLE_COMMANDS, description: 'Lifecycle action to run.' },
        path: { type: 'string', description: 'Project path (defaults to current directory).' },
        dryRun: { type: 'boolean', description: 'If true, print commands without executing.' },
        timeoutMs: { type: 'integer', description: 'Maximum time to wait before terminating the process.' },
        maxOutputBytes: { type: 'integer', description: 'Maximum captured output bytes to return.' },
      },
    },
  },
  {
    name: 'list_frameworks',
    description: 'List all supported framework recipes that can be scaffolded with DevCmd.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_history',
    description: 'Return recent successful DevCmd command history.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max entries to return (default 10, max 50).' },
      },
    },
  },
];

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2));
}

async function callTool(name, args, environment = {}) {
  if (name === 'inspect_project') {
    const root = args.path ? require('path').resolve(args.path) : process.cwd();
    const recipeRegistry = loadRecipeRegistry({ includeUser: true });
    let project;
    try {
      project = detectProject(root, { registry: recipeRegistry });
    } catch (error) {
      return textResult(`Error: ${error.message}`);
    }
    return jsonResult({
      type: project.type,
      name: project.name,
      root: project.root,
      packageManager: project.packageManager,
      lifecycleCommands: LIFECYCLE_COMMANDS,
    });
  }

  if (name === 'run_lifecycle') {
    const { action, path: projectPath, dryRun = false } = args;
    if (!LIFECYCLE_COMMANDS.includes(action)) {
      return textResult(`Error: Unknown action "${action}". Valid: ${LIFECYCLE_COMMANDS.join(', ')}`);
    }
    const root = projectPath ? require('path').resolve(projectPath) : process.cwd();
    const recipeRegistry = loadRecipeRegistry({ includeUser: true });
    const config = environment.config || loadConfig();
    let project;
    try {
      project = detectProject(root, { registry: recipeRegistry });
    } catch (error) {
      return textResult(`Error detecting project: ${error.message}`);
    }
    let commands;
    try {
      commands = buildLifecycleCommands(action, project, { config });
    } catch (error) {
      return textResult(`Error building commands: ${error.message}`);
    }
    const preview = formatSequence(commands);
    if (dryRun) return textResult(`Dry run — would execute:\n${preview}`);
    const timeoutMs = Number.isInteger(args.timeoutMs) && args.timeoutMs > 0
      ? args.timeoutMs
      : action === 'run' ? MCP_RUN_TIMEOUT_MS : MCP_DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = Number.isInteger(args.maxOutputBytes) && args.maxOutputBytes >= 0
      ? args.maxOutputBytes
      : MCP_MAX_OUTPUT_BYTES;
    const result = await runSequenceCaptured(commands, { timeoutMs, maxOutputBytes });
    const status = result.ok ? '✔' : `✖ (exit ${result.exitCode})`;
    const notes = [
      result.timedOut ? `Timed out after ${timeoutMs}ms.` : undefined,
      result.outputTruncated ? `Output truncated at ${maxOutputBytes} bytes.` : undefined,
    ].filter(Boolean);
    const output = result.output || '(no output)';
    return textResult(`${status}${notes.length ? `\n${notes.join('\n')}` : ''}\n\n${output}`);
  }

  if (name === 'list_frameworks') {
    const recipeRegistry = loadRecipeRegistry({ includeUser: true });
    const definitions = getRecipeDefinitions(recipeRegistry);
    return jsonResult(
      Object.entries(definitions).map(([name, def]) => ({
        name,
        description: def.description,
        source: def.source || 'built-in',
      }))
    );
  }

  if (name === 'get_history') {
    const limit = Math.min(args.limit ?? 10, 50);
    const history = readHistory().slice(0, limit).map((entry) => ({
      command: entry.command,
      projectName: entry.projectName,
      projectPath: entry.projectPath,
      projectType: entry.projectType,
      commandLine: entry.commandLine,
      executedAt: entry.executedAt,
    }));
    return jsonResult(history);
  }

  return textResult(`Unknown tool: ${name}`);
}

async function startMcpServer() {
  const server = new Server(
    { name: 'devcmd', version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      return await callTool(name, args);
    } catch (error) {
      return textResult(`Error: ${error.message}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

module.exports = { callTool, startMcpServer };
