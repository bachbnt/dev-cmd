// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildLifecycleCommands, buildOpenCommands } = require('../src/commands/lifecycle');

const nodeProject = {
  type: 'next',
  name: 'site',
  root: '/tmp/site',
  packageManager: 'pnpm',
  packageJson: { scripts: { dev: 'next dev', test: 'node --test', build: 'next build' } },
};

test('Node lifecycle uses detected package manager and project cwd', () => {
  assert.deepEqual(buildLifecycleCommands('install', nodeProject), [
    { executable: 'pnpm', args: ['install'], cwd: '/tmp/site' },
  ]);
  assert.deepEqual(buildLifecycleCommands('run', nodeProject), [
    { executable: 'pnpm', args: ['run', 'dev'], cwd: '/tmp/site' },
  ]);
  assert.deepEqual(buildLifecycleCommands('build', nodeProject), [
    { executable: 'pnpm', args: ['run', 'build'], cwd: '/tmp/site' },
  ]);
});

test('Node lifecycle reports missing scripts clearly', () => {
  assert.throws(
    () => buildLifecycleCommands('test', { ...nodeProject, packageJson: { scripts: {} } }),
    /Expected: test/
  );
});

test('Node check runs available quality scripts in order', () => {
  const commands = buildLifecycleCommands('check', {
    ...nodeProject,
    packageJson: { scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'node --test', build: 'next build' } },
  });
  assert.deepEqual(commands.map((command) => command.args), [
    ['run', 'lint'],
    ['run', 'typecheck'],
    ['run', 'test'],
    ['run', 'build'],
  ]);
});

test('Python lifecycle uses configured Python when no virtual environment exists', () => {
  const project = { type: 'fastapi', name: 'api', root: '/tmp/not-a-real-api' };
  assert.deepEqual(buildLifecycleCommands('run', project, { config: { python: 'python3.13' } }), [
    {
      executable: 'python3.13',
      args: ['-m', 'fastapi', 'dev', 'app/main.py'],
      cwd: '/tmp/not-a-real-api',
    },
  ]);
});

test('Python install creates a virtual environment before installing dependencies', () => {
  const project = { type: 'flask', name: 'app', root: '/tmp/not-a-real-flask-app' };
  const commands = buildLifecycleCommands('install', project, { config: { python: 'python3.13' } });
  assert.deepEqual(commands[0], {
    executable: 'python3.13',
    args: ['-m', 'venv', '.venv'],
    cwd: '/tmp/not-a-real-flask-app',
  });
  assert.match(commands[1].executable, /\.venv.*python/);
  assert.deepEqual(commands[1].args, ['-m', 'pip', 'install', '-e', '.[dev]']);
});

test('Python check runs ruff when configured, then tests and build', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-python-check-'));
  fs.writeFileSync(path.join(root, 'pyproject.toml'), '[tool.ruff]\n');
  const commands = buildLifecycleCommands(
    'check',
    { type: 'fastapi', name: 'api', root },
    { config: { python: 'python3' } }
  );
  assert.deepEqual(commands.map((command) => command.args), [
    ['-m', 'ruff', 'check', '.'],
    ['-m', 'pytest'],
    ['-m', 'build'],
  ]);
});

test('Android and iOS lifecycle use native build tools', () => {
  assert.deepEqual(
    buildLifecycleCommands('build', { type: 'android', root: '/tmp/android' }),
    [{ executable: './gradlew', args: ['assembleDebug'], cwd: '/tmp/android' }]
  );
  assert.deepEqual(
    buildLifecycleCommands('build', {
      type: 'ios',
      root: '/tmp/ios',
      xcode: { kind: 'project', file: 'App.xcodeproj' },
    }),
    [{ executable: 'xcodebuild', args: ['-project', 'App.xcodeproj', 'build'], cwd: '/tmp/ios' }]
  );
});

test('Flutter and Android check use native quality tasks', () => {
  assert.deepEqual(
    buildLifecycleCommands('check', { type: 'flutter', root: '/tmp/flutter' }).map((command) => command.args),
    [['analyze'], ['test']]
  );
  assert.deepEqual(
    buildLifecycleCommands('check', { type: 'android', root: '/tmp/android' })[0].args,
    ['lint', 'test']
  );
});

test('clean falls back to the internal safe cleaner', () => {
  const command = buildLifecycleCommands('clean', nodeProject)[0];
  assert.equal(command.executable, process.execPath);
  assert.match(command.args[0], /clean-project\.js$/);
  assert.deepEqual(command.args.slice(1), ['/tmp/site', 'next']);
});

test('Python clean removes caches without traversing dependency directories', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-python-clean-'));
  fs.mkdirSync(path.join(root, 'app', '__pycache__'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg', '__pycache__'), { recursive: true });
  fs.mkdirSync(path.join(root, '.ruff_cache'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app', '__pycache__', 'module.pyc'), '');
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', '__pycache__', 'module.pyc'), '');

  const command = buildLifecycleCommands(
    'clean',
    { type: 'fastapi', name: 'api', root },
    { config: { python: 'python3' } }
  )[0];
  const result = spawnSync(command.executable, command.args, { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(root, 'app', '__pycache__')), false);
  assert.equal(fs.existsSync(path.join(root, '.ruff_cache')), false);
  assert.equal(fs.existsSync(path.join(root, 'node_modules', 'pkg', '__pycache__')), true);
});

test('open supports configured editor and platform applications', () => {
  assert.deepEqual(buildOpenCommands(nodeProject, undefined, { editor: 'cursor' }), [
    { executable: 'cursor', args: ['/tmp/site'] },
  ]);
  if (process.platform === 'darwin') {
    assert.deepEqual(buildOpenCommands(nodeProject, 'android', { editor: 'code' }), [
      { executable: 'open', args: ['-a', 'Android Studio', '/tmp/site'] },
    ]);
  }
});

test('open uses the configured built-in opener', () => {
  const command = buildOpenCommands(nodeProject, undefined, { opener: 'vscode' })[0];
  if (process.platform === 'darwin') {
    assert.deepEqual(command, {
      executable: 'open',
      args: ['-a', 'Visual Studio Code', '/tmp/site'],
    });
  } else {
    assert.equal(command.executable, 'code');
    assert.deepEqual(command.args, ['/tmp/site']);
  }
});

test('open ios finds a React Native Xcode workspace in the ios directory', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-open-ios-'));
  fs.mkdirSync(path.join(root, 'ios', 'App.xcworkspace'), { recursive: true });
  assert.deepEqual(
    buildOpenCommands({ ...nodeProject, root }, 'ios', { editor: 'code' }, undefined, { platform: 'darwin' }),
    [{ executable: 'open', args: [path.join(root, 'ios', 'App.xcworkspace')] }]
  );
});
