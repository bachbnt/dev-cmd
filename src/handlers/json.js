// Copyright (c) 2026 bachbnt

const { filterHistory, readHistory } = require('../commands/history');
const { inspectProject } = require('../commands/inspect');
const { getAndroidDevices, getIOSDevices } = require('../devices');
const { detectProject } = require('../projects/detect');
const { getExistingProjects } = require('../projects/recent');
const { checkTools } = require('../runner/check');

function describeRegistry(registry) {
  return [...registry.values()].map((entry) => ({
    name: entry.name,
    description: entry.description,
    source: entry.source,
    ...(entry.aliases?.length ? { aliases: entry.aliases } : {}),
  }));
}

function collectJson(context) {
  const { command, positionals, options, config } = context;
  if (command === 'inspect') {
    if (positionals.length > 1) throw new Error('Usage: dev inspect [path] --json');
    const project = detectProject(positionals[0] || process.cwd(), { registry: context.recipeRegistry });
    return { data: inspectProject(project, config, context.openerRegistry), exitCode: 0 };
  }
  if (command === 'doctor') {
    const tools = checkTools(config).map(({ name, executable, required, found, path, version, hint }) => ({
      name, executable, required: Boolean(required), found, path, version, hint,
    }));
    const ready = tools.every((tool) => !tool.required || tool.found);
    return { data: { ready, tools }, exitCode: ready ? 0 : 1 };
  }
  if (command === 'projects') return { data: getExistingProjects(), exitCode: 0 };
  if (command === 'history') {
    const entries = filterHistory(readHistory(), options).map((entry) => ({
      command: entry.command,
      projectName: entry.projectName,
      projectPath: entry.projectPath,
      projectType: entry.projectType,
      commandLine: entry.commandLine,
      executedAt: entry.executedAt,
    }));
    return { data: entries, exitCode: 0 };
  }
  if (command === 'recipes') return { data: describeRegistry(context.recipeRegistry), exitCode: 0 };
  if (command === 'openers') return { data: describeRegistry(context.openerRegistry), exitCode: 0 };
  if (command === 'devices') {
    return { data: { android: getAndroidDevices(), ios: getIOSDevices() }, exitCode: 0 };
  }
  if (command === 'config') return { data: config, exitCode: 0 };
  throw new Error(`--json is not supported by ${command}.`);
}

function runJson(context) {
  try {
    const { data, exitCode } = collectJson(context);
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    return 1;
  }
}

module.exports = {
  collectJson,
  runJson,
};
