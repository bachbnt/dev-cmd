// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isInside, isTracked, listTrackedFiles } = require('../src/disk/safety');
const { tempDir, writeFile } = require('./helpers');

const cleaner = path.join(__dirname, '..', 'src', 'generators', 'clean-project.js');

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function runClean(root, type) {
  const result = spawnSync(process.execPath, [cleaner, root, type], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('isInside compares resolved paths', () => {
  const root = path.resolve('project');
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, path.join(root, 'dist', 'a.js')), true);
  assert.equal(isInside(root, path.join(root, '..', 'other')), false);
  assert.equal(isInside(root, path.join(root, '..', 'project-sibling')), false);
});

test('isTracked matches files and directories that contain tracked files', () => {
  const tracked = ['dist/index.js', 'src/app.js', 'android/app/build/keep.txt'];
  assert.equal(isTracked(tracked, 'dist'), true);
  assert.equal(isTracked(tracked, 'dist/'), true);
  assert.equal(isTracked(tracked, 'src/app.js'), true);
  assert.equal(isTracked(tracked, path.join('android', 'app', 'build')), true);
  assert.equal(isTracked(tracked, 'distance'), false);
  assert.equal(isTracked(tracked, 'coverage'), false);
  assert.equal(isTracked(undefined, 'dist'), false);
});

test('listTrackedFiles reports unknown outside a repository and tracked files inside one', () => {
  const plain = tempDir('devcmd-safety-plain-');
  assert.equal(listTrackedFiles(plain, { spawnSync: () => ({ status: 128, stdout: '' }) }), undefined);
  assert.equal(listTrackedFiles(plain, { spawnSync: () => ({ error: new Error('ENOENT') }) }), undefined);

  const repo = tempDir('devcmd-safety-repo-');
  git(repo, 'init', '-q');
  writeFile(path.join(repo, 'dist', 'a.js'), 'x');
  writeFile(path.join(repo, 'notes.txt'), 'x');
  git(repo, 'add', 'dist/a.js');
  assert.deepEqual(listTrackedFiles(repo), ['dist/a.js']);
});

test('dev clean keeps directories that contain files Git tracks and removes the rest', () => {
  const root = tempDir('devcmd-clean-tracked-');
  git(root, 'init', '-q');
  writeFile(path.join(root, 'package.json'), { name: 'app' });
  writeFile(path.join(root, 'dist', 'committed.js'), 'keep');
  writeFile(path.join(root, 'dist', 'generated.js'), 'also kept, same directory');
  writeFile(path.join(root, 'coverage', 'lcov.info'), 'remove');
  writeFile(path.join(root, 'build', 'out.js'), 'remove');
  git(root, 'add', 'dist/committed.js');

  const output = runClean(root, 'node');
  assert.match(output, /Skipped dist: it contains files tracked by Git\./);
  assert.equal(fs.existsSync(path.join(root, 'dist', 'committed.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'dist', 'generated.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'coverage')), false);
  assert.equal(fs.existsSync(path.join(root, 'build')), false);
});

test('dev clean works as before outside a Git repository', () => {
  const root = tempDir('devcmd-clean-plain-');
  writeFile(path.join(root, 'package.json'), { name: 'app' });
  writeFile(path.join(root, 'dist', 'a.js'), 'x');
  writeFile(path.join(root, '.cache', 'b'), 'x');
  const output = runClean(root, 'node');
  assert.equal(output, '');
  assert.equal(fs.existsSync(path.join(root, 'dist')), false);
  assert.equal(fs.existsSync(path.join(root, '.cache')), false);
});

test('dev clean keeps tracked Python caches and removes untracked ones', () => {
  const root = tempDir('devcmd-clean-python-');
  git(root, 'init', '-q');
  writeFile(path.join(root, 'pyproject.toml'), 'name = "x"');
  writeFile(path.join(root, 'pkg', '__pycache__', 'kept.pyc'), 'tracked');
  writeFile(path.join(root, 'pkg', '__pycache__', 'also.pyc'), 'same directory');
  writeFile(path.join(root, 'pkg', 'mod.pyc'), 'untracked');
  writeFile(path.join(root, 'other', '__pycache__', 'x.pyc'), 'untracked');
  writeFile(path.join(root, '.pytest_cache', 'v'), 'untracked');
  git(root, 'add', 'pkg/__pycache__/kept.pyc');

  runClean(root, 'fastapi');
  assert.equal(fs.existsSync(path.join(root, 'pkg', '__pycache__', 'kept.pyc')), true);
  assert.equal(fs.existsSync(path.join(root, 'pkg', 'mod.pyc')), false);
  assert.equal(fs.existsSync(path.join(root, 'other', '__pycache__')), false);
  assert.equal(fs.existsSync(path.join(root, '.pytest_cache')), false);
});
