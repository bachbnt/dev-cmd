// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  buildOpenerCommands,
  loadBuiltInOpeners,
  loadOpenerRegistry,
  resolveOpener,
  validateOpener,
} = require('../src/openers');
const { resolveLifecycleTarget } = require('../src/handlers/lifecycle');

const builtInNames = [
  'vscode',
  'antigravity',
  'cursor',
  'intellij',
  'pycharm',
  'webstorm',
  'android_studio',
  'xcode',
];

function customOpener(name = 'fleet') {
  return {
    name,
    description: 'Custom Fleet opener',
    target: 'project',
    platforms: {
      darwin: { executable: 'open', args: ['-a', 'Fleet', '{target}'] },
      linux: { executable: 'fleet', args: ['{target}'] },
      win32: { executable: 'fleet.exe', args: ['{target}'] },
    },
  };
}

test('built-in opener registry includes IDEs and native aliases', () => {
  const openers = loadBuiltInOpeners();
  assert.deepEqual(openers.map((opener) => opener.name), builtInNames);
  const registry = loadOpenerRegistry({ includeUser: false });
  assert.equal(resolveOpener(registry, 'android').name, 'android_studio');
  assert.equal(resolveOpener(registry, 'ios').name, 'xcode');
});

test('custom opener overrides a built-in by canonical name', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-openers-'));
  const directory = path.join(home, '.devcmd', 'openers');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'vscode.json'), JSON.stringify(customOpener('vscode')));
  const registry = loadOpenerRegistry({ home });
  assert.equal(registry.get('vscode').source, 'user');
  assert.equal(registry.get('cursor').source, 'built-in');
});

test('opener schema rejects shell execution and executable placeholders', () => {
  assert.throws(() => validateOpener({
    ...customOpener(),
    platforms: { darwin: { executable: 'bash', args: ['-c', 'open {target}'] } },
  }), /shell executable/);
  assert.throws(() => validateOpener({
    ...customOpener(),
    platforms: { darwin: { executable: '{target}', args: [] } },
  }), /cannot contain placeholders/);
});

test('Android opener prefers the native android directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-open-android-'));
  fs.mkdirSync(path.join(root, 'android'));
  const opener = resolveOpener(loadOpenerRegistry({ includeUser: false }), 'android');
  assert.deepEqual(buildOpenerCommands(opener, { root }, { platform: 'darwin' }), [{
    executable: 'open',
    args: ['-a', 'Android Studio', path.join(root, 'android')],
  }]);
});

test('Xcode opener selects a workspace and rejects other platforms', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-open-xcode-'));
  fs.mkdirSync(path.join(root, 'ios', 'App.xcworkspace'), { recursive: true });
  const opener = resolveOpener(loadOpenerRegistry({ includeUser: false }), 'ios');
  assert.deepEqual(buildOpenerCommands(opener, { root }, { platform: 'darwin' }), [{
    executable: 'open',
    args: [path.join(root, 'ios', 'App.xcworkspace')],
  }]);
  assert.throws(() => buildOpenerCommands(opener, { root }, { platform: 'linux' }), /not configured/);
});

test('open target parser distinguishes opener names from paths', () => {
  const registry = loadOpenerRegistry({ includeUser: false });
  assert.deepEqual(resolveLifecycleTarget('open', ['cursor', './app'], {}, registry), {
    openerName: 'cursor',
    projectPath: './app',
  });
  assert.deepEqual(resolveLifecycleTarget('open', ['./cursor'], {}, registry), {
    projectPath: './cursor',
  });
  assert.deepEqual(resolveLifecycleTarget('open', ['./app'], { opener: 'pycharm' }, registry), {
    openerName: 'pycharm',
    projectPath: './app',
  });
});

test('custom opener is available to the CLI without source changes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-opener-cli-home-'));
  const directory = path.join(home, '.devcmd', 'openers');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-opener-project-'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'fleet.json'), JSON.stringify(customOpener()));
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'demo', scripts: {} }));

  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'dev'), 'open', 'fleet', project, '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(result.status, 0, result.stderr);
  if (process.platform === 'darwin') assert.match(result.stdout, /open -a Fleet/);
});

test('external opener validation ignores a broken installed opener', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-opener-validate-home-'));
  const installed = path.join(home, '.devcmd', 'openers');
  const external = path.join(home, 'fleet.json');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'broken.json'), '{');
  fs.writeFileSync(external, JSON.stringify(customOpener()));

  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'dev'), 'openers', 'validate', external], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fleet/);
});

test('CLI help lists built-in and custom openers with aliases', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-opener-help-home-'));
  const directory = path.join(home, '.devcmd', 'openers');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'fleet.json'), JSON.stringify(customOpener()));

  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'dev'), 'help'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Openers:/);
  assert.match(result.stdout, /android_studio.*Android Studio native project \(android\)/);
  assert.match(result.stdout, /fleet.*Custom Fleet opener.*\[user\]/);
  assert.match(result.stdout, /--npm, --pnpm, --yarn.*Select package manager/);
});
