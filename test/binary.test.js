// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const binary = path.join(__dirname, '..', 'dev');

function createNodeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-binary-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'binary-fixture',
    dependencies: { next: '16.0.0' },
    scripts: {
      lint: 'node lint.js',
      test: 'node test.js',
      build: 'node build.js',
    },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  for (const name of ['lint', 'test', 'build']) {
    fs.writeFileSync(path.join(root, `${name}.js`), `console.log("${name}-passed")\n`);
  }
  return root;
}

function isolatedEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-home-'));
  return { ...process.env, HOME: home, USERPROFILE: home };
}

test('binary inspect reports detected project and resolved commands', () => {
  const root = createNodeProject();
  const result = spawnSync(process.execPath, [binary, 'inspect', root], {
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Type: next/);
  assert.match(result.stdout, /Package manager: npm/);
});

test('binary inspect --json reports the resolved quality sequence', () => {
  const root = createNodeProject();
  const result = spawnSync(process.execPath, [binary, 'inspect', root, '--json'], {
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  assert.equal(result.status, 0, result.stderr);
  const inspection = JSON.parse(result.stdout);
  assert.equal(inspection.type, 'next');
  assert.equal(inspection.packageManager, 'npm');
  const check = inspection.actions.find((action) => action.action === 'check');
  assert.deepEqual(check.commands.map((command) => command.args), [
    ['run', 'lint'],
    ['run', 'test'],
    ['run', 'build'],
  ]);
});

test('binary check executes the adapter quality sequence', () => {
  const root = createNodeProject();
  const result = spawnSync(process.execPath, [binary, 'check', root], {
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lint-passed/);
  assert.match(result.stdout, /test-passed/);
  assert.match(result.stdout, /build-passed/);
});
