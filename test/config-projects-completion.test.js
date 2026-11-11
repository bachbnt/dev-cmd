// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, setConfigValue } = require('../src/config/user');
const { getCompletion } = require('../src/commands/completion');
const { getExistingProjects, recordProject } = require('../src/projects/recent');
const { applyConfigDefaults } = require('../src/cli');
const { builtInOpenerRegistry } = require('../src/openers');

test('user config persists validated defaults', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-config-'));
  const file = path.join(directory, 'config.json');
  assert.equal(loadConfig({ file }).packageManager, 'npm');
  assert.equal(loadConfig({ file }).opener, 'vscode');
  setConfigValue('packageManager', 'pnpm', { file });
  setConfigValue('initializeGit', 'false', { file });
  const config = loadConfig({ file });
  assert.equal(config.packageManager, 'pnpm');
  assert.equal(config.initializeGit, false);
  assert.throws(() => setConfigValue('packageManager', 'pip', { file }), /must be one of/);
});

test('legacy editor config remains usable until an opener is selected', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-editor-config-'));
  const file = path.join(directory, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ editor: 'cursor' }));
  assert.equal(loadConfig({ file }).opener, undefined);
  assert.equal(loadConfig({ file }).editor, 'cursor');
  setConfigValue('opener', 'pycharm', { file });
  const config = loadConfig({ file });
  assert.equal(config.opener, 'pycharm');
  assert.equal(config.editor, undefined);
});

test('recent projects are deduplicated and ordered by latest use', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-projects-'));
  const file = path.join(directory, 'projects.json');
  const first = path.join(directory, 'first');
  const second = path.join(directory, 'second');
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  recordProject({ name: 'first', type: 'next', path: first }, { file });
  recordProject({ name: 'second', type: 'fastapi', path: second }, { file });
  recordProject({ name: 'first', type: 'next', path: first }, { file });
  assert.deepEqual(getExistingProjects({ file }).map((project) => project.name), ['first', 'second']);
});

test('completion generators include lifecycle and framework commands', () => {
  const zsh = getCompletion('zsh', undefined, builtInOpenerRegistry);
  const bash = getCompletion('bash', undefined, builtInOpenerRegistry);
  assert.match(zsh, /doctor/);
  assert.match(zsh, /inspect/);
  assert.match(zsh, /check/);
  assert.match(zsh, /fastapi/);
  assert.match(zsh, /react_native_cli/);
  assert.match(zsh, /recipes/);
  assert.match(zsh, /openers/);
  assert.match(zsh, /android_studio/);
  assert.match(zsh, /antigravity/);
  for (const name of ['lint', 'format', 'outdated', 'upgrade', 'audit', 'task', 'parallel', 'trust', 'env', 'docker']) {
    assert.match(bash, new RegExp(`\\b${name}\\b`), name);
  }
  for (const option of ['--filter', '--fix', '--json', '--search', '--yes']) {
    assert.match(zsh, new RegExp(option), option);
  }
  assert.match(zsh, /#compdef dev devcmd/);
  assert.match(zsh, /compdef _devcmd dev devcmd/);
  assert.match(bash, /complete -F _devcmd_completion dev devcmd/);
  assert.throws(() => getCompletion('fish'), /supports/);
});

test('config defaults apply to direct scaffold commands', () => {
  const options = { packageManager: undefined, git: undefined, python: undefined };
  applyConfigDefaults('fastapi', options, {
    packageManager: 'pnpm',
    initializeGit: false,
    python: 'python3.13',
  });
  assert.equal(options.git, false);
  assert.equal(options.python, 'python3.13');
  assert.equal(options.packageManager, undefined);
});
