// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { scan } = require('../src/ai/scan');
const { scanFile } = require('../src/ai/lines');
const { PriceTable, loadPriceTable, matchesModel } = require('../src/ai/pricing');
const { buildReport } = require('../src/ai/report');
const {
  createQuery, groupKey, matches, modifiedSince, parseDate,
} = require('../src/ai/query');
const render = require('../src/ai/render');
const claude = require('../src/ai/sources/claude');
const codex = require('../src/ai/sources/codex');
const { totalTokens } = require('../src/ai/model');
const { tempDir, writeFile } = require('./helpers');

// The fixture logs are invented and copied from aicost; every expected number below is worked out
// by hand from them (see docs/ARCHITECTURE.md), not copied from the program's output:
// Claude: 5 requests, msg_1 written twice and msg_2 again in a sub-agent file (2 duplicates), one
// synthetic reply and one damaged line left out. Codex: 4 requests from running totals.
const FIXTURES = path.join(__dirname, 'fixtures', 'ai');
const DIRS = { claude: path.join(FIXTURES, 'claude'), codex: path.join(FIXTURES, 'codex') };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);

async function onFixtures(overrides = {}, scanOverrides = {}) {
  const { usages, stats } = await scan({ homeDir: '/nonexistent', dirs: DIRS, ...scanOverrides });
  return buildReport(usages, PriceTable.builtIn(), createQuery(overrides), stats);
}

test('duplicates, synthetic replies, and damaged lines are left out', async () => {
  const { scan: stats } = await onFixtures({ groupBy: 'tool' });
  assert.equal(stats.files, 4);
  assert.equal(stats.requests, 9);
  assert.equal(stats.duplicates, 2);
  assert.equal(stats.skipped_lines, 1);
  assert.deepEqual(stats.missing, []);
  assert.deepEqual(stats.unreadable, []);
});

test('tokens per tool match the logs', async () => {
  const report = await onFixtures({ groupBy: 'tool' });
  const row = (key) => report.rows.find((candidate) => candidate.key === key);
  assert.equal(row('claude').requests, 5);
  assert.equal(totalTokens(row('claude').tokens), 14_600);
  assert.equal(row('claude').tokens.cache_read, 10_000);
  assert.deepEqual([row('claude').tokens.cache_write_5m, row('claude').tokens.cache_write_1h], [1_500, 500]);
  // Codex: the sum of the differences between totals is the last total of each counter run:
  // 1100 + 2200 + 550 + 330. Cached tokens are split out of the input, not added on top.
  assert.equal(row('codex').requests, 4);
  assert.equal(totalTokens(row('codex').tokens), 4_180);
  assert.equal(row('codex').tokens.cache_read, 400 + 1000 + 100);
  assert.equal(row('codex').tokens.output, 100 + 200 + 50 + 30);
});

test('costs are priced per token kind and models without a price are reported', async () => {
  const report = await onFixtures({ groupBy: 'tool' });
  const cost = (key) => report.rows.find((row) => row.key === key).cost_usd;
  close(cost('claude'), 0.01375 + 0.00007 + 0.0026 + 0.0012);
  close(cost('codex'), 0.00248 + 0.0084 + 0.003);
  close(report.total.cost_usd, cost('claude') + cost('codex'));
  assert.deepEqual(report.unpriced.map((model) => [model.tool, model.model]), [
    ['codex', 'codex-auto-review'],
    ['claude', 'claude-future-9'],
  ]);
  assert.equal(report.total.has_unpriced, true);
});

test('days follow the time zone offset and weeks start on Monday', async () => {
  const days = async (offsetMinutes) => (await onFixtures({ groupBy: 'day', offsetMinutes })).rows.map((row) => [row.key, row.requests]);
  assert.deepEqual(await days(0), [['2026-11-02', 6], ['2026-11-03', 2], ['2026-11-09', 1]]);
  // Seven hours ahead: Haiku's request at 23:30 UTC falls on the 3rd.
  assert.deepEqual(await days(7 * 60), [['2026-11-02', 5], ['2026-11-03', 3], ['2026-11-09', 1]]);
  const weeks = (await onFixtures({ groupBy: 'week' })).rows.map((row) => [row.key, row.requests]);
  assert.deepEqual(weeks, [['2026-11-02', 8], ['2026-11-09', 1]]);
});

test('the period and the filters narrow the report', async () => {
  assert.equal((await onFixtures({ groupBy: 'project', since: '2026-11-03', until: '2026-11-09' })).total.requests, 3);
  const models = (await onFixtures({ groupBy: 'model', tools: ['codex'] })).rows.map((row) => row.key);
  assert.deepEqual(models, ['gpt-5.6-sol', 'gpt-5.6-terra', 'codex-auto-review']);
  assert.equal((await onFixtures({ groupBy: 'project', projects: ['OTHER'] })).total.requests, 1);
});

test('a missing log folder is noted and asking for one tool does not read the other', async () => {
  const missing = await scan({ homeDir: '/nonexistent', dirs: { claude: DIRS.claude, codex: path.join(FIXTURES, 'nope') } });
  assert.deepEqual(missing.stats.missing, ['codex']);
  assert.equal(missing.usages.length, 5);
  const only = await scan({ homeDir: '/nonexistent', dirs: DIRS, tools: ['claude'] });
  assert.equal(only.stats.files, 3);
  assert.deepEqual(only.stats.missing, []);
});

test('the same logs always give the same report', async () => {
  const first = JSON.stringify(await onFixtures({ groupBy: 'session' }));
  for (let run = 0; run < 3; run += 1) assert.equal(JSON.stringify(await onFixtures({ groupBy: 'session' })), first);
});

test('rows are ordered by time, or by cost then tokens then name', async () => {
  const byModel = (await onFixtures({ groupBy: 'model' })).rows.map((row) => row.key);
  assert.equal(byModel[0], 'claude-sonnet-5-5');
  assert.equal(groupKey(createQuery({ groupBy: 'session' }), { at: 0, session: 'abcdef123456', project: 'p', model: 'm', tool: 'claude' }), 'abcdef12');
});

test('model names match exactly or with a date stamp, never a longer version', () => {
  assert.equal(matchesModel('claude-sonnet-5', 'claude-sonnet-5'), true);
  assert.equal(matchesModel('claude-sonnet-5', 'claude-sonnet-5-20261001'), true);
  assert.equal(matchesModel('claude-sonnet-5', 'claude-sonnet-5@20261001'), true);
  assert.equal(matchesModel('claude-sonnet-5', 'claude-sonnet-5-6'), false);
  const table = PriceTable.builtIn();
  assert.ok(table.price('Claude-Sonnet-5-5[1m]'));
  assert.equal(table.price('claude-sonnet-5-5-extra'), undefined);
  assert.ok(table.size >= 15);
});

test('a price is per million tokens and missing cache prices default to the input price', () => {
  const table = PriceTable.fromToml('[[model]]\nmatch = "m"\ninput = 2\noutput = 10\n');
  close(table.cost('m', {
    input: 1e6, output: 1e6, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0,
  }), 12);
  close(table.cost('m', {
    input: 0, output: 0, cache_read: 1e6, cache_write_5m: 1e6, cache_write_1h: 1e6,
  }), 6);
  assert.equal(table.cost('other', { input: 1 }), undefined);
});

test('a price file rejects unknown fields and non-numbers, and a user entry replaces a built-in one', () => {
  assert.throws(() => PriceTable.fromToml('[[model]]\nmatch = "m"\ninput = 1\noutput = 1\ncolour = "red"\n', 'f.toml'), /unknown field "colour"/);
  assert.throws(() => PriceTable.fromToml('[[model]]\nmatch = "m"\ninput = "1"\noutput = 1\n'), /must be numbers/);
  assert.throws(() => PriceTable.fromToml('[[model]\n'), /pricing/);
  const home = tempDir();
  writeFile(path.join(home, '.config', 'aicost', 'pricing.toml'), '[[model]]\nmatch = "claude-sonnet-5-5"\ninput = 1\noutput = 1\n');
  const table = loadPriceTable({ homeDir: home });
  close(table.cost('claude-sonnet-5-5', {
    input: 1e6, output: 1e6, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0,
  }), 2);
  assert.notEqual(table.version, PriceTable.builtIn().version);
});

test('date shortcuts match aicost', () => {
  const today = '2026-11-23';
  assert.equal(parseDate('today', today), today);
  assert.equal(parseDate('yesterday', today), '2026-11-22');
  assert.equal(parseDate('7d', today), '2026-11-17');
  assert.equal(parseDate('1d', today), today);
  assert.equal(parseDate('2w', today), '2026-11-10');
  assert.equal(parseDate('3m', today), '2026-08-23');
  assert.equal(parseDate('2026-01-05', today), '2026-01-05');
  assert.equal(parseDate(' Today ', today), today);
  assert.equal(parseDate('1m', '2026-03-31'), '2026-02-28');
  for (const bad of ['', '0d', 'd', '-3d', '7x', '2026-13-01', 'soon']) {
    assert.throws(() => parseDate(bad, today), /cannot read the date/, bad);
  }
});

test('a request on the boundary day counts, and old log files are skipped by modification time', () => {
  const query = createQuery({ since: '2026-11-03', until: '2026-11-03' });
  const at = (iso) => ({ at: Date.parse(iso), tool: 'claude', project: 'p', model: 'm' });
  assert.equal(matches(query, at('2026-11-03T00:00:00Z')), true);
  assert.equal(matches(query, at('2026-11-03T23:59:59Z')), true);
  assert.equal(matches(query, at('2026-11-04T00:00:00Z')), false);
  // One day of padding before `since`.
  assert.equal(modifiedSince(createQuery({ since: '2026-11-03' })), Date.UTC(2026, 10, 2));
  assert.equal(modifiedSince(createQuery({})), undefined);
});

test('the Claude cache write split is kept, and unsplit writes count as five minute writes', () => {
  const read = (usage) => {
    const out = { records: [], skipped: 0 };
    claude.onLine(JSON.stringify({ timestamp: '2026-11-02T10:00:00Z', message: { id: 'a', model: 'm', usage } }), {}, out);
    return out;
  };
  const split = read({ cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } });
  assert.deepEqual([split.records[0].tokens.cache_write_5m, split.records[0].tokens.cache_write_1h], [100, 200]);
  const plain = read({ cache_creation_input_tokens: 300 });
  assert.deepEqual([plain.records[0].tokens.cache_write_5m, plain.records[0].tokens.cache_write_1h], [300, 0]);
  const rest = read({ cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100 } });
  assert.deepEqual([rest.records[0].tokens.cache_write_5m, rest.records[0].tokens.cache_write_1h], [200, 100]);
});

test('Claude ignores synthetic and empty replies, and counts malformed usage as skipped', () => {
  const run = (line) => {
    const out = { records: [], skipped: 0 };
    claude.onLine(line, {}, out);
    return out;
  };
  const base = (model, usage, extra = {}) => JSON.stringify({ timestamp: '2026-11-02T10:00:00Z', message: { id: 'a', model, usage }, ...extra });
  assert.deepEqual(run(base('<synthetic>', { input_tokens: 5 })), { records: [], skipped: 0 });
  assert.deepEqual(run(base('m', { input_tokens: 0 })), { records: [], skipped: 0 });
  assert.equal(run('{"usage": oops').skipped, 1);
  assert.equal(run(base('m', { input_tokens: -1 })).skipped, 1);
  assert.equal(run(base('m', { input_tokens: '5' })).skipped, 1);
  assert.equal(run(JSON.stringify({ message: { model: 'm', usage: { input_tokens: 5 } } })).skipped, 1);
  // The same message id and request id make one request.
  assert.equal(run(base('m', { input_tokens: 5 }, { requestId: 'r' })).records[0].key, 'a:r');
  assert.equal(run(base('m', { input_tokens: 5 })).records[0].key, null);
});

test('Codex: a request is the difference of two totals, and a restarted counter starts over', () => {
  const state = codex.initState('/x/rollout.jsonl');
  const out = { records: [], skipped: 0 };
  const event = (input, cached, output, time) => JSON.stringify({
    timestamp: time,
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } } },
  });
  codex.onLine(JSON.stringify({ timestamp: '2026-11-02T09:00:00Z', payload: { id: 'sess', cwd: '/home/u/app' } }), state, out);
  codex.onLine(JSON.stringify({ timestamp: '2026-11-02T09:00:01Z', payload: { turn_id: 't', model: 'gpt-x' } }), state, out);
  codex.onLine(event(1000, 400, 100, '2026-11-02T09:01:00Z'), state, out);
  codex.onLine(event(1000, 400, 100, '2026-11-02T09:01:01Z'), state, out); // repeated total: no request
  codex.onLine(event(3000, 1400, 300, '2026-11-02T09:02:00Z'), state, out);
  codex.onLine(event(500, 0, 50, '2026-11-02T09:03:00Z'), state, out); // restart
  codex.onLine(JSON.stringify({ timestamp: '2026-11-02T09:04:00Z', payload: { type: 'token_count', info: null } }), state, out);
  assert.deepEqual(out.records.map((record) => record.tokens), [
    { input: 600, output: 100, cache_read: 400, cache_write_5m: 0, cache_write_1h: 0 },
    { input: 1000, output: 200, cache_read: 1000, cache_write_5m: 0, cache_write_1h: 0 },
    { input: 500, output: 50, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 },
  ]);
  assert.equal(out.records[0].project, 'app');
  assert.equal(out.records[0].session, 'sess');
  assert.equal(out.records[0].model, 'gpt-x');
});

test('line scanning works across block boundaries, with CRLF, and leaves an unterminated tail', async () => {
  const dir = tempDir();
  const lines = [];
  for (let index = 0; index < 200; index += 1) lines.push(index % 3 === 0 ? `{"usage":${index},"pad":"${'x'.repeat(index % 17)}"}` : `{"other":${index}}`);
  const file = writeFile(path.join(dir, 'log.jsonl'), `${lines.join('\r\n')}\r\n{"usage":999}`);
  const size = require('node:fs').statSync(file).size;
  const seen = [];
  const result = await scanFile(file, {
    size, needles: ['"usage"'], chunkBytes: 37, onLine: (line) => seen.push(line),
  });
  assert.equal(seen.length, lines.filter((line) => line.includes('"usage"')).length);
  assert.equal(seen[0], lines[0]);
  assert.equal(result.tail, '{"usage":999}');
  assert.equal(result.offset, size - '{"usage":999}'.length);
});

test('tables, money, and CSV render like aicost', async () => {
  assert.equal(render.compact(999), '999');
  assert.equal(render.compact(1500), '1.5K');
  assert.equal(render.compact(2_500_000), '2.5M');
  assert.equal(render.money(1234.5), '$1,234.50');
  assert.equal(render.money(0.004), '<$0.01');
  assert.equal(render.money(0, true), 'n/a');
  assert.equal(render.money(3, true), '$3.00*');
  const report = await onFixtures({ groupBy: 'tool' });
  const csv = render.csv(report).split('\n');
  assert.equal(csv[0], 'key,requests,input,output,cache_read,cache_write,total_tokens,cost_usd,has_unpriced');
  assert.match(csv[1], /^claude,5,1650,950,10000,2000,14600,0\.017620,true$/);
  assert.match(render.table(report), /\| Tool .*Cost \|/);
  const notes = render.notes(report, { verbose: true });
  assert.ok(notes.some((note) => note.includes('No price for: codex-auto-review')));
  assert.ok(notes.some((note) => note.includes('1 log lines could not be read')));
});
