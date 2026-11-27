// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scan } = require('../src/ai/scan');
const { PriceTable } = require('../src/ai/pricing');
const { buildReport } = require('../src/ai/report');
const { createQuery } = require('../src/ai/query');
const { queryRows } = require('../src/ai/sqlite');
const copilot = require('../src/ai/sources/copilot');
const opencode = require('../src/ai/sources/opencode');
const codex = require('../src/ai/sources/codex');
const { describeSources } = require('../src/ai/sources');
const { tempDir } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures', 'ai');

test('Gemini CLI: a message repeated on many lines counts once; tokens are used when present, requests otherwise', async () => {
  const { usages, stats } = await scan({
    homeDir: '/nonexistent', tools: ['gemini'], dirs: { gemini: path.join(FIXTURES, 'gemini', 'tmp') },
  });
  assert.equal(usages.length, 2);
  assert.equal(stats.duplicates, 0);
  const [withTokens, withoutTokens] = usages;
  // input 1000 includes cached 400, plus tool 20; thoughts count as output.
  assert.deepEqual(withTokens.tokens, {
    input: 620, output: 150, cache_read: 400, cache_write_5m: 0, cache_write_1h: 0,
  });
  assert.equal(withTokens.model, 'gemini-2.5-pro');
  assert.equal(withTokens.project, 'proj');
  assert.equal(withTokens.session, 'g1');
  assert.equal(withoutTokens.tokens.input + withoutTokens.tokens.output, 0);
  assert.equal(withoutTokens.model, 'gemini (model not recorded)');
  const report = buildReport(usages, PriceTable.builtIn(), createQuery({ groupBy: 'model' }), stats);
  assert.equal(report.total.requests, 2);
  assert.equal(report.unpriced.some((entry) => entry.model.startsWith('gemini (model')), true, 'a reply with no model and no tokens has no price');
});

test('Gemini CLI: only chat files count, and a user-only log gives no requests', async () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'p', 'chats'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'p', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'p', 'chats', 'a.jsonl'), `${JSON.stringify({ sessionId: 's', $set: { messages: [{ id: 'u', timestamp: '2026-11-04T09:00:00Z', type: 'user', content: 'x' }] } })}\n`);
  fs.writeFileSync(path.join(dir, 'p', 'logs', 'b.jsonl'), `${JSON.stringify({ type: 'gemini', id: 'z', timestamp: '2026-11-04T09:00:00Z' })}\n`);
  const result = await scan({ homeDir: '/nonexistent', tools: ['gemini'], dirs: { gemini: dir } });
  assert.equal(result.usages.length, 0);
  assert.equal(result.stats.files, 1);
});

test('Copilot rows: cache reads and writes are taken out of the input, and the reported cost is kept', () => {
  const { records, skipped } = copilot.readRows([
    {
      session_id: 's1', model: 'gpt-x', input_tokens: 16366, output_tokens: 188, cache_read_tokens: 0, cache_write_tokens: 16363, total_nano_aiu: 213_967_500, created_at: '2026-11-13T06:02:12.416Z', cwd: '/w/app',
    },
    {
      session_id: 's1', model: 'gpt-x', input_tokens: 20280, output_tokens: 470, cache_read_tokens: 16363, cache_write_tokens: 3914, total_nano_aiu: 88_818_000, created_at: '2026-11-13 06:02:17', cwd: '/w/app',
    },
    { session_id: 's1', model: null, created_at: 'nonsense' },
  ]);
  assert.equal(skipped, 1);
  assert.deepEqual(records[0].tokens, {
    input: 3, output: 188, cache_read: 0, cache_write_5m: 16363, cache_write_1h: 0,
  });
  assert.deepEqual(records[1].tokens, {
    input: 3, output: 470, cache_read: 16363, cache_write_5m: 3914, cache_write_1h: 0,
  });
  assert.ok(Math.abs(records[0].reportedCost - 0.2139675) < 1e-12);
  assert.equal(records[0].project, 'app');
  assert.equal(records[1].at, Date.parse('2026-11-13T06:02:17Z'));
  const table = PriceTable.builtIn();
  // The reported cost wins over the price table, and a model with no price is still costed.
  assert.ok(Math.abs(table.costOf(records[0]) - 0.2139675) < 1e-12);
  assert.equal(table.costOf({ model: 'unknown-model', tokens: records[0].tokens }), undefined);
});

test('OpenCode rows: output already holds reasoning, cost is the tool\'s own, and non-assistant rows are ignored', () => {
  const assistant = (tokens, extra = {}) => JSON.stringify({
    role: 'assistant', modelID: 'deepseek-v4-flash-free', time: { created: 1_770_905_184_273, completed: 1_770_905_193_201 }, path: { cwd: '/w/app' }, cost: 0, tokens, ...extra,
  });
  const { records, skipped } = opencode.readRows([
    { id: '1', session_id: 'a', time_created: 1, data: assistant({ input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 7 } }, { cost: 0.12 }) },
    { id: '2', session_id: 'a', time_created: 2, data: JSON.stringify({ role: 'user', time: { created: 1 } }) },
    { id: '3', session_id: 'a', time_created: 3, data: assistant({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }) },
    { id: '4', session_id: 'a', time_created: 4, data: 'not json' },
  ]);
  assert.equal(skipped, 1);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].tokens, {
    input: 100, output: 20, cache_read: 30, cache_write_5m: 7, cache_write_1h: 0,
  });
  assert.equal(records[0].reportedCost, 0.12);
  assert.equal(records[0].at, 1_770_905_193_201);
  assert.equal(records[0].project, 'app');
});

test('sub-agent sessions are marked: Codex source.subagent, OpenCode parent_id', () => {
  const run = (source) => {
    const state = codex.initState('/x/rollout.jsonl');
    const out = { records: [], skipped: 0 };
    codex.onLine(JSON.stringify({ timestamp: '2026-11-02T09:00:00Z', payload: { id: 's', cwd: '/w/app', source } }), state, out);
    codex.onLine(JSON.stringify({ timestamp: '2026-11-02T09:00:01Z', payload: { turn_id: 't', model: 'gpt-x' } }), state, out);
    codex.onLine(JSON.stringify({ timestamp: '2026-11-02T09:01:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, total_tokens: 15 } } } }), state, out);
    return out.records[0].sidechain;
  };
  assert.equal(run('cli'), false);
  assert.equal(run(undefined), false);
  assert.equal(run({ subagent: { other: 'guardian' } }), true);

  const data = JSON.stringify({
    role: 'assistant', modelID: 'm', time: { completed: 1_770_905_193_201 }, path: { cwd: '/w/app' }, tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } },
  });
  const { records } = opencode.readRows([
    { id: '1', session_id: 'a', time_created: 1, data, parent_id: null },
    { id: '2', session_id: 'b', time_created: 2, data, parent_id: 'a' },
  ]);
  assert.deepEqual(records.map((record) => record.sidechain), [false, true]);
});

function sqliteAvailable() {
  try {
    require('node:sqlite');
    return true;
  } catch {
    return spawnSync('sqlite3', ['-version']).status === 0;
  }
}

test('a real SQLite file is read through node:sqlite or the sqlite3 command, read only', { skip: !sqliteAvailable() && 'no SQLite reader on this machine' }, async (t) => {
  const dir = tempDir();
  const file = path.join(dir, 'session-store.db');
  const create = `
    create table sessions (id text primary key, cwd text);
    create table assistant_usage_events (id integer primary key, session_id text, model text, input_tokens integer, output_tokens integer,
      cache_read_tokens integer, cache_write_tokens integer, total_nano_aiu integer, created_at text);
    insert into sessions values ('s1', '/w/proj');
    insert into assistant_usage_events values (1, 's1', 'm', 100, 10, 40, 10, 5000000000, '2026-11-13T06:02:12.416Z');`;
  let created = false;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(file);
    database.exec(create);
    database.close();
    created = true;
  } catch {}
  if (!created) {
    const result = spawnSync('sqlite3', [file, create]);
    if (result.status !== 0) {
      t.skip('cannot create a SQLite file here');
      return;
    }
  }
  const rows = queryRows(file, 'select count(*) as n from assistant_usage_events');
  assert.equal(Number(rows[0].n), 1);
  const result = await scan({ homeDir: '/nonexistent', tools: ['copilot'], dirs: { copilot: dir } });
  assert.equal(result.usages.length, 1);
  assert.deepEqual(result.usages[0].tokens, {
    input: 50, output: 10, cache_read: 40, cache_write_5m: 10, cache_write_1h: 0,
  });
  assert.equal(result.usages[0].reportedCost, 5);
  assert.equal(result.usages[0].project, 'proj');
  if (sqliteAvailable() && spawnSync('sqlite3', ['-version']).status === 0) {
    assert.equal(Number(queryRows(file, 'select count(*) as n from sessions', { preferCli: true })[0].n), 1);
  }
  assert.throws(() => queryRows(file, 'insert into sessions values (\'x\', \'y\')'), /readonly|read-only|attempt to write|not authorized/i);
});

test('a missing database is a missing tool, and --tools describes unsupported tools honestly', async () => {
  const result = await scan({ homeDir: '/nonexistent', tools: ['copilot', 'opencode'] });
  assert.deepEqual(result.stats.missing, ['copilot', 'opencode']);
  const sources = describeSources({ homeDir: '/nonexistent' });
  const antigravity = sources.find((source) => source.tool === 'antigravity');
  assert.equal(antigravity.maturity, 'not supported');
  assert.match(antigravity.reason, /no tokens/);
});
