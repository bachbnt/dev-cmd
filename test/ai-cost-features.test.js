// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectAi, handleAi } = require('../src/handlers/ai');
const { detectAnomaly, efficiency, topSessions } = require('../src/ai/analysis');
const { clientOf, createQuery } = require('../src/ai/query');
const machines = require('../src/ai/machines');
const { PriceTable } = require('../src/ai/pricing');
const render = require('../src/ai/render');
const { getPaths } = require('../src/config/paths');
const { loadConfig, parseConfigValue, setConfigValue, configValue, validateConfig, CONFIG_KEYS } = require('../src/config/user');
const { parseArgs } = require('../src/utils/args');
const { fakeClock, tempDir, writeFile } = require('./helpers');

const clock = fakeClock('2026-11-20T12:00:00Z');

function line(id, { day = '2026-11-20', hour = 10, cwd = '/work/acme/app', branch = 'main', side = false, session = 's1', input = 1000, output = 100, model = 'claude-sonnet-5-5' } = {}) {
  return JSON.stringify({
    type: 'assistant', timestamp: `${day}T${String(hour).padStart(2, '0')}:00:00Z`, cwd, sessionId: session, requestId: `r${id}`, gitBranch: branch, isSidechain: side,
    message: { id: `m${id}`, model, usage: { input_tokens: input, output_tokens: output } },
  });
}

function home(lines) {
  const dir = tempDir();
  writeFile(path.join(dir, '.claude', 'projects', 'p', 'a.jsonl'), `${lines.join('\n')}\n`);
  return dir;
}

function run(homeDir, args, config = {}) {
  const { options, positionals } = parseArgs(['ai', ...args]);
  return collectAi({
    command: 'ai', options, positionals, config, homeDir, now: clock.now,
  });
}

const usage = (extra = {}) => ({
  at: Date.parse('2026-11-20T10:00:00Z'), tool: 'claude', model: 'claude-sonnet-5-5', session: 's', project: 'app', cwd: '/w/app', branch: 'main', sidechain: false, tokens: { input: 1_000_000, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 }, ...extra,
});

test('branch and client groupings come from the log and the configured folders', async () => {
  const dir = home([
    line(1, { branch: 'main', cwd: '/work/acme/app' }), line(2, { branch: 'feat/x', cwd: '/work/acme/app' }), line(3, { branch: 'feat/x', cwd: '/work/globex/api' }),
  ]);
  const byBranch = (await run(dir, ['report', '--by', 'branch', '--since', '2026-11-01'])).report;
  assert.deepEqual(byBranch.rows.map((row) => [row.key, row.requests]), [['feat/x', 2], ['main', 1]]);
  const config = { aiClients: { '/work/acme': 'Acme', '/work/globex': 'Globex' } };
  const byClient = (await run(dir, ['report', '--by', 'client', '--since', '2026-11-01'], config)).report;
  assert.deepEqual(byClient.rows.map((row) => [row.key, row.requests]).sort(), [['Acme', 2], ['Globex', 1]]);
  assert.equal(clientOf('/work/acme-other/x', [{ prefix: '/work/acme', name: 'Acme' }]), '(unassigned)');
  assert.equal(clientOf('/work/acme/deep/x', [{ prefix: '/work', name: 'All' }, { prefix: '/work/acme', name: 'Acme' }]), 'Acme');
  assert.equal(clientOf('C:\\work\\acme\\x', [{ prefix: 'C:\\work\\acme', name: 'Acme' }]), 'Acme');
});

test('clients are managed with dev ai clients and kept in the config, not in the daily history', async () => {
  const dir = tempDir();
  const file = getPaths(dir).configFile;
  const configHolder = { config: loadConfig({ file }) };
  const add = parseArgs(['ai', 'clients', 'add', 'Acme', '/work/acme']);
  const added = await collectAi({ options: add.options, positionals: add.positionals, config: configHolder.config, homeDir: dir, now: clock.now });
  assert.deepEqual(added.data.clients, { [path.resolve('/work/acme')]: 'Acme' });
  assert.deepEqual(loadConfig({ file }).aiClients, { [path.resolve('/work/acme')]: 'Acme' });
  const remove = parseArgs(['ai', 'clients', 'remove', 'Nobody']);
  await assert.rejects(collectAi({ options: remove.options, positionals: remove.positionals, config: loadConfig({ file }), homeDir: dir, now: clock.now }), /No client named/);
  assert.throws(() => setConfigValue('aiClients', 'x', { file }), /Unknown config key/);
  assert.equal(CONFIG_KEYS.includes('aiClients'), false);
  assert.throws(() => validateConfig({ ...loadConfig({ file }), aiClients: { '/a': '' } }), /aiClients must be an object/);
});

test('efficiency: cache ratio, model mix, sub-agent share, and the plan against API prices', () => {
  const prices = PriceTable.builtIn();
  const usages = [
    usage({ tokens: { input: 100, output: 0, cache_read: 900, cache_write_5m: 0, cache_write_1h: 0 } }),
    usage({ sidechain: true, tokens: { input: 1_000_000, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 } }),
    usage({ model: 'unknown-model' }),
  ];
  const data = efficiency(usages, prices, createQuery({ offsetMinutes: 0 }), { planUsd: 20, monthUsd: 40 });
  assert.ok(Math.abs(data.cache_hit_ratio - 900 / (100 + 900 + 1_000_000 + 1_000_000)) < 1e-9);
  assert.equal(data.has_unpriced, true);
  assert.ok(data.sub_agent_share > 0.99);
  assert.equal(data.models[0].model, 'claude-sonnet-5-5');
  assert.equal(data.plan.ratio, 2);
  assert.equal(efficiency([], prices, createQuery({}), {}).cache_hit_ratio, null);
});

test('the most expensive sessions come first and carry their branch', () => {
  const prices = PriceTable.builtIn();
  const rows = topSessions([
    usage({ session: 'cheap' }), usage({ session: 'big-session-id', tokens: { input: 5_000_000, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 }, branch: 'feat/y' }),
    usage({ session: 'big-session-id' }),
  ], prices, createQuery({}), 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].session, 'big-sess');
  assert.equal(rows[0].requests, 2);
  assert.equal(rows[0].branch, 'feat/y'); // the branch of the session's first request
  assert.match(render.sessionsTable(rows), /big-sess/);
});

test('an anomaly needs a baseline, a factor over the usual, and a minimum amount', () => {
  const prices = PriceTable.builtIn();
  const day = (iso, million) => usage({ at: Date.parse(`${iso}T10:00:00Z`), tokens: { input: million * 1_000_000, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 } });
  const base = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'].map((iso) => day(iso, 1)); // $2 a day
  const settings = { today: '2026-11-20', offsetMinutes: 0, factor: 3, minUsd: 5 };
  assert.equal(detectAnomaly([...base, day('2026-11-20', 4)], prices, settings).flagged, true); // $8 > 3 x $2
  assert.equal(detectAnomaly([...base, day('2026-11-20', 2)], prices, settings).flagged, false); // $4, under 3x
  assert.equal(detectAnomaly([...base, day('2026-11-20', 1)], prices, { ...settings, factor: 0.1, minUsd: 50 }).flagged, false); // below the minimum
  assert.equal(detectAnomaly([day('2026-11-18', 1), day('2026-11-20', 9)], prices, settings).flagged, false); // not enough days
  assert.equal(configValue({}, 'aiAnomalyFactor'), 3);
  assert.equal(configValue({ aiAnomalyFactor: 5 }, 'aiAnomalyFactor'), 5);
});

test('--short shows the anomaly, and the typed config rejects bad values', async () => {
  const lines = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'].map((iso, index) => line(index, { day: iso, input: 1_000_000, output: 0 }));
  lines.push(line(99, { day: '2026-11-20', input: 4_000_000, output: 0, session: 'today' }));
  const result = await run(home(lines), ['--short'], { aiBudget: 1000 });
  assert.equal(result.budget.anomaly.flagged, true);
  const out = { text: '', write(chunk) { this.text += chunk; } };
  const { options, positionals } = parseArgs(['ai', '--short']);
  await handleAi({ options, positionals, config: { aiBudget: 1000 }, homeDir: home(lines), now: clock.now, stdout: out });
  assert.match(out.text, /! \$8\.00 today is 4\.0x your usual day/);

  assert.throws(() => parseConfigValue('aiAnomalyFactor', '0.5'), /at least 1/);
  assert.equal(parseConfigValue('aiAnomalyFactor', '2.5'), 2.5);
  assert.throws(() => parseConfigValue('aiPriceStaleDays', '1.5'), /whole number/);
  assert.throws(() => parseConfigValue('aiMachine', 'has space'), /1 to 40/);
  assert.equal(parseConfigValue('aiPlan', 'off'), undefined);
});

test('stale prices are reported, and --prices shows when they were checked', async () => {
  const dir = tempDir();
  const fresh = await run(dir, ['--prices'], {});
  assert.equal(fresh.data.updated, '2026-11-23');
  assert.equal(fresh.data.stale, false);
  assert.ok(fresh.data.models.length >= 15);
  const later = fakeClock('2027-03-01T12:00:00Z');
  const { options, positionals } = parseArgs(['ai', '--prices']);
  const stale = await collectAi({ options, positionals, config: {}, homeDir: dir, now: later.now });
  assert.equal(stale.data.stale, true);
  const reportOptions = parseArgs(['ai', 'report', '--since', '2026-01-01']);
  const withNote = await collectAi({ options: reportOptions.options, positionals: reportOptions.positionals, config: {}, homeDir: home([line(1)]), now: later.now });
  assert.match(withNote.notes.join('\n'), /Prices were last checked on 2026-11-23/);
  assert.equal(PriceTable.builtIn().updated, '2026-11-23');
});

test('the status line setting runs dev ai --short', async () => {
  const result = await run(tempDir(), ['--print-statusline-config']);
  assert.deepEqual(result.data, { statusLine: { type: 'command', command: 'dev ai --short' } });
});

test('Markdown, HTML and OpenMetrics output', async () => {
  const dir = home([line(1, { cwd: '/work/<b>"x"' })]);
  const { report } = await run(dir, ['report', '--since', '2026-11-01', '--by', 'project']);
  const md = render.markdown(report);
  assert.match(md, /^\| Project \| Requests/);
  assert.match(md.split('\n')[1], /^\| --- \| ---:/);
  const html = render.html(report);
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script|src=|href=/);
  assert.match(html, /&lt;b&gt;&quot;x&quot;/);
  assert.doesNotMatch(html, /<b>"x"/);
  const metrics = render.openmetrics(report);
  assert.match(metrics, /# TYPE devcmd_ai_cost_usd gauge/);
  assert.match(metrics, /devcmd_ai_requests\{project="<b>\\"x\\""\} 1/);
  assert.match(metrics, /# EOF$/);
  assert.equal(render.openmetrics({ group_by: 'tool', rows: [{ key: 'a"\nb', requests: 1, cost_usd: 1, tokens: { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 } }] }).includes('a\\"\\nb'), true);
});

test('daily totals move between computers: export, validate, import, and sum in the history', async () => {
  const laptop = home([line(1, { day: '2026-11-10' })]);
  await run(laptop, ['report', '--since', '2026-11-01']);
  const file = path.join(tempDir(), 'laptop.json');
  const exported = await run(laptop, ['--export-snapshot', file], { aiMachine: 'laptop' });
  assert.equal(exported.mode, 'export');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(data.machine, 'laptop');
  assert.doesNotMatch(JSON.stringify(data), /acme|\/work|branch|s1/);

  const desktop = home([line(2, { day: '2026-11-10', input: 2000 })]);
  await run(desktop, ['report', '--since', '2026-11-01']);
  const imported = await run(desktop, ['--import-snapshot', file], { aiMachine: 'desktop' });
  assert.equal(imported.data.machine, 'laptop');
  assert.equal(imported.data.requests, 1);
  const history = await run(desktop, ['--history', '--by', 'day'], { aiMachine: 'desktop' });
  assert.deepEqual(history.report.rows.map((row) => [row.key, row.requests]), [['2026-11-10', 2]]);
  assert.match(history.notes.join(' '), /1 imported computer\(s\): laptop/);
  const list = await run(desktop, ['--machines'], { aiMachine: 'desktop' });
  assert.deepEqual(list.data.machines.map((row) => row.machine), ['desktop', 'laptop']);

  await assert.rejects(run(laptop, ['--import-snapshot', file], { aiMachine: 'laptop' }), /same machine label/);
});

test('a snapshot file is validated before it is imported', () => {
  const good = { kind: 'devcmd-ai-snapshot', version: 1, machine: 'm', days: { '2026-11-10': { claude: { 'claude-sonnet-5-5': { requests: 1, cost_usd: 1, priced: true, tokens: { input: 1, output: 1, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 } } } } } };
  assert.doesNotThrow(() => machines.validateImport(good));
  for (const [change, pattern] of [
    [{ kind: 'other' }, /wrong kind/],
    [{ machine: '../evil' }, /machine label/],
    [{ days: { today: {} } }, /not a date/],
    [{ days: { '2026-11-10': { claude: { m: { requests: -1, cost_usd: 1, priced: true, tokens: {} } } } } }, /bad numbers/],
    [{ days: { '2026-11-10': { claude: { m: { requests: 1, cost_usd: 1, priced: true, tokens: { input: 'x' } } } } } }, /bad tokens/],
  ]) assert.throws(() => machines.validateImport({ ...good, ...change }), pattern);
  const merged = machines.mergeMachines(good, [good]);
  assert.equal(merged.days['2026-11-10'].claude['claude-sonnet-5-5'].requests, 2);
  assert.match(machines.newLabel(), /^m-[0-9a-f]{8}$/);
});

test('an invalid new flag is rejected, and --sessions takes a number', () => {
  assert.throws(() => parseArgs(['ai', '--sessions', 'many']), /--sessions requires a number/);
  assert.equal(parseArgs(['ai', '--sessions', '5']).options.sessions, '5');
  const { validateCommandFlags } = require('../src/utils/args');
  assert.throws(() => validateCommandFlags('doctor', parseArgs(['doctor', '--efficiency']).options, {}), /--efficiency is only supported by the ai command/);
});
