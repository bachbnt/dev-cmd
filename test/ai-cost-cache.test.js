// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scan } = require('../src/ai/scan');
const { tempDir, writeFile } = require('./helpers');

function claudeLine(id, tokens, time = '2026-11-02T10:00:00Z') {
  return JSON.stringify({
    type: 'assistant', timestamp: time, cwd: '/w/app', sessionId: 's', requestId: `r${id}`,
    message: { id: `m${id}`, model: 'claude-sonnet-5-5', usage: { input_tokens: tokens, output_tokens: 1 } },
  });
}

function setup() {
  const root = tempDir();
  const dir = path.join(root, 'claude');
  const log = path.join(dir, 'p', 'a.jsonl');
  return {
    root, dir, log, cacheFile: path.join(root, 'cache.json'), dirs: { claude: dir, codex: path.join(root, 'none') },
  };
}

const run = (env, extra = {}) => scan({
  homeDir: env.root, dirs: env.dirs, cacheFile: env.cacheFile, ...extra,
});
const inputTotal = (result) => result.usages.reduce((sum, usage) => sum + usage.tokens.input, 0);

test('a second scan reads from the cache and gives the same result', async () => {
  const env = setup();
  writeFile(env.log, `${claudeLine(1, 100)}\n${claudeLine(2, 200)}\n`);
  const first = await run(env);
  assert.ok(fs.existsSync(env.cacheFile));
  const cached = await run(env);
  assert.deepEqual(cached.usages, first.usages);
  assert.deepEqual(cached.stats, first.stats);
  assert.equal(inputTotal(cached), 300);
});

test('lines appended later are read without reading the file again, and are not counted twice', async () => {
  const env = setup();
  writeFile(env.log, `${claudeLine(1, 100)}\n`);
  await run(env);
  fs.appendFileSync(env.log, `${claudeLine(2, 200)}\n`);
  const result = await run(env);
  assert.equal(inputTotal(result), 300);
  assert.equal(result.usages.length, 2);
  const entry = JSON.parse(fs.readFileSync(env.cacheFile, 'utf8')).files[env.log];
  assert.equal(entry.offset, fs.statSync(env.log).size);
});

test('an unterminated last line counts now but is not cached, so it is read once it is complete', async () => {
  const env = setup();
  const partial = claudeLine(2, 200);
  writeFile(env.log, `${claudeLine(1, 100)}\n${partial}`);
  assert.equal(inputTotal(await run(env)), 300);
  assert.equal(inputTotal(await run(env)), 300);
  fs.appendFileSync(env.log, `\n${claudeLine(3, 400)}\n`);
  const result = await run(env);
  assert.equal(inputTotal(result), 700);
  assert.equal(result.usages.length, 3);
});

test('a file that was rewritten or shrank is read again from the start', async () => {
  const env = setup();
  writeFile(env.log, `${claudeLine(1, 100)}\n${claudeLine(2, 200)}\n`);
  await run(env);
  writeFile(env.log, `${claudeLine(9, 5)}\n`);
  assert.equal(inputTotal(await run(env)), 5);
  // Same size, different content: the fingerprint catches it.
  const other = `${claudeLine(8, 7)}\n`;
  assert.equal(other.length, fs.readFileSync(env.log, 'utf8').length);
  fs.writeFileSync(env.log, other);
  assert.equal(inputTotal(await run(env)), 7);
});

test('a longer rewrite is not mistaken for an append', async () => {
  const env = setup();
  writeFile(env.log, `${claudeLine(1, 100)}\n`);
  await run(env);
  writeFile(env.log, `${claudeLine(5, 1)}\n${claudeLine(6, 2)}\n${claudeLine(7, 3)}\n`);
  const result = await run(env);
  assert.equal(inputTotal(result), 6);
  assert.equal(result.usages.length, 3);
});

test('Codex state carries across an incremental read', async () => {
  const env = setup();
  const log = path.join(env.root, 'codex', '2026', '11', '02', 'rollout-x.jsonl');
  const event = (input, output) => JSON.stringify({
    timestamp: '2026-11-02T10:00:00Z',
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output, total_tokens: input + output } } },
  });
  const meta = JSON.stringify({ timestamp: '2026-11-02T09:00:00Z', type: 'session_meta', payload: { id: 'cx', cwd: '/w/app' } });
  writeFile(log, `${meta}\n${event(1000, 100)}\n`);
  const dirs = { claude: path.join(env.root, 'none'), codex: path.join(env.root, 'codex') };
  await scan({ homeDir: env.root, dirs, cacheFile: env.cacheFile });
  fs.appendFileSync(log, `${event(3000, 300)}\n`);
  const result = await scan({ homeDir: env.root, dirs, cacheFile: env.cacheFile });
  // 1100 first, then 3300 - 1100 = 2200 (the running total is what the cache must remember).
  assert.deepEqual(result.usages.map((usage) => usage.tokens.input + usage.tokens.output), [1100, 2200]);
  assert.equal(result.usages[1].project, 'app');
});

test('logs deleted by the tool leave the cache; a damaged cache is ignored', async () => {
  const env = setup();
  writeFile(env.log, `${claudeLine(1, 100)}\n`);
  await run(env);
  fs.rmSync(env.log);
  const result = await run(env);
  assert.equal(result.usages.length, 0);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(env.cacheFile, 'utf8')).files), []);
  fs.writeFileSync(env.cacheFile, '{not json');
  writeFile(env.log, `${claudeLine(1, 100)}\n`);
  assert.equal(inputTotal(await run(env)), 100);
});

test('a read-only cache is never written', async () => {
  const env = setup();
  writeFile(env.log, `${claudeLine(1, 100)}\n`);
  await run(env, { readOnlyCache: true });
  assert.equal(fs.existsSync(env.cacheFile), false);
});

test('files older than the date filter are skipped and keep their cache entry', async () => {
  const env = setup();
  writeFile(env.log, `${claudeLine(1, 100)}\n`);
  await run(env);
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(env.log, old, old);
  const skipped = await run(env, { modifiedSince: Date.parse('2026-01-01T00:00:00Z') });
  assert.equal(skipped.stats.files, 0);
  assert.ok(env.log in JSON.parse(fs.readFileSync(env.cacheFile, 'utf8')).files);
});

test('the cache holds numbers and short names, never message content', async () => {
  const env = setup();
  writeFile(env.log, `${JSON.stringify({
    timestamp: '2026-11-02T10:00:00Z', cwd: '/w/app', sessionId: 's', requestId: 'r', message: { id: 'm', model: 'claude-sonnet-5-5', content: 'SECRET PROMPT TEXT', usage: { input_tokens: 5 } },
  })}\n`);
  await run(env);
  assert.doesNotMatch(fs.readFileSync(env.cacheFile, 'utf8'), /SECRET PROMPT TEXT/);
});
