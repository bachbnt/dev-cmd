// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { PACKAGE_MANAGERS } = require('../config');
const { getRecipeDefinitions, loadRecipeRegistry } = require('../recipes');
const { runSequenceCaptured } = require('../runner/captured');
const { validateProjectName } = require('../utils/args');
const { MAX_OUTPUT_BYTES, TIMEOUT_PROPERTY, jsonResult, positiveInteger } = require('./shared');

// Tools that list framework recipes and scaffold projects from them.

const DEV_BINARY = path.join(__dirname, '..', '..', 'dev');
const SCAFFOLD_TIMEOUT_MS = 600000;

const definitions = [
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
];

function scaffoldArguments(args, recipes) {
  const { framework, name } = args;
  if (!recipes[framework]) {
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
  const recipes = getRecipeDefinitions(loadRecipeRegistry({ includeUser: true }));
  const argv = scaffoldArguments(args, recipes);
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

const handlers = {
  scaffold_project: (args) => scaffoldProject(args),
  list_frameworks() {
    const recipes = getRecipeDefinitions(loadRecipeRegistry({ includeUser: true }));
    return jsonResult(Object.entries(recipes).map(([name, definition]) => describeFramework(name, definition)));
  },
};

module.exports = { definitions, handlers };
