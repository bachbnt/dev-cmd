// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectAi, handleAi, notifyBudget } = require('../src/handlers/ai');
const { scan } = require('../src/ai/scan');
const { describeSources } = require('../src/ai/sources');
const { TTL_MS, cacheable, readShort, writeShort } = require('../src/ai/short-cache');
const { loadConfig, setConfigValue } = require('../src/config/user');
const { parseArgs } = require('../src/utils/args');
const { fakeClock, tempDir, tempHome, writeFile } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures', 'ai');
const root = path.join(__dirname, '..');
const clock = fakeClock('2026-11-09T12:00:00Z');

function context(args, { config = {}, home = tempDir() } = {}) {
  const { options, positionals } = parseArgs(['ai', '--claude-dir', path.join(FIXTURES, 'claude'), '--codex-dir', path.join(FIXTURES, 'codex'), ...args]);
  return { command: 'ai', options, positionals, config, homeDir: home, now: clock.now };
}

const capture = () => {
  let text = '';
  return { write: (chunk) => { text += chunk; }, get text() { return text; } };
};

// ---- --notify ----

test('--notify sends one notification when over budget, none when under, and needs --check', async () => {
  const sent = [];
  const run = (config) => handleAi({
    ...context(['--check', '--notify'], { config }), stdout: capture(), stderr: capture(), notify: (message) => sent.push(message),
  });
  assert.equal(await run({ aiBudget: 0.02 }), 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^AI cost: .* this month \(\d+% of \$0\.02\)/);
  assert.equal(await run({ aiBudget: 5 }), 0);
  assert.equal(sent.length, 1, 'under budget: no notification');
  assert.equal(await run({}), 2);
  assert.equal(sent.length, 1, 'no budget set: nothing to notify about');

  await assert.rejects(collectAi(context(['--notify'])), /--notify works with --check/);
  await assert.rejects(collectAi(context(['--check', '--notify', '--json'])), /cannot be combined with --json/);
  assert.throws(() => require('../src/utils/args').validateCommandFlags('doctor', parseArgs(['doctor', '--notify']).options, {}), /--notify/);
});

test('an unusual day notifies even when the budget is fine', () => {
  const sent = [];
  const send = (message) => sent.push(message);
  const status = {
    budget_usd: 100, over: false, today_usd: 30, month_usd: 40, percent: 40, anomaly: { flagged: true, today_usd: 30, usual_usd: 5 },
  };
  notifyBudget({ notify: send }, status);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /6\.0x your usual day/);
  notifyBudget({ notify: send }, { ...status, anomaly: { flagged: false } });
  notifyBudget({ notify: send }, {
    ...status, budget_usd: null, over: null, anomaly: undefined,
  });
  assert.equal(sent.length, 1);
});

// ---- aiTools and aiSourceRoots ----

test('aiTools is the default tool list; --tool still wins; the budget follows aiTools', async () => {
  const only = (await collectAi(context(['--by', 'tool'], { config: { aiTools: ['codex'] } }))).report;
  assert.deepEqual(only.rows.map((row) => row.key), ['codex']);
  const chosen = (await collectAi(context(['--by', 'tool', '--tool', 'claude'], { config: { aiTools: ['codex'] } }))).report;
  assert.deepEqual(chosen.rows.map((row) => row.key), ['claude']);
  const budget = (await collectAi(context(['--check'], { config: { aiTools: ['codex'], aiBudget: 1 } }))).budget;
  assert.ok(Math.abs(budget.month_usd - 0.01388) < 1e-9, budget.month_usd);
  const tools = (await collectAi(context(['--tools'], { config: { aiTools: ['codex'] } }))).data;
  assert.deepEqual(tools.filter((source) => source.enabled).map((source) => source.tool), ['codex']);
});

test('aiSourceRoots adds folders to read; overlapping folders never count a file twice', async () => {
  const extra = tempDir();
  fs.cpSync(path.join(FIXTURES, 'codex'), path.join(extra, 'copy'), { recursive: true });
  const base = { homeDir: tempDir(), dirs: { claude: tempDir(), codex: tempDir() }, tools: ['codex'] };
  assert.equal((await scan(base)).usages.length, 0);
  const withRoot = await scan({ ...base, roots: { codex: [path.join(extra, 'copy')] } });
  assert.equal(withRoot.usages.length, 4);
  assert.deepEqual(withRoot.stats.missing, []);
  const overlapping = await scan({
    ...base,
    dirs: { codex: path.join(FIXTURES, 'codex') },
    roots: { codex: [path.join(FIXTURES, 'codex'), path.join(FIXTURES, 'codex', '2026')] },
  });
  assert.equal(overlapping.usages.length, 4);

  const described = describeSources({ ...base, roots: { codex: ['/extra/codex'] } }).find((source) => source.tool === 'codex');
  assert.deepEqual(described.extra, ['/extra/codex']);
});

test('aiTools and aiSourceRoots are config keys with their own checks', () => {
  const { home } = tempHome();
  const file = path.join(home, 'config.json');
  assert.deepEqual(setConfigValue('aiTools', 'claude, codex,claude', { file }).aiTools, ['claude', 'codex']);
  assert.throws(() => setConfigValue('aiTools', 'claude,vim', { file }), /aiTools must be a comma-separated list/);
  assert.equal(setConfigValue('aiTools', 'off', { file }).aiTools, undefined);

  const folder = path.resolve(path.sep, 'mnt', 'codex');
  const other = path.resolve(path.sep, 'mnt', 'other');
  setConfigValue('aiSourceRoots', `codex=${folder}`, { file });
  setConfigValue('aiSourceRoots', `codex=${folder}`, { file });
  const added = setConfigValue('aiSourceRoots', `codex=${other}`, { file });
  assert.deepEqual(added.aiSourceRoots, { codex: [folder, other] });
  assert.deepEqual(loadConfig({ file }).aiSourceRoots, { codex: [folder, other] });
  assert.throws(() => setConfigValue('aiSourceRoots', 'codex=relative/dir', { file }), /aiSourceRoots takes/);
  assert.throws(() => setConfigValue('aiSourceRoots', 'vim=/x', { file }), /aiSourceRoots takes/);
  assert.throws(() => setConfigValue('aiSourceRoots', folder, { file }), /aiSourceRoots takes/);
  setConfigValue('aiSourceRoots', `opencode=${folder}`, { file });
  assert.deepEqual(Object.keys(setConfigValue('aiSourceRoots', 'codex=off', { file }).aiSourceRoots), ['opencode']);
  assert.equal(setConfigValue('aiSourceRoots', 'off', { file }).aiSourceRoots, undefined);
  fs.writeFileSync(file, JSON.stringify({ aiSourceRoots: { codex: ['relative'] } }));
  assert.throws(() => loadConfig({ file }), /aiSourceRoots must map/);
});

// ---- the 30-second --short cache ----

test('the short cache answers for 30 seconds, then for nothing that changed', () => {
  const { home } = tempHome();
  const base = {
    argv: ['ai', '--short'], homeDir: home, cwd: '/work', version: '9.9.9',
  };
  const write = () => writeShort({
    ...base, now: 1_000_000, stdout: '$1.00 today\n', stderr: 'note\n', exitCode: 1,
  });
  assert.equal(readShort({ ...base, now: 1_000_000 }), undefined, 'nothing written yet');
  write();
  assert.deepEqual(readShort({ ...base, now: 1_000_000 + TTL_MS - 1 }), { stdout: '$1.00 today\n', stderr: 'note\n', exitCode: 1 });
  assert.equal(readShort({ ...base, now: 1_000_000 + TTL_MS }), undefined, 'expired');
  assert.equal(readShort({ ...base, now: 999_999 }), undefined, 'a clock that went back is not trusted');
  assert.equal(readShort({ ...base, cwd: '/elsewhere', now: 1_000_001 }), undefined, 'another folder (--here)');
  assert.equal(readShort({ ...base, version: '9.9.10', now: 1_000_001 }), undefined, 'another version');
  assert.equal(readShort({ ...base, argv: ['ai', '--short', '--tool', 'codex'], now: 1_000_001 }), undefined, 'another command line');
  writeFile(path.join(home, '.devcmd', 'config.json'), { aiBudget: 5 });
  assert.equal(readShort({ ...base, now: 1_000_001 }), undefined, 'the config changed after the entry was written');
  write();
  assert.ok(readShort({ ...base, now: 1_000_001 }));
  fs.writeFileSync(path.join(home, '.devcmd', 'ai-short-cache.json'), '{ not json');
  assert.equal(readShort({ ...base, now: 1_000_001 }), undefined, 'a damaged file is a miss, not an error');
});

test('only a plain --short call is cached', () => {
  assert.equal(cacheable(['ai', '--short']), true);
  assert.equal(cacheable(['ai', '--short', '--tool', 'claude']), true);
  for (const flag of ['--dry-run', '--no-cache', '--json', '--notify']) assert.equal(cacheable(['ai', '--short', flag]), false, flag);
  assert.equal(cacheable(['ai']), false);
  assert.equal(cacheable(['ai', 'today']), false);
  assert.equal(cacheable(['disk', '--short']), false);
});

test('dev ai --short is answered from the cache on the second call, and --dry-run skips it', () => {
  const { home, env } = tempHome();
  const logs = tempDir();
  fs.cpSync(path.join(FIXTURES, 'claude'), path.join(logs, 'claude'), { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'codex'), path.join(logs, 'codex'), { recursive: true });
  const args = ['--short', '--claude-dir', path.join(logs, 'claude'), '--codex-dir', path.join(logs, 'codex')];
  const run = (extra = []) => spawnSync(process.execPath, [path.join(root, 'dev'), 'ai', ...args, ...extra], { encoding: 'utf8', env });

  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /this month/);
  assert.ok(fs.existsSync(path.join(home, '.devcmd', 'ai-short-cache.json')));

  // With the logs gone, only the cache can still produce the same line.
  fs.rmSync(path.join(logs, 'claude'), { recursive: true });
  fs.rmSync(path.join(logs, 'codex'), { recursive: true });
  const second = run();
  assert.equal(second.status, first.status);
  assert.equal(second.stdout, first.stdout);
  assert.equal(second.stderr, first.stderr);

  const fresh = run(['--dry-run']);
  assert.notEqual(fresh.stdout, first.stdout, '--dry-run reads the logs again');
});
