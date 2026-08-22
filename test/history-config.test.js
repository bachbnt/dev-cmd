// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VERSION } = require('../src/config');
const { version } = require('../package.json');
const {
  createHistoryEntry,
  getHistoryDisplay,
  readHistory,
  saveHistory,
} = require('../src/commands/history');
const { rebuildHistoryCommands } = require('../src/cli');
const { buildNotificationCommand } = require('../src/runtime/execute');

test('version is sourced from package.json', () => {
  assert.equal(VERSION, version);
});

test('history stores structured commands and reads them back', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-test-'));
  const file = path.join(directory, 'history.json');
  const commands = [{ executable: 'npm', args: ['create', 'vite@latest', 'app'] }];
  const entry = createHistoryEntry({ command: 'react', target: 'app' }, commands);
  saveHistory(entry, { file });
  const history = readHistory({ file });
  assert.deepEqual(history[0].commands, commands);
  assert.equal(getHistoryDisplay(history[0]), 'npm create vite@latest app');
});

test('legacy structured metadata can be rebuilt without executing its shell string', () => {
  const commands = rebuildHistoryCommands({
    command: 'react',
    target: 'legacy-app',
    options: { packageManager: 'npm', typescript: true, git: false },
    commandLine: 'unsafe legacy shell text',
  });
  assert.deepEqual(commands, [
    {
      executable: 'npm',
      args: [
        'create',
        'vite@latest',
        'legacy-app',
        '--',
        '--template',
        'react-ts',
        '--no-interactive',
      ],
    },
  ]);
});

test('legacy shell-only history is refused', () => {
  assert.throws(
    () => rebuildHistoryCommands({ commandLine: 'echo unsafe && rm -rf something' }),
    /cannot be replayed safely/
  );
});

test('macOS notification passes untrusted text as an osascript argument', () => {
  const message = 'dev build "quoted" \\ text';
  const command = buildNotificationCommand(message, 'darwin');
  assert.equal(command.executable, 'osascript');
  assert.equal(command.args.at(-1), message);
  assert.equal(command.args.slice(0, -1).some((arg) => arg.includes(message)), false);
});
