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

// Each collector returns `{ data, exitCode }` or a promise of it. New commands follow the same
// split: `collect(context)` gathers data, and the normal handler renders it. `--json` prints the
// collected data as is.
const COLLECTORS = {
  inspect({ positionals, config, recipeRegistry, openerRegistry }) {
    if (positionals.length > 1) throw new Error('Usage: dev inspect [path] --json');
    const project = detectProject(positionals[0] || process.cwd(), { registry: recipeRegistry });
    return { data: inspectProject(project, config, openerRegistry), exitCode: 0 };
  },
  doctor({ config }) {
    const tools = checkTools(config).map(({ name, executable, required, found, path, version, hint }) => ({
      name, executable, required: Boolean(required), found, path, version, hint,
    }));
    const ready = tools.every((tool) => !tool.required || tool.found);
    return { data: { ready, tools }, exitCode: ready ? 0 : 1 };
  },
  projects() {
    return { data: getExistingProjects(), exitCode: 0 };
  },
  history({ options }) {
    const entries = filterHistory(readHistory(), options).map((entry) => ({
      command: entry.command,
      projectName: entry.projectName,
      projectPath: entry.projectPath,
      projectType: entry.projectType,
      commandLine: entry.commandLine,
      executedAt: entry.executedAt,
    }));
    return { data: entries, exitCode: 0 };
  },
  recipes({ recipeRegistry }) {
    return { data: describeRegistry(recipeRegistry), exitCode: 0 };
  },
  openers({ openerRegistry }) {
    return { data: describeRegistry(openerRegistry), exitCode: 0 };
  },
  devices() {
    return { data: { android: getAndroidDevices(), ios: getIOSDevices() }, exitCode: 0 };
  },
  config({ config }) {
    return { data: config, exitCode: 0 };
  },
  async disk(context) {
    const { data, exitCode } = await require('./disk').collectDisk(context);
    return { data, exitCode };
  },
  async prune(context) {
    const { data, exitCode } = await require('./prune').collectPrune(context);
    return { data, exitCode };
  },
  async ai(context) {
    const { data, exitCode } = await require('./ai').collectAi(context);
    return { data, exitCode };
  },
};

function registerJsonCollector(command, collector) {
  if (Object.hasOwn(COLLECTORS, command)) throw new Error(`JSON collector already registered: ${command}`);
  COLLECTORS[command] = collector;
}

function collectJson(context) {
  if (!Object.hasOwn(COLLECTORS, context.command)) {
    throw new Error(`--json is not supported by ${context.command}.`);
  }
  return COLLECTORS[context.command](context);
}

async function runJson(context, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const { data, exitCode } = await collectJson(context);
    stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return exitCode;
  } catch (error) {
    stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    return 1;
  }
}

module.exports = {
  collectJson,
  registerJsonCollector,
  runJson,
};
