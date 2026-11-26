// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG_FILE, HISTORY_FILE, PATHS, TRUST_FILE, getPaths } = require('../src/config');
const { createHistoryEntry } = require('../src/commands/history');
const { getExistingProjects, recordProject } = require('../src/projects/recent');
const { appendJsonl, readJson, readJsonl, writeJsonAtomic } = require('../src/store/json-store');
const { fakeClock, tempDir } = require('./helpers');

test('getPaths places every file under one injectable home directory', () => {
  const home = path.join(path.sep, 'fake', 'home');
  const paths = getPaths(home);
  assert.equal(paths.root, path.join(home, '.devcmd'));
  for (const [key, value] of Object.entries(paths)) {
    if (key === 'homeDir') continue;
    assert.ok(value.startsWith(path.join(home, '.devcmd')), `${key}: ${value}`);
  }
  assert.equal(paths.configFile, path.join(home, '.devcmd', 'config.json'));
  assert.equal(paths.aiImportedDir, path.join(home, '.devcmd', 'ai-imported'));
  assert.equal(Object.isFrozen(paths), true);
});

test('the legacy path constants are getPaths() for the real home directory', () => {
  assert.equal(CONFIG_FILE, PATHS.configFile);
  assert.equal(HISTORY_FILE, PATHS.historyFile);
  assert.equal(TRUST_FILE, PATHS.trustFile);
  assert.deepEqual(getPaths(), PATHS);
});

test('history entries and recent projects use an injected clock', () => {
  const clock = fakeClock('2026-03-04T05:06:07.000Z');
  assert.equal(
    createHistoryEntry({ command: 'test' }, [{ executable: 'x', args: [] }], { now: clock.now }).executedAt,
    '2026-03-04T05:06:07.000Z'
  );
  const directory = tempDir('devcmd-clock-');
  const file = path.join(directory, 'projects.json');
  recordProject({ name: 'demo', type: 'node', path: directory }, { file, now: clock.now });
  assert.equal(getExistingProjects({ file })[0].lastUsedAt, '2026-03-04T05:06:07.000Z');
});

test('readJson returns the fallback for missing or invalid files unless strict', () => {
  const directory = tempDir('devcmd-store-read-');
  const file = path.join(directory, 'data.json');
  assert.deepEqual(readJson(file, { fallback: [] }), []);
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(readJson(file, { fallback: { ok: true } }), { ok: true });
  assert.throws(() => readJson(file, { fallback: {}, strict: true }), SyntaxError);
  assert.deepEqual(readJson(path.join(directory, 'missing.json'), { fallback: 1, strict: true }), 1);
});

test('writeJsonAtomic replaces the file through a temporary file and cleans up on failure', () => {
  const directory = tempDir('devcmd-store-write-');
  const file = path.join(directory, 'nested', 'data.json');
  writeJsonAtomic(file, { a: 1 });
  writeJsonAtomic(file, { a: 2 });
  assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "a": 2\n}\n');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['data.json']);

  const failing = { ...fs, renameSync() { throw new Error('rename failed'); } };
  assert.throws(() => writeJsonAtomic(file, { a: 3 }, { fsImpl: failing }), /rename failed/);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['data.json']);
  assert.deepEqual(readJson(file), { a: 2 });
});

test('JSON Lines append, rotate, and skip damaged lines', () => {
  const directory = tempDir('devcmd-store-jsonl-');
  const file = path.join(directory, 'log.jsonl');
  appendJsonl(file, { n: 1 });
  appendJsonl(file, { n: 2 });
  fs.appendFileSync(file, 'not json\n');
  assert.deepEqual(readJsonl(file), [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(readJsonl(file, { limit: 1 }), [{ n: 2 }]);

  appendJsonl(file, { n: 3 }, { maxBytes: 5 });
  assert.deepEqual(readJsonl(file), [{ n: 3 }]);
  assert.deepEqual(readJsonl(`${file}.1`).map((record) => record.n), [1, 2]);
  assert.deepEqual(readJsonl(path.join(directory, 'missing.jsonl')), []);
});

test('runJson prints collected data, awaits asynchronous collectors, and reports errors as JSON', async () => {
  const { registerJsonCollector, runJson } = require('../src/handlers/json');
  const capture = () => {
    const chunks = [];
    return { write: (text) => chunks.push(text), text: () => chunks.join('') };
  };

  registerJsonCollector('async-demo', async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return { data: { value: 42 }, exitCode: 3 };
  });
  const out = capture();
  assert.equal(await runJson({ command: 'async-demo' }, { stdout: out, stderr: capture() }), 3);
  assert.deepEqual(JSON.parse(out.text()), { value: 42 });

  const stderr = capture();
  assert.equal(await runJson({ command: 'unknown-demo' }, { stdout: capture(), stderr }), 1);
  assert.match(JSON.parse(stderr.text()).error, /not supported/);
  assert.throws(() => registerJsonCollector('async-demo', () => ({})), /already registered/);
});
