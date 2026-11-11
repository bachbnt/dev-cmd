// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildLifecycleCommands } = require('../src/commands/lifecycle');
const { detectProject } = require('../src/projects/detect');
const { findWorkspaces, resolveWorkspace } = require('../src/projects/workspaces');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

function createMonorepo(manager = 'npm') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-workspaces-'));
  write(path.join(root, 'package.json'), {
    name: 'mono',
    workspaces: manager === 'pnpm' ? undefined : ['apps/*'],
    scripts: { test: 'root-test' },
  });
  if (manager === 'pnpm') {
    write(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'  # apps\n  - '!apps/ignored'\n");
    write(path.join(root, 'pnpm-lock.yaml'), '');
  }
  if (manager === 'yarn') write(path.join(root, 'yarn.lock'), '');
  write(path.join(root, 'apps', 'web', 'package.json'), {
    name: '@acme/web',
    scripts: { dev: 'web', test: 'web-test', lint: 'l', 'lint:fix': 'lf', build: 'b' },
  });
  write(path.join(root, 'apps', 'api', 'package.json'), { name: '@acme/api', scripts: { test: 'api-test' } });
  return root;
}

test('workspaces are discovered from package.json and pnpm-workspace.yaml', () => {
  for (const manager of ['npm', 'pnpm']) {
    const root = createMonorepo(manager);
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const names = findWorkspaces(root, packageJson).map((workspace) => workspace.name).sort();
    assert.deepEqual(names, ['@acme/api', '@acme/web'], manager);
  }
});

test('workspace filter resolves by name, directory, or basename', () => {
  const project = detectProject(createMonorepo());
  assert.equal(resolveWorkspace(project, '@acme/web').dir, 'apps/web');
  assert.equal(resolveWorkspace(project, 'apps/api').name, '@acme/api');
  assert.equal(resolveWorkspace(project, 'web').name, '@acme/web');
  assert.throws(() => resolveWorkspace(project, 'missing'), /Workspace not found/);
  assert.throws(() => resolveWorkspace({ workspaces: [] }, 'web'), /no workspaces were detected/);
});

test('node adapter targets one workspace with each package manager', () => {
  const expected = {
    npm: ['npm', ['run', 'test', '--workspace', '@acme/web']],
    pnpm: ['pnpm', ['--filter', '@acme/web', 'run', 'test']],
    yarn: ['yarn', ['workspace', '@acme/web', 'run', 'test']],
  };
  for (const manager of Object.keys(expected)) {
    const project = detectProject(createMonorepo(manager));
    const [command] = buildLifecycleCommands('test', project, { config: {}, filter: 'web' });
    assert.equal(command.executable, expected[manager][0], manager);
    assert.deepEqual(command.args, expected[manager][1], manager);
    assert.equal(command.cwd, project.root);
  }
});

test('workspace filter checks scripts of the selected workspace only', () => {
  const project = detectProject(createMonorepo());
  assert.throws(
    () => buildLifecycleCommands('build', project, { config: {}, filter: 'api' }),
    /in workspace @acme\/api/
  );
  assert.throws(
    () => buildLifecycleCommands('install', project, { config: {}, filter: 'web' }),
    /--filter is not supported by dev install/
  );
  const check = buildLifecycleCommands('check', project, { config: {}, filter: 'web' });
  assert.deepEqual(check.map((command) => command.args[1]), ['lint', 'test', 'build']);
});

test('lint --fix uses the lint:fix script and rejects other actions', () => {
  const project = detectProject(createMonorepo());
  const [fix] = buildLifecycleCommands('lint', project, { config: {}, filter: 'web', fix: true });
  assert.equal(fix.args[1], 'lint:fix');
  assert.throws(
    () => buildLifecycleCommands('test', project, { config: {}, fix: true }),
    /--fix is only supported by the lint command/
  );
  assert.throws(
    () => buildLifecycleCommands('lint', project, { config: {}, filter: 'api' }),
    /Expected: lint/
  );
});

test('dependency lifecycle actions resolve per package manager', () => {
  const run = (manager, action, extra = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-deps-'));
    write(path.join(root, 'package.json'), { name: 'app', scripts: { format: 'prettier --write .' } });
    if (extra.berry) write(path.join(root, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
    const project = { ...detectProject(root), packageManager: manager };
    return buildLifecycleCommands(action, project, { config: {} })[0];
  };
  assert.deepEqual(run('npm', 'outdated').args, ['outdated']);
  assert.deepEqual(run('npm', 'upgrade').args, ['update']);
  assert.deepEqual(run('pnpm', 'upgrade').args, ['update']);
  assert.deepEqual(run('yarn', 'upgrade').args, ['upgrade']);
  assert.deepEqual(run('npm', 'audit').args, ['audit']);
  assert.deepEqual(run('yarn', 'audit').args, ['audit']);
  assert.deepEqual(run('yarn', 'audit', { berry: true }).args, ['npm', 'audit']);
  assert.deepEqual(run('npm', 'format').args, ['run', 'format']);
});

test('Python and Flutter adapters provide lint, format, and dependency actions', () => {
  const python = { type: 'fastapi', root: '/tmp/api' };
  const config = { python: 'python3.13' };
  const args = (action, context = {}) =>
    buildLifecycleCommands(action, python, { config, ...context })[0].args;
  assert.deepEqual(args('lint', { fix: true }), ['-m', 'ruff', 'check', '--fix', '.']);
  assert.deepEqual(args('format'), ['-m', 'ruff', 'format', '.']);
  assert.deepEqual(args('outdated'), ['-m', 'pip', 'list', '--outdated']);
  assert.deepEqual(args('audit'), ['-m', 'pip_audit']);

  const flutter = { type: 'flutter', root: '/tmp/app' };
  assert.deepEqual(buildLifecycleCommands('lint', flutter, { config })[0].args, ['analyze']);
  const format = buildLifecycleCommands('format', flutter, { config })[0];
  assert.equal(format.executable, 'dart');
  assert.deepEqual(buildLifecycleCommands('upgrade', flutter, { config })[0].args, ['pub', 'upgrade']);
  assert.throws(() => buildLifecycleCommands('audit', flutter, { config }), /not supported/);
});

test('filter is rejected for non-Node projects', () => {
  assert.throws(
    () => buildLifecycleCommands('test', { type: 'flutter', root: '/tmp/app' }, { config: {}, filter: 'web' }),
    /--filter requires a Node\.js workspace project/
  );
});
