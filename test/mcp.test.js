// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TOOLS, callTool } = require('../src/mcp/server');
const { ProcessManager } = require('../src/mcp/processes');
const { trustProfile } = require('../src/projects/profile');
const { detectProject } = require('../src/projects/detect');

function text(result) {
  return result.content[0].text;
}

function data(result) {
  return JSON.parse(text(result));
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createNodeProject(scripts = { test: 'node -e "console.log(\'mcp-test-ok\')"' }) {
  const root = tempDir('devcmd-mcp-node-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'mcp-app', scripts }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  return root;
}

test('MCP lifecycle dry run uses configured Python for Python projects', async () => {
  const root = tempDir('devcmd-mcp-python-');
  fs.writeFileSync(path.join(root, 'pyproject.toml'), 'dependencies = ["fastapi>=0.115"]');

  const result = await callTool(
    'run_lifecycle',
    { action: 'run', path: root, dryRun: true },
    { config: { python: 'python3.13' } }
  );

  assert.match(text(result), /python3\.13 -m fastapi dev app\/main\.py/);
  assert.equal(data(result).dryRun, true);
});

test('MCP exposes every tool with an object input schema', () => {
  const names = TOOLS.map((tool) => tool.name);
  for (const name of [
    'inspect_project', 'run_lifecycle', 'run_task', 'start_process', 'get_process_logs',
    'stop_process', 'list_processes', 'scaffold_project', 'list_frameworks', 'doctor',
    'list_devices', 'boot_device', 'get_history',
  ]) {
    assert.ok(names.includes(name), name);
  }
  assert.equal(new Set(names).size, names.length);
  assert.ok(TOOLS.every((tool) => tool.inputSchema.type === 'object' && tool.description));
});

test('MCP run_lifecycle returns structured results and flags failures', async () => {
  const ok = data(await callTool('run_lifecycle', { action: 'test', path: createNodeProject() }, { config: {} }));
  assert.equal(ok.ok, true);
  assert.equal(ok.exitCode, 0);
  assert.match(ok.output, /mcp-test-ok/);

  const failing = createNodeProject({ test: 'node -e "process.exit(3)"' });
  const failure = await callTool('run_lifecycle', { action: 'test', path: failing }, { config: {} });
  assert.equal(failure.isError, true);
  assert.equal(data(failure).exitCode, 3);
});

test('MCP reports errors with isError instead of throwing', async () => {
  const unknown = await callTool('run_lifecycle', { action: 'nope' }, { config: {} });
  assert.equal(unknown.isError, true);
  assert.match(text(unknown), /Unknown action/);
  const missing = await callTool('inspect_project', { path: path.join(os.tmpdir(), 'devcmd-missing-dir') });
  assert.equal(missing.isError, true);
  assert.equal((await callTool('no_such_tool', {})).isError, true);
});

test('MCP inspect_project returns resolved commands, tasks, and workspaces', async () => {
  const root = createNodeProject({ test: 't', seed: 's' });
  const inspection = data(await callTool('inspect_project', { path: root }, { config: { python: 'python3' } }));
  assert.equal(inspection.type, 'node');
  assert.deepEqual(inspection.tasks.map((task) => task.name), ['test', 'seed']);
  assert.match(inspection.actions.find((action) => action.action === 'test').command, /npm run test/);
  assert.deepEqual(inspection.workspaces, []);
});

test('MCP lifecycle supports workspace filters and lint fixes', async () => {
  const root = tempDir('devcmd-mcp-mono-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({
    name: '@acme/web',
    scripts: { lint: 'l', 'lint:fix': 'lf' },
  }));
  const result = data(await callTool(
    'run_lifecycle',
    { action: 'lint', path: root, filter: 'web', fix: true, dryRun: true },
    { config: {} }
  ));
  assert.match(result.command, /npm run lint:fix --workspace @acme\/web/);
});

test('MCP refuses untrusted profile commands and runs trusted tasks', async () => {
  const root = tempDir('devcmd-mcp-profile-');
  const trustFile = path.join(tempDir('devcmd-mcp-trust-'), 'trusted.json');
  fs.writeFileSync(path.join(root, '.devcmd.json'), JSON.stringify({
    tasks: { hi: { commands: [{ type: 'run', executable: 'node', args: ['-e', 'console.log("task-ran")'] }] } },
  }));
  const environment = { config: {}, trustFile };
  const refused = await callTool('run_task', { name: 'hi', path: root }, environment);
  assert.equal(refused.isError, true);
  assert.match(text(refused), /not trusted/);

  trustProfile(detectProject(root).profile, { trustFile });
  const ran = data(await callTool('run_task', { name: 'hi', path: root }, environment));
  assert.equal(ran.ok, true);
  assert.match(ran.output, /task-ran/);
});

test('MCP scaffold_project defaults to a dry run and validates input', async () => {
  const directory = tempDir('devcmd-mcp-scaffold-');
  const result = data(await callTool('scaffold_project', {
    framework: 'next',
    name: 'demo',
    directory,
    packageManager: 'pnpm',
    git: false,
  }));
  assert.equal(result.dryRun, true);
  assert.equal(result.ok, true);
  assert.match(result.output, /pnpm create next-app@latest demo .*--use-pnpm --disable-git/);
  assert.equal(fs.existsSync(path.join(directory, 'demo')), false);
  assert.equal(result.projectPath, path.join(directory, 'demo'));

  const invalid = [
    { framework: 'unknown', name: 'demo' },
    { framework: 'next', name: '../escape' },
    { framework: 'next', name: 'demo', packageManager: 'bun' },
    { framework: 'fastapi', name: 'demo', python: '--evil' },
    { framework: 'next', name: 'demo', directory: path.join(directory, 'missing') },
  ];
  for (const args of invalid) {
    assert.equal((await callTool('scaffold_project', args)).isError, true, JSON.stringify(args));
  }
});

test('MCP list_frameworks includes capabilities', async () => {
  const frameworks = data(await callTool('list_frameworks', {}));
  const next = frameworks.find((framework) => framework.name === 'next');
  assert.ok(next.capabilities);
  assert.equal(next.source, 'built-in');
});

test('MCP doctor and device tools return structured data', async () => {
  const doctor = data(await callTool('doctor', {}, { config: { python: 'python3' } }));
  assert.equal(typeof doctor.ready, 'boolean');
  assert.ok(doctor.tools.some((tool) => tool.name === 'Node.js' && tool.found));
  const invalid = await callTool('boot_device', { platform: 'windows', name: 'x' });
  assert.equal(invalid.isError, true);
  assert.equal((await callTool('boot_device', { platform: 'android', name: '-bad' })).isError, true);
});

function fakeChild(options = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => {
    child.killed = true;
    setImmediate(() => child.emit('close', null, signal));
  };
  setImmediate(() => {
    for (const line of options.lines || []) child.stdout.emit('data', Buffer.from(line));
    if (options.exitCode !== undefined) child.emit('close', options.exitCode, null);
  });
  return child;
}

test('process manager captures logs, tracks exit codes, and trims old output', async () => {
  const manager = new ProcessManager({
    maxLogBytes: 20,
    spawnImpl: (executable) => (executable === 'bad'
      ? fakeChild({ lines: ['failure\n'], exitCode: 2 })
      : fakeChild({ lines: ['line one\n', 'line two\n', 'line three\n'], exitCode: 0 })),
  });
  const good = manager.start({ label: 'good', commands: [{ executable: 'good', args: [] }] });
  await manager.get(good.id).done;
  const logs = manager.logs(good.id, { tail: 1 });
  assert.equal(logs.status, 'exited');
  assert.equal(logs.output, 'line three');
  assert.equal(logs.truncated, true);

  const bad = manager.start({ label: 'bad', commands: [{ executable: 'bad', args: [] }] });
  await manager.get(bad.id).done;
  assert.deepEqual(
    [manager.get(bad.id).status, manager.get(bad.id).exitCode],
    ['failed', 2]
  );
  assert.equal(manager.list().length, 2);
  assert.throws(() => manager.get('p99'), /Unknown process id/);
});

test('process manager stops a running process and runs sequences in order', async () => {
  const started = [];
  const manager = new ProcessManager({
    killGraceMs: 50,
    spawnImpl: (executable) => {
      started.push(executable);
      return executable === 'server' ? fakeChild({ lines: ['listening\n'] }) : fakeChild({ exitCode: 0 });
    },
  });
  const entry = manager.start({
    label: 'seq',
    commands: [{ executable: 'prepare', args: [] }, { executable: 'server', args: [] }],
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(started, ['prepare', 'server']);
  assert.equal(manager.logs(entry.id).status, 'running');
  const stopped = await manager.stop(entry.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal((await manager.stop(entry.id)).status, 'stopped');
});

test('process manager reports missing executables', async () => {
  const manager = new ProcessManager({
    spawnImpl: () => {
      const error = new Error('spawn nope ENOENT');
      error.code = 'ENOENT';
      throw error;
    },
  });
  const entry = manager.start({ label: 'missing', commands: [{ executable: 'nope', args: [] }] });
  assert.equal(manager.get(entry.id).exitCode, 127);
  assert.match(manager.logs(entry.id).output, /ENOENT/);
});

test('MCP background process tools use the supplied manager', async () => {
  const processes = new ProcessManager({
    spawnImpl: () => fakeChild({ lines: ['server ready\n'] }),
    killGraceMs: 50,
  });
  const root = createNodeProject({ dev: 'node server.js' });
  const environment = { config: {}, processes };
  const started = data(await callTool('start_process', { action: 'run', path: root }, environment));
  assert.equal(started.status, 'running');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const logs = data(await callTool('get_process_logs', { id: started.id }, environment));
  assert.match(logs.output, /server ready/);
  assert.equal(data(await callTool('list_processes', {}, environment)).length, 1);
  const stopped = data(await callTool('stop_process', { id: started.id }, environment));
  assert.equal(stopped.status, 'stopped');
  assert.equal((await callTool('get_process_logs', { id: 'p42' }, environment)).isError, true);
  assert.equal((await callTool('start_process', { action: 'open', path: root }, environment)).isError, true);
});
