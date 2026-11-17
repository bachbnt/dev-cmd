// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertExecutables, findExecutable } = require('../src/runner/check');

test('findExecutable searches PATH without a shell', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-path-'));
  const windows = process.platform === 'win32';
  const executable = path.join(directory, windows ? 'my-tool.cmd' : 'my-tool');
  fs.writeFileSync(executable, windows ? '@echo off\r\n' : '#!/bin/sh\n');
  if (!windows) fs.chmodSync(executable, 0o755);
  const found = findExecutable('my-tool', { env: { PATH: directory } });
  assert.equal(windows ? found.toLowerCase() : found, windows ? executable.toLowerCase() : executable);
  assert.equal(findExecutable('missing', { env: { PATH: directory } }), undefined);
});

test('assertExecutables reports all missing dependencies', () => {
  assert.throws(
    () => assertExecutables(['missing-a', 'missing-b'], { env: { PATH: '' } }),
    /missing-a, missing-b/
  );
});
