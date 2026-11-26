// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { COMMANDS, getCommand } = require('../src/cli/commands');
const { OPTION_DEFS, completionOptions, helpOptions, parseArgs, validateCommandFlags } = require('../src/cli/options');
const { printHelp } = require('../src/cli/help');
const { getCompletion } = require('../src/commands/completion');
const { builtInOpenerRegistry } = require('../src/openers');
const { frameworkDefinitions } = require('../src/config');
const constants = require('../src/constants');

const root = path.join(__dirname, '..');
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

function captureHelp() {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  try {
    const pc = new Proxy({}, { get: () => (text) => text });
    printHelp(pc, frameworkDefinitions, builtInOpenerRegistry);
  } finally {
    console.log = original;
  }
  return stripAnsi(lines.join('\n'));
}

test('the command registry has unique names, descriptions, and resolvable handlers', () => {
  const names = COMMANDS.map((command) => command.name);
  assert.equal(new Set(names).size, names.length);
  for (const command of COMMANDS) {
    assert.ok(command.description, `${command.name} needs a description`);
    assert.ok(['lifecycle', 'device', 'system'].includes(command.kind), command.name);
    if (command.name === 'completion') continue;
    assert.equal(typeof command.handler?.(), 'function', `${command.name} handler`);
  }
  assert.equal(getCommand('test').kind, 'lifecycle');
  assert.equal(getCommand('nope'), undefined);
});

test('constants are derived from the registry', () => {
  const byKind = (kind) => COMMANDS.filter((command) => command.kind === kind).map((command) => command.name);
  assert.deepEqual(constants.LIFECYCLE_COMMANDS, byKind('lifecycle'));
  assert.deepEqual(constants.DEVICE_COMMANDS, byKind('device'));
  assert.deepEqual(constants.SYSTEM_COMMANDS, byKind('system'));
  assert.deepEqual(constants.JSON_COMMANDS, COMMANDS.filter((command) => command.json).map((command) => command.name));
  assert.deepEqual(constants.FILTER_COMMANDS, COMMANDS.filter((command) => command.filter).map((command) => command.name));
});

test('help lists every visible command and every documented option', () => {
  const help = captureHelp();
  for (const command of COMMANDS.filter((entry) => entry.section)) {
    assert.match(help, new RegExp(`^  ${command.name}\\s`, 'm'), `help is missing ${command.name}`);
  }
  for (const { flags } of helpOptions()) assert.ok(help.includes(flags), `help is missing ${flags}`);
});

test('completion offers every registered command and every option', () => {
  for (const shell of ['bash', 'zsh']) {
    const script = getCompletion(shell, frameworkDefinitions, builtInOpenerRegistry);
    for (const command of COMMANDS) assert.ok(script.includes(command.name), `${shell} completion is missing ${command.name}`);
    for (const option of completionOptions()) assert.ok(script.includes(option), `${shell} completion is missing ${option}`);
  }
});

test('option definitions are consistent', () => {
  const spellings = OPTION_DEFS.flatMap((definition) => definition.names);
  assert.equal(new Set(spellings).size, spellings.length, 'every spelling belongs to one definition');
  const commandNames = new Set(COMMANDS.map((command) => command.name));
  for (const definition of OPTION_DEFS) {
    for (const command of definition.onlyFor || []) assert.ok(commandNames.has(command), `${definition.names[0]} -> ${command}`);
    assert.ok(definition.names.every((name) => name.startsWith('-')), definition.names.join());
  }
  const json = OPTION_DEFS.find((definition) => definition.key === 'json');
  assert.deepEqual(json.onlyFor, constants.JSON_COMMANDS);
});

test('flag restrictions report the commands that accept them', () => {
  const check = (argv) => {
    const { command, options } = parseArgs(argv);
    validateCommandFlags(command, options, frameworkDefinitions);
  };
  assert.throws(() => check(['android', '--shutdown-all']), /--shutdown-all is only supported by the ios command\./);
  assert.throws(() => check(['build', '--json']), /--json is only supported by: doctor, inspect, projects, /);
  assert.throws(() => check(['install', '--filter', 'web']), /--filter is only supported by: run, test, build, check, lint, format, task\./);
  assert.throws(() => check(['open', '--editor', 'x', '--with', 'y']), /cannot be used together/);
  assert.throws(() => check(['build', '--pnpm']), /Project preset options can only be used with framework commands\./);
  assert.doesNotThrow(() => check(['next', 'app', '--pnpm', '--set', 'a=b']));
});

test('every spelling of a flag parses to the same option', () => {
  assert.equal(parseArgs(['x', '--ts']).options.typescript, true);
  assert.equal(parseArgs(['x', '--js']).options.typescript, false);
  assert.equal(parseArgs(['x', '--yarn']).options.packageManager, 'yarn');
  assert.equal(parseArgs(['x', '--pm', 'pnpm']).options.packageManager, 'pnpm');
  assert.equal(parseArgs(['x', '--install']).options.noInstall, false);
  assert.equal(parseArgs(['x', '--no-install']).options.noInstall, true);
  assert.throws(() => parseArgs(['x', '--pm', 'bun']), /Package manager must be one of/);
  assert.throws(() => parseArgs(['x', '--set', 'bad']), /--set requires name=value/);
  assert.throws(() => parseArgs(['x', '--nope']), /Unsupported option: --nope/);
});

test('startup does not load handler code, the MCP SDK, or the prompt library', () => {
  const script = `
    const { main } = require('./src/cli');
    main(['help']).then(() => {
      const loaded = Object.keys(require.cache);
      process.stderr.write(JSON.stringify({
        mcpSdk: loaded.some((file) => file.includes('modelcontextprotocol')),
        mcpTools: loaded.some((file) => file.endsWith('mcp/tools.js')),
        handlers: loaded.filter((file) => /src[\\\\/]handlers[\\\\/]/.test(file)).length,
      }));
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stderr), { mcpSdk: false, mcpTools: false, handlers: 0 });
});
