// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildDockerCommands } = require('../src/commands/docker');
const { checkEnv, initEnv, parseEnvKeys } = require('../src/commands/env');
const { filterHistory } = require('../src/commands/history');
const { collectJson } = require('../src/handlers/json');
const { checkTools } = require('../src/runner/check');
const { createLinePrefixer, runParallel } = require('../src/runner/parallel');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('env keys are parsed without reading values', () => {
  assert.deepEqual(
    parseEnvKeys('# comment\nA=1\nexport B = two\n\n  C=\nnot a key\n1BAD=x\n'),
    ['A', 'B', 'C']
  );
});

test('env init copies the template once and never overwrites', () => {
  const root = tempDir('devcmd-env-');
  assert.throws(() => initEnv(root), /No \.env\.example/);
  fs.writeFileSync(path.join(root, '.env.example'), 'A=1\nB=2\n');
  assert.equal(initEnv(root).created, true);
  fs.writeFileSync(path.join(root, '.env'), 'A=secret\n');
  assert.equal(initEnv(root).created, false);
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'A=secret\n');
});

test('env check reports missing and extra variables', () => {
  const root = tempDir('devcmd-env-check-');
  fs.writeFileSync(path.join(root, '.env.example'), 'A=1\nB=2\nC=3\n');
  assert.throws(() => checkEnv(root), /\.env does not exist/);
  fs.writeFileSync(path.join(root, '.env'), 'A=x\nZ=y\n');
  assert.deepEqual(checkEnv(root), {
    template: '.env.example',
    missing: ['B', 'C'],
    extra: ['Z'],
    ok: false,
  });
});

test('docker commands use compose with discrete arguments', () => {
  const root = tempDir('devcmd-docker-');
  assert.throws(() => buildDockerCommands('up', root), /No Compose file/);
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'services: {}\n');
  assert.deepEqual(buildDockerCommands('up', root), [{
    executable: 'docker',
    args: ['compose', '--file', 'docker-compose.yml', 'up', '-d'],
    cwd: root,
  }]);
  assert.deepEqual(buildDockerCommands('logs', root)[0].args.slice(-3), ['--follow', '--tail', '100']);
  assert.throws(() => buildDockerCommands('rm -rf /', root), /Usage: dev docker/);
});

test('history filter combines project and text search', () => {
  const history = [
    { command: 'next', projectName: 'site', projectPath: '/a', commandLine: 'npx create-next-app site' },
    { command: 'test', projectName: 'api', projectPath: '/b', commandLine: 'npm run test' },
  ];
  assert.equal(filterHistory(history, { search: 'NEXT' }).length, 1);
  assert.equal(filterHistory(history, { project: '/b' })[0].projectName, 'api');
  assert.equal(filterHistory(history, { project: '/b', search: 'next' }).length, 0);
  assert.equal(filterHistory(history).length, 2);
});

test('doctor reports install hints for tools', () => {
  const tools = checkTools({ python: 'python3' }, { env: { PATH: '' } });
  assert.ok(tools.every((tool) => !tool.found));
  assert.ok(tools.every((tool) => typeof tool.hint === 'string' && tool.hint));
});

test('JSON output exposes structured data and a doctor exit code', () => {
  const config = { python: 'python3', opener: 'vscode' };
  assert.deepEqual(collectJson({ command: 'config', config, positionals: [], options: {} }).data, config);
  const doctor = collectJson({ command: 'doctor', config, positionals: [], options: {} });
  assert.equal(typeof doctor.data.ready, 'boolean');
  assert.equal(doctor.exitCode, doctor.data.ready ? 0 : 1);
  assert.throws(() => collectJson({ command: 'build', config, positionals: [], options: {} }), /not supported/);
});

function fakeChild({ lines = [], code = 0, delay = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = (signal) => {
    child.killed = true;
    setImmediate(() => child.emit('close', null, signal));
  };
  setTimeout(() => {
    for (const line of lines) child.stdout.emit('data', Buffer.from(line));
    if (!child.killed) child.emit('close', code, null);
  }, delay);
  return child;
}

test('line prefixer buffers partial lines', () => {
  const output = [];
  const prefixer = createLinePrefixer('web', (text) => output.push(text));
  prefixer.push('hel');
  prefixer.push('lo\nwor');
  prefixer.flush();
  assert.deepEqual(output, ['[web] hello\n', '[web] wor\n']);
});

test('parallel runner prefixes output and reports the first failure', async () => {
  const output = [];
  const results = await runParallel([
    { label: 'web', commands: [{ executable: 'a', args: [] }, { executable: 'b', args: [] }] },
    { label: 'api', commands: [{ executable: 'c', args: [] }] },
  ], {
    write: (text) => output.push(text),
    signalSource: new EventEmitter(),
    spawnImpl: (executable) => {
      if (executable === 'c') return fakeChild({ lines: ['boom\n'], code: 3 });
      return fakeChild({ lines: [`${executable}\n`] });
    },
  });
  assert.equal(results.ok, false);
  assert.equal(results.exitCode, 3);
  assert.deepEqual(results.results.map((entry) => [entry.label, entry.ok]), [['web', true], ['api', false]]);
  assert.ok(output.includes('[web] a\n'));
  assert.ok(output.includes('[web] b\n'));
  assert.ok(output.includes('[api] boom\n'));
});

test('parallel runner forwards SIGINT to every child', async () => {
  const signalSource = new EventEmitter();
  const children = [];
  const running = runParallel([
    { label: 'one', commands: [{ executable: 'x', args: [] }] },
    { label: 'two', commands: [{ executable: 'y', args: [] }] },
  ], {
    write() {},
    signalSource,
    spawnImpl: () => {
      const child = fakeChild({ delay: 1000 });
      children.push(child);
      return child;
    },
  });
  setTimeout(() => signalSource.emit('SIGINT'), 10);
  const result = await running;
  assert.equal(children.length, 2);
  assert.ok(children.every((child) => child.killed));
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 130);
});

test('parallel runner reports missing executables', async () => {
  const result = await runParallel([{ label: 'x', commands: [{ executable: 'nope', args: [] }] }], {
    write() {},
    signalSource: new EventEmitter(),
    spawnImpl: () => {
      const error = new Error('spawn nope ENOENT');
      error.code = 'ENOENT';
      throw error;
    },
  });
  assert.equal(result.exitCode, 127);
});
