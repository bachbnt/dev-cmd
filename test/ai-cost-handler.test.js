// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectAi, handleAi } = require('../src/handlers/ai');
const { parseArgs } = require('../src/utils/args');
const { getPaths } = require('../src/config/paths');
const { setConfigValue, loadConfig } = require('../src/config/user');
const { fakeClock, tempHome, tempDir, writeFile } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures', 'ai');
const root = path.join(__dirname, '..');
// Noon UTC on the 9th: the same calendar day in every time zone, so these tests do not depend on
// where they run. Fixture requests span 2026-11-02 to 2026-11-09.
const clock = fakeClock('2026-11-09T12:00:00Z');

function context(args, { config = {}, home = tempDir() } = {}) {
  const { options, positionals } = parseArgs(['ai', '--claude-dir', path.join(FIXTURES, 'claude'), '--codex-dir', path.join(FIXTURES, 'codex'), ...args]);
  return { command: 'ai', options, positionals, config, homeDir: home, now: clock.now };
}

const capture = () => {
  let text = '';
  return { write: (chunk) => { text += chunk; }, get text() { return text; } };
};

test('the month report covers every fixture request and keeps the report shape of aicost', async () => {
  const { report } = await collectAi(context(['--by', 'tool']));
  assert.deepEqual(Object.keys(report), ['group_by', 'since', 'until', 'rows', 'total', 'unpriced', 'scan']);
  assert.equal(report.since, '2026-11-01');
  assert.equal(report.total.requests, 9);
  assert.deepEqual(report.rows.map((row) => row.key), ['claude', 'codex']);
});

test('today and week use their own periods and default grouping', async () => {
  const today = (await collectAi(context(['today']))).report;
  assert.equal(today.group_by, 'project');
  assert.equal(today.total.requests, 1); // the one request on the 9th
  const week = (await collectAi(context(['week']))).report;
  assert.equal(week.since, '2026-11-03');
  assert.equal(week.group_by, 'day');
});

test('--since and --until belong to report and --history; bad input is explained', async () => {
  await assert.rejects(collectAi(context(['--since', '7d'])), /only valid with `dev ai report`/);
  await assert.rejects(collectAi(context(['yearly'])), /Usage: dev ai/);
  await assert.rejects(collectAi(context(['report', '--since', 'soon'])), /cannot read the date "soon"/);
  assert.throws(() => parseArgs(['ai', '--by', 'colour']), /--by must be one of/);
  assert.throws(() => parseArgs(['ai', '--tool', 'vim']), /--tool must be one of/);
  const repeated = parseArgs(['ai', '--tool', 'claude', '--tool', 'codex']).options;
  assert.deepEqual(repeated.aiTools, ['claude', 'codex']);
  const { report } = await collectAi(context(['report', '--since', '2026-11-05', '--until', '2026-11-09', '--by', 'project']));
  assert.equal(report.total.requests, 1);
  const before = (await collectAi(context(['report', '--since', '2026-11-05', '--until', '2026-11-08']))).report;
  assert.equal(before.total.requests, 0);
});

test('the first run records daily totals; a later run never replaces a day with a smaller number', async () => {
  const home = tempDir();
  const paths = getPaths(home);
  const first = context([], { home });
  await collectAi(first);
  const snapshot = JSON.parse(fs.readFileSync(paths.aiDailyFile, 'utf8'));
  assert.equal(snapshot.version, 1);
  const requests = Object.values(snapshot.days).flatMap((tools) => Object.values(tools).flatMap((models) => Object.values(models))).reduce((sum, entry) => sum + entry.requests, 0);
  assert.equal(requests, 9);

  // The tool deletes its logs: the history keeps the totals and the next run does not shrink them.
  const empty = tempDir();
  const later = parseArgs(['ai', '--history', '--by', 'month', '--claude-dir', empty, '--codex-dir', empty]);
  const result = await collectAi({
    command: 'ai', options: later.options, positionals: later.positionals, config: {}, homeDir: home, now: clock.now,
  });
  assert.equal(result.report.total.requests, 9);
  assert.deepEqual(result.report.rows.map((row) => row.key), ['2026-11']);
});

test('daily totals hold only numbers: no project names, sessions, or message content', async () => {
  const home = tempDir();
  await collectAi(context([], { home }));
  const text = fs.readFileSync(getPaths(home).aiDailyFile, 'utf8');
  assert.doesNotMatch(text, /demo-app|sess-a|hello/);
});

test('--dry-run writes nothing, and --no-snapshot writes no daily totals', async () => {
  const dry = tempDir();
  await collectAi(context(['--dry-run'], { home: dry }));
  assert.equal(fs.existsSync(path.join(dry, '.devcmd')), false);
  const skip = tempDir();
  await collectAi(context(['--no-snapshot'], { home: skip }));
  assert.equal(fs.existsSync(getPaths(skip).aiDailyFile), false);
});

test('--history reads the daily totals and refuses groupings it cannot answer', async () => {
  const home = tempDir();
  await collectAi(context([], { home }));
  const byModel = (await collectAi(context(['--history', '--by', 'model'], { home }))).report;
  assert.equal(byModel.total.requests, 9);
  assert.ok(byModel.rows.some((row) => row.key === 'claude-sonnet-5-5'));
  await assert.rejects(collectAi(context(['--history', '--by', 'project'], { home })), /History cannot be grouped by project/);
});

test('--check exits 1 over the budget, 0 under it, and 2 when no budget is set', async () => {
  const over = await collectAi(context(['--check'], { config: { aiBudget: 0.02 } }));
  assert.equal(over.exitCode, 1);
  assert.equal(over.budget.over, true);
  const under = await collectAi(context(['--check'], { config: { aiBudget: 5 } }));
  assert.equal(under.exitCode, 0);
  assert.equal(under.budget.over, false);
  const none = await collectAi(context(['--check']));
  assert.equal(none.exitCode, 2);
  assert.match(none.notes.join('\n'), /dev config set aiBudget/);
});

test('the budget is this month across every tool, with a straight-line projection', async () => {
  const { budget } = await collectAi(context(['--check', '--tool', 'claude'], { config: { aiBudget: 1 } }));
  // Priced requests only: 0.01762 (Claude) + 0.01388 (Codex), whatever filters were asked for.
  assert.ok(Math.abs(budget.month_usd - 0.0315) < 1e-9, budget.month_usd);
  assert.equal(budget.has_unpriced, true);
  assert.equal(budget.days_elapsed, 9);
  assert.equal(budget.days_in_month, 30);
  assert.ok(Math.abs(budget.projected_usd - (0.0315 / 9) * 30) < 1e-9);
  assert.equal(Math.round(budget.percent * 1000), Math.round(3.15 * 1000));
});

test('--short prints one line and --check prints the budget, both without a banner', async () => {
  const out = capture();
  const code = await handleAi({ ...context(['--short'], { config: { aiBudget: 100 } }), stdout: out });
  assert.equal(code, 0);
  assert.match(out.text, /^<\$0\.01\* today · \$0\.03\* this month \(0% of \$100\.00\)\n$/);
  const check = capture();
  const exit = await handleAi({ ...context(['--check'], { config: { aiBudget: 0.01 } }), stdout: check });
  assert.equal(exit, 1);
  assert.match(check.text, /Over budget/);
});

test('--format json and csv print only the data', async () => {
  const json = capture();
  await handleAi({ ...context(['--format', 'json', '--by', 'tool']), stdout: json });
  assert.equal(JSON.parse(json.text).total.requests, 9);
  const csv = capture();
  await handleAi({ ...context(['--format', 'csv', '--by', 'tool']), stdout: csv });
  assert.match(csv.text, /^key,requests,input,output/);
});

test('--tools lists the sources without reading any log', async () => {
  const result = await collectAi(context(['--tools']));
  assert.deepEqual(result.data.map((source) => source.tool), ['claude', 'codex']);
  assert.ok(result.data.every((source) => source.found && source.billing === 'tokens'));
});

test('a price file for unknown models changes the report and an invalid one is an error', async () => {
  const home = tempDir();
  const file = writeFile(path.join(home, 'prices.toml'), '[[model]]\nmatch = "claude-future-9"\ninput = 1\noutput = 1\n');
  const { report } = await collectAi(context(['--by', 'tool', '--pricing', file], { home }));
  assert.equal(report.unpriced.length, 1);
  await assert.rejects(collectAi(context(['--pricing', path.join(home, 'missing.toml')], { home })), /Cannot read pricing file/);
});

test('aiBudget is a config key: numbers only, and off removes it', () => {
  const { home } = tempHome();
  const file = path.join(home, 'config.json');
  assert.equal(setConfigValue('aiBudget', '250', { file }).aiBudget, 250);
  assert.equal(loadConfig({ file }).aiBudget, 250);
  assert.throws(() => setConfigValue('aiBudget', 'lots', { file }), /aiBudget must be a non-negative number/);
  assert.throws(() => setConfigValue('aiBudget', '-1', { file }), /non-negative/);
  assert.equal(setConfigValue('aiBudget', 'off', { file }).aiBudget, undefined);
});

function runDev(args, env) {
  return spawnSync(process.execPath, [path.join(root, 'dev'), 'ai', ...args], { encoding: 'utf8', env });
}

test('dev ai --json prints the report; --short has no banner; flags are rejected on other commands', () => {
  const { env } = tempHome();
  const logs = ['--claude-dir', path.join(FIXTURES, 'claude'), '--codex-dir', path.join(FIXTURES, 'codex')];
  const json = runDev(['report', '--since', '2026-01-01', '--json', '--by', 'tool', ...logs], env);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).total.requests, 9);

  const short = runDev(['--short', ...logs], env);
  assert.equal(short.status, 0, short.stderr);
  assert.equal(short.stdout.trim().split('\n').length, 1);
  assert.doesNotMatch(short.stdout, /DevCmd|┌/);

  const table = runDev(['report', '--since', '2026-01-01', ...logs], env);
  assert.match(table.stdout, /Requests/);

  const wrong = spawnSync(process.execPath, [path.join(root, 'dev'), 'doctor', '--by', 'tool'], { encoding: 'utf8', env });
  assert.notEqual(wrong.status, 0);
});
