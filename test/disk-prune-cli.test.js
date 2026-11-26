// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectDisk } = require('../src/handlers/disk');
const { collectPrune } = require('../src/handlers/prune');
const { loadTrend, recordTrend, trendRows } = require('../src/disk/trend');
const { scanToolVersions } = require('../src/disk/tools');
const { parseArgs, validateCommandFlags } = require('../src/utils/args');
const {
  fakeClock, gitRepo, tempDir, tempHome, writeFile,
} = require('./helpers');

const root = path.join(__dirname, '..');
const clock = fakeClock('2026-11-26T12:00:00Z');

function project(parent, name) {
  const dir = path.join(parent, name);
  gitRepo(dir, { files: { 'package.json': '{"name":"p","engines":{"node":">=18"}}', 'package-lock.json': '{}' }, ignore: ['node_modules'] });
  writeFile(path.join(dir, 'node_modules', 'dep', 'i.js'), 'x'.repeat(4000));
  return dir;
}

function context(command, args, home) {
  const { options, positionals } = parseArgs([command, ...args]);
  return {
    command, options, positionals, homeDir: home, now: clock.now, platform: 'darwin',
  };
}

test('dev prune lists but never removes without --yes and a selection', async () => {
  const home = tempDir();
  const projects = tempDir();
  const dir = project(projects, 'old');
  const result = await collectPrune(context('prune', ['projects', '--root', projects], home));
  assert.equal(result.mode, 'plan');
  assert.equal(result.data.items.filter((item) => item.kind === 'project-artifact').length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'node_modules')));

  const selected = await collectPrune(context('prune', ['projects', '--root', projects, '--only', 'old/node_modules'], home));
  assert.equal(selected.mode, 'plan');
  assert.equal(selected.data.plan[0].status, 'would-remove');
  assert.ok(fs.existsSync(path.join(dir, 'node_modules')));

  const yesOnly = await collectPrune(context('prune', ['projects', '--root', projects, '--yes'], home));
  assert.equal(yesOnly.mode, 'plan', '--yes with no selection removes nothing');
  assert.ok(fs.existsSync(path.join(dir, 'node_modules')));
});

test('dev prune --only --yes removes the chosen safe folder; --dry-run overrides --yes', async () => {
  const home = tempDir();
  const projects = tempDir();
  const dir = project(projects, 'old');
  const dry = await collectPrune(context('prune', ['projects', '--root', projects, '--only', dir + '/node_modules', '--yes', '--dry-run'], home));
  assert.equal(dry.mode, 'plan');
  assert.ok(fs.existsSync(path.join(dir, 'node_modules')));
  const real = await collectPrune(context('prune', ['projects', '--root', projects, '--only', path.join(dir, 'node_modules'), '--yes'], home));
  assert.equal(real.mode, 'result');
  assert.equal(real.data.removed, 1);
  assert.equal(fs.existsSync(path.join(dir, 'node_modules')), false);
  const log = await collectPrune(context('prune', ['--log'], home));
  assert.equal(log.data.entries.length, 1);
});

test('prune argument rules', async () => {
  const home = tempDir();
  await assert.rejects(collectPrune(context('prune', ['--all-safe'], home)), /needs --yes/);
  await assert.rejects(collectPrune(context('prune', ['everything'], home)), /Unknown prune target/);
  await assert.rejects(collectPrune(context('prune', ['projects', '--root', tempDir(), '--only', 'nothing'], home)), /Nothing matches --only nothing/);
  assert.throws(() => parseArgs(['prune', '--older-than', 'soon']), /--older-than requires a number/);
  const reject = (args, pattern) => {
    const { command, options } = parseArgs(args);
    assert.throws(() => validateCommandFlags(command, options, {}), pattern);
  };
  reject(['doctor', '--only', 'x'], /--only is only supported by the prune command/);
  reject(['doctor', '--all-safe'], /--all-safe is only supported by the prune command/);
  reject(['doctor', '--yes'], /--yes is only supported by: trust, prune/);
  reject(['prune', '--top'], /--top is only supported by the disk command/);
  reject(['disk', '--only', 'x'], /only supported by the prune command/);
});

test('prune never writes to dev history, so dev again cannot repeat a deletion', async () => {
  const home = tempDir();
  const projects = tempDir();
  const dir = project(projects, 'old');
  await collectPrune(context('prune', ['projects', '--root', projects, '--only', path.join(dir, 'node_modules'), '--yes'], home));
  assert.equal(fs.existsSync(path.join(home, '.devcmd', 'history.json')), false);
  const sources = ['handlers/prune.js', 'disk/prune.js', 'handlers/disk.js'].map((file) => fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /executeCommands|saveHistory|HISTORY_FILE/);
});

test('apps and maintenance targets list without removing anything', async () => {
  const home = tempDir();
  const maintenance = await collectPrune(context('prune', ['maintenance'], home));
  assert.ok(maintenance.data.tasks.length >= 5);
  await assert.rejects(collectPrune(context('prune', ['maintenance', '--only', 'nope', '--yes'], home)), /No maintenance task/);
});

test('dev disk reports sizes, tiers, and never deletes', async () => {
  const home = tempDir();
  const projects = tempDir();
  const dir = project(projects, 'old');
  const { mode, data, exitCode } = await collectDisk(context('disk', ['--root', projects], home));
  assert.equal(mode, 'report');
  assert.equal(exitCode, 0);
  const item = data.items.find((entry) => entry.kind === 'project-artifact');
  assert.equal(item.tier, 'safe');
  assert.equal(path.isAbsolute(item.path), true);
  assert.deepEqual(Object.keys(data.totals), ['bytes', 'reclaimableBytes']);
  assert.ok(fs.existsSync(path.join(dir, 'node_modules')));
  // The trend file keeps group totals only, no paths.
  const trend = fs.readFileSync(path.join(home, '.devcmd', 'disk-daily.json'), 'utf8');
  assert.doesNotMatch(trend, /old|node_modules/);
});

test('dev disk --check --threshold exits 1 over the limit; --large lists big files; --top refuses --json', async () => {
  const home = tempDir();
  const projects = tempDir();
  project(projects, 'old');
  writeFile(path.join(projects, 'old', 'movie.bin'), Buffer.alloc(2_000_000));
  const over = await collectDisk(context('disk', ['--root', projects, '--check', '--threshold', '1KB'], home));
  assert.equal(over.exitCode, 1);
  const under = await collectDisk(context('disk', ['--root', projects, '--check', '--threshold', '900GB'], home));
  assert.equal(under.exitCode, 0);
  await assert.rejects(collectDisk(context('disk', ['--check'], home)), /--check needs --threshold/);
  const large = await collectDisk(context('disk', ['--large', '--min-size', '1MB', '--root', projects], home));
  assert.deepEqual(large.data.files.map((file) => path.basename(file.path)), ['movie.bin']);
  await assert.rejects(collectDisk(context('disk', ['--top', '--json'], home)), /interactive/);
});

test('the trend keeps one entry per day and shows the change from the day before', () => {
  const home = tempDir();
  recordTrend(home, '2026-11-01', { project: 1, cache: 1, info: 0, total: 2, reclaimable: 1 });
  recordTrend(home, '2026-11-02', { project: 5, cache: 1, info: 0, total: 6, reclaimable: 1 });
  recordTrend(home, '2026-11-02', { project: 6, cache: 1, info: 0, total: 7, reclaimable: 1 });
  const rows = trendRows(loadTrend(home));
  assert.deepEqual(rows.map((row) => [row.day, row.total, row.change]), [['2026-11-01', 2, null], ['2026-11-02', 7, 5]]);
});

test('Node versions no project asks for are marked, and the active major is always in use', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', 'v14.0.0', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', 'v18.2.0', 'bin'), { recursive: true });
  const projectRoot = tempDir();
  writeFile(path.join(projectRoot, '.nvmrc'), 'v18\n');
  const versions = await scanToolVersions({ homeDir: home, projectRoots: [projectRoot], platform: 'linux', env: {} });
  const byVersion = Object.fromEntries(versions.map((version) => [version.version, version.inUse]));
  assert.equal(byVersion['14.0.0'], false);
  assert.equal(byVersion['18.2.0'], true);
});

test('dev disk --json and dev prune --json run from the binary with an isolated home', () => {
  const { env } = tempHome();
  const projects = tempDir();
  const dir = project(projects, 'old');
  const disk = spawnSync(process.execPath, [path.join(root, 'dev'), 'disk', '--root', projects, '--json'], { encoding: 'utf8', env });
  assert.equal(disk.status, 0, disk.stderr);
  assert.ok(JSON.parse(disk.stdout).items.some((item) => item.kind === 'project-artifact'));
  const prune = spawnSync(process.execPath, [path.join(root, 'dev'), 'prune', 'projects', '--root', projects, '--json'], { encoding: 'utf8', env });
  assert.equal(prune.status, 0, prune.stderr);
  assert.equal(JSON.parse(prune.stdout).plan.length, 0);
  assert.ok(fs.existsSync(path.join(dir, 'node_modules')));
  const deleting = spawnSync(process.execPath, [path.join(root, 'dev'), 'prune', 'projects', '--root', projects, '--only', path.join(dir, 'node_modules'), '--yes', '--json'], { encoding: 'utf8', env });
  assert.equal(deleting.status, 0, deleting.stderr);
  assert.equal(JSON.parse(deleting.stdout).removed, 1);
  assert.equal(fs.existsSync(path.join(dir, 'node_modules')), false);
});
