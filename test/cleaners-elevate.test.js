// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectCleaners, expandPath, loadCleaners } = require('../src/cleaners');
const { validateCleaner } = require('../src/cleaners/schema');
const {
  buildElevatedCommand, parentsAreTrusted, planElevatedRemoval, runElevated,
} = require('../src/runner/elevate');
const { listTasks, runTask, validateTask } = require('../src/maintenance');
const { tempDir, writeFile } = require('./helpers');

const base = {
  id: 'x', name: 'X', category: 'dev-cache', platforms: ['linux'], detect: { executable: 'x' }, recreate: 'again', tier: 'safe', clean: { executable: 'x', args: ['clean'] },
};

test('every built-in cleaner is valid, safe ones can clean, and display-only ones cannot', () => {
  const registry = loadCleaners({ homeDir: tempDir() });
  assert.ok(registry.size >= 15);
  for (const cleaner of registry.values()) {
    if (cleaner.tier === 'blocked') assert.equal(cleaner.clean, undefined, cleaner.id);
    else assert.ok(cleaner.clean, cleaner.id);
    assert.equal(cleaner.needsAdmin, false, cleaner.id);
  }
  for (const id of ['ai-claude', 'ai-codex', 'ai-models']) assert.equal(registry.get(id).tier, 'blocked');
});

test('the schema rejects shells, unknown fields, bad paths, and unsafe combinations', () => {
  assert.doesNotThrow(() => validateCleaner(base, 't'));
  assert.throws(() => validateCleaner({ ...base, clean: { executable: 'bash', args: ['-c', 'rm -rf ~'] } }, 't'), /shell/);
  assert.throws(() => validateCleaner({ ...base, clean: { executable: 'C:\\Windows\\cmd.exe', args: [] } }, 't'), /shell/);
  assert.throws(() => validateCleaner({ ...base, colour: 1 }, 't'), /unknown field/);
  assert.throws(() => validateCleaner({ ...base, tier: 'maybe' }, 't'), /tier/);
  assert.throws(() => validateCleaner({ ...base, clean: undefined }, 't'), /only blocked/);
  assert.throws(() => validateCleaner({ ...base, clean: { paths: ['/etc'] } }, 't'), /must start with \{home\}/);
  assert.throws(() => validateCleaner({ ...base, clean: { executable: 'x', args: [], paths: ['{home}/a'] } }, 't'), /either/);
  assert.throws(() => validateCleaner({ ...base, id: 'Bad Id' }, 't'), /id must be/);
});

test('user cleaners replace built-ins by id but cannot ask for administrator rights', () => {
  const home = tempDir();
  writeFile(path.join(home, '.devcmd', 'cleaners', 'mine.json'), { ...base, id: 'npm', name: 'My npm' });
  assert.equal(loadCleaners({ homeDir: home }).get('npm').name, 'My npm');
  assert.equal(loadCleaners({ homeDir: home }).get('npm').source, 'user');
  assert.equal(loadCleaners({ homeDir: home, includeUser: false }).get('npm').name, 'npm cache');
  writeFile(path.join(home, '.devcmd', 'cleaners', 'mine.json'), { ...base, needsAdmin: true });
  assert.throws(() => loadCleaners({ homeDir: home }), /cannot request administrator rights/);
  writeFile(path.join(home, '.devcmd', 'cleaners', 'mine.json'), '{oops');
  assert.throws(() => loadCleaners({ homeDir: home }), /Unable to read cleaner/);
});

test('detection follows the platform and expands {home} and {localappdata}', () => {
  const home = tempDir();
  writeFile(path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData', 'a'), 'x');
  const registry = loadCleaners({ homeDir: home, includeUser: false });
  const mac = detectCleaners(registry, { homeDir: home, platform: 'darwin', env: { PATH: '' } }).map((entry) => entry.cleaner.id);
  assert.deepEqual(mac, ['xcode-derived-data']);
  assert.deepEqual(detectCleaners(registry, { homeDir: home, platform: 'linux', env: { PATH: '' } }), []);
  assert.equal(expandPath('{localappdata}/npm-cache', { homeDir: 'C:\\Users\\a', env: { LOCALAPPDATA: 'D:\\Local' } }), path.normalize('D:\\Local/npm-cache'));
  assert.equal(expandPath('{home}/.npm', { homeDir: '/h' }), path.normalize('/h/.npm'));
});

// --- Elevation (docs/PLAN-disk-and-ai.md, 4.12) ---

test('elevated commands are sudo -k -- with absolute executables, and never take a password', () => {
  assert.deepEqual(buildElevatedCommand({ executable: '/usr/bin/mdutil', args: ['-E', '/'] }), { executable: 'sudo', args: ['-k', '--', '/usr/bin/mdutil', '-E', '/'] });
  assert.throws(() => buildElevatedCommand({ executable: 'mdutil' }), /absolute/);
  // The source of every file that can elevate must not read passwords.
  for (const file of ['runner/elevate.js', 'maintenance/index.js', 'handlers/prune.js', 'disk/prune.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(source, /['"]-S['"]|--stdin|askpass|SUDO_ASKPASS|password\s*\(/i, file);
  }
});

test('elevation needs a terminal, a confirmation, and refuses Windows', async () => {
  const calls = [];
  const spawnSync = (executable, args, options) => { calls.push({ executable, args, options }); return { status: 0 }; };
  const command = { executable: '/usr/bin/dscacheutil', args: ['-flushcache'] };
  assert.match((await runElevated([command], { isTTY: false, confirm: () => true, spawnSync, platform: 'darwin' })).reason, /interactive terminal/);
  assert.equal((await runElevated([command], { isTTY: true, confirm: () => false, spawnSync, platform: 'darwin' })).reason, 'not confirmed');
  assert.equal((await runElevated([command], { isTTY: true, spawnSync, platform: 'darwin' })).reason, 'not confirmed');
  assert.match((await runElevated([command], { isTTY: true, confirm: () => true, spawnSync, platform: 'win32' })).reason, /Windows/);
  assert.equal(calls.length, 0);

  let shown;
  const ok = await runElevated([command], { isTTY: true, confirm: (text) => { shown = text; return true; }, spawnSync, platform: 'darwin' });
  assert.equal(ok.ok, true);
  assert.match(shown, /sudo -k -- \/usr\/bin\/dscacheutil -flushcache/);
  assert.deepEqual(calls[0].args, ['-k', '--', '/usr/bin/dscacheutil', '-flushcache']);
  // The password goes from the keyboard straight to sudo: stdio is inherited, nothing is piped.
  assert.equal(calls[0].options.stdio, 'inherit');
  assert.equal(calls[0].options.input, undefined);
});

test('--yes cannot replace the elevation prompt: administrator tasks do not run from the command line', async () => {
  const { collectPrune } = require('../src/handlers/prune');
  const { parseArgs } = require('../src/utils/args');
  const parsed = parseArgs(['prune', 'maintenance', '--only', 'flush-dns', '--yes']);
  const result = await collectPrune({
    options: parsed.options, positionals: parsed.positionals, homeDir: tempDir(), platform: 'darwin',
  });
  assert.equal(result.data.results[0].status, 'skipped');
  assert.match(result.data.results[0].reason, /needs administrator rights/);
});

test('root removal refuses protected paths, user-writable parents, and links; it builds /bin/rm with a real path', () => {
  assert.equal(planElevatedRemoval('/usr/bin/true', { platform: 'darwin', fsImpl: { realpathSync: (file) => file } }).ok, false);
  assert.equal(planElevatedRemoval('/etc', { platform: 'darwin', fsImpl: { realpathSync: (file) => file } }).ok, false);
  assert.match(planElevatedRemoval('/Library/Apple/x', { platform: 'darwin', fsImpl: { realpathSync: (file) => file, lstatSync: () => ({ uid: 0, mode: 0o755 }) } }).reason, /protected|never removed/);
  assert.match(planElevatedRemoval('C:\\x', { platform: 'win32' }).reason, /Windows/);
  assert.match(planElevatedRemoval(path.join(tempDir(), 'none'), { platform: 'linux' }).reason, /does not exist/);

  const owned = (uid, mode) => ({ lstatSync: () => ({ uid, mode }), realpathSync: (file) => file });
  assert.equal(parentsAreTrusted('/a/b/c', owned(0, 0o755)).ok, true);
  assert.match(parentsAreTrusted('/a/b/c', owned(501, 0o755)).reason, /not owned by root/);
  assert.match(parentsAreTrusted('/a/b/c', owned(0, 0o775)).reason, /someone other than root/);
  assert.match(parentsAreTrusted('/a/b/c', owned(0, 0o757)).reason, /someone other than root/);

  const fake = { ...owned(0, 0o755), realpathSync: (file) => (file === '/Library/Logs/old' ? '/private/var/old' : file) };
  const plan = planElevatedRemoval('/Library/Logs/old', { platform: 'darwin', fsImpl: fake, homeDir: '/Users/a' });
  assert.deepEqual(plan.command, { executable: '/bin/rm', args: ['-rf', '--', '/private/var/old'] });
});

test('a user-owned folder is never removed as root, because a parent is not owned by root', () => {
  const dir = tempDir();
  writeFile(path.join(dir, 'f'), 'x');
  assert.equal(planElevatedRemoval(path.join(dir, 'f')).ok, false);
});

test('maintenance tasks: administrator tasks use absolute paths, no shells, and run through elevation', async () => {
  const tasks = listTasks({ platform: 'darwin' });
  assert.ok(tasks.find((task) => task.id === 'flush-dns').needsAdmin);
  for (const task of tasks) assert.equal(typeof task.does, 'string', task.id);
  assert.throws(() => validateTask({ id: 'bad', needsAdmin: true, command: { executable: 'rm', args: [] } }), /absolute/);
  assert.throws(() => validateTask({ id: 'bad', needsAdmin: false, command: { executable: 'bash', args: ['-c', 'x'] } }), /shell/);
  assert.equal(listTasks({ platform: 'win32' }).every((task) => task.platforms.includes('win32')), true);

  const calls = [];
  const spawnSync = (executable, args) => { calls.push([executable, ...args]); return { status: 0 }; };
  const flush = tasks.find((task) => task.id === 'flush-dns');
  const result = await runTask(flush, { confirm: () => true, isTTY: true, spawnSync, platform: 'darwin' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['sudo', '-k', '--', '/usr/bin/dscacheutil', '-flushcache'],
    ['sudo', '-k', '--', '/usr/bin/killall', '-HUP', 'mDNSResponder'],
  ]);
  const dock = tasks.find((task) => task.id === 'restart-dock');
  calls.length = 0;
  await runTask(dock, { spawnSync, platform: 'darwin' });
  assert.deepEqual(calls, [['/usr/bin/killall', 'Dock']]);
});
