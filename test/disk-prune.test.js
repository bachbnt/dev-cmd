// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pruneItems } = require('../src/disk/prune');
const { readPruneLog } = require('../src/disk/audit');
const { scanAll, scanProjects, discoverProjects } = require('../src/disk/scan');
const {
  assertRemovable, isGitIgnored, lastCommitAgeDays, protectedReason,
} = require('../src/disk/safety');
const { moveToTrash, WINDOWS_SCRIPT } = require('../src/disk/trash');
const {
  git, gitRepo, tempDir, writeFile,
} = require('./helpers');

const NOW = Date.parse('2026-11-26T00:00:00Z');
const noRealPath = { realpathSync() { throw new Error('no'); } };

// A Node project: lockfile, ignored node_modules, an old commit.
function nodeProject(root, { ignore = ['node_modules', 'dist'], commitDate, files = {} } = {}) {
  gitRepo(root, {
    files: { 'package.json': '{"name":"p"}', 'package-lock.json': '{}', ...files }, ignore, commitDate,
  });
  writeFile(path.join(root, 'node_modules', 'dep', 'index.js'), 'x'.repeat(5000));
  return root;
}

test('the deny list protects your folders, the system, and home itself, on every platform', () => {
  const posix = { homeDir: '/Users/a', platform: 'darwin', fsImpl: noRealPath };
  for (const target of ['/Users/a', '/Users/a/Documents', '/Users/a/Documents/x/y', '/Users/a/Desktop', '/Users/a/Library/Keychains/login.keychain',
    '/Users/a/Library/Mobile Documents/x', '/', '/System/Library', '/usr/local', '/etc/hosts', '/Library', '/Volumes/Disk', '/Users/a/Library/Application Support/MobileSync/Backup']) {
    assert.ok(protectedReason(target, posix), target);
  }
  for (const target of ['/Users/a/Library/Caches/foo', '/Users/a/project/node_modules', '/Users/a/Library/Developer/Xcode/DerivedData']) {
    assert.equal(protectedReason(target, posix), undefined, target);
  }
  const win = { homeDir: 'C:\\Users\\a', platform: 'win32', fsImpl: noRealPath };
  for (const target of ['C:\\', 'C:\\Windows\\System32', 'C:\\Program Files\\App', 'C:\\Users\\a', 'C:\\Users\\a\\Documents\\x', 'C:\\Users', 'c:\\users\\A\\documents']) {
    assert.ok(protectedReason(target, win), target);
  }
  assert.equal(protectedReason('C:\\Users\\a\\proj\\node_modules', win), undefined);
});

test('the deny list is checked on the real path, so a link into a protected folder does not get around it', (t) => {
  const home = tempDir();
  const documents = path.join(home, 'Documents');
  fs.mkdirSync(path.join(documents, 'inner'), { recursive: true });
  const link = path.join(home, 'shortcut');
  try {
    fs.symlinkSync(path.join(documents, 'inner'), link);
  } catch {
    t.skip('symbolic links not available');
    return;
  }
  assert.match(protectedReason(link, { homeDir: home, platform: process.platform }), /protected/);
});

test('assertRemovable refuses a path whose real location left the allowed folder', (t) => {
  const root = tempDir();
  const outside = tempDir();
  fs.mkdirSync(path.join(outside, 'secret'));
  try {
    fs.symlinkSync(path.join(outside, 'secret'), path.join(root, 'node_modules'));
  } catch {
    t.skip('symbolic links not available');
    return;
  }
  const verdict = assertRemovable(path.join(root, 'node_modules'), { allowedRoots: [root], homeDir: tempDir() });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /outside the allowed folder/);
  assert.equal(assertRemovable(path.join(root, 'gone'), { allowedRoots: [root], homeDir: tempDir() }).reason, 'it no longer exists');
});

test('Git helpers: ignored, not ignored, not a repository, last commit age', () => {
  const root = nodeProject(path.join(tempDir(), 'p'));
  assert.equal(isGitIgnored(root, 'node_modules'), true);
  assert.equal(isGitIgnored(root, 'src'), false);
  assert.equal(isGitIgnored(tempDir(), 'node_modules'), undefined);
  assert.ok(lastCommitAgeDays(root, { now: NOW }) > 2000);
  assert.equal(lastCommitAgeDays(tempDir()), undefined);
});

test('a dependency folder is safe only when it passes every gate', async () => {
  const root = nodeProject(path.join(tempDir(), 'old'));
  const [item] = await scanProjects([root], { now: NOW });
  assert.equal(item.artifact, 'node_modules');
  assert.equal(item.tier, 'safe');
  assert.deepEqual(item.reasons, []);
  assert.equal(item.artifactKind, 'reinstall');
  assert.ok(item.bytes >= 5000);
  assert.ok(item.ageDays > 2000);
});

test('each failed gate downgrades to review with a reason, and tracked files block', async () => {
  const noLock = path.join(tempDir(), 'nolock');
  gitRepo(noLock, { files: { 'package.json': '{}' }, ignore: ['node_modules'] });
  writeFile(path.join(noLock, 'node_modules', 'a.js'), 'x');
  assert.match((await scanProjects([noLock], { now: NOW }))[0].reasons.join(), /no lockfile/);

  const notIgnored = path.join(tempDir(), 'notignored');
  gitRepo(notIgnored, { files: { 'package.json': '{}', 'package-lock.json': '{}' }, ignore: [] });
  writeFile(path.join(notIgnored, 'node_modules', 'a.js'), 'x');
  const noIgnore = (await scanProjects([notIgnored], { now: NOW }))[0];
  assert.equal(noIgnore.tier, 'review');
  assert.match(noIgnore.reasons.join(), /Git does not ignore it/);

  const noManifest = path.join(tempDir(), 'nomanifest');
  gitRepo(noManifest, { files: { 'README.md': 'x' }, ignore: ['node_modules'] });
  writeFile(path.join(noManifest, 'node_modules', 'a.js'), 'x');
  assert.match((await scanProjects([noManifest], { now: NOW }))[0].reasons.join(), /no package\.json next to it/);

  const noGit = path.join(tempDir(), 'nogit');
  writeFile(path.join(noGit, 'package.json'), '{}');
  writeFile(path.join(noGit, 'package-lock.json'), '{}');
  writeFile(path.join(noGit, 'node_modules', 'a.js'), 'x');
  assert.match((await scanProjects([noGit], { now: NOW }))[0].reasons.join(), /not a Git repository/);

  const recent = nodeProject(path.join(tempDir(), 'recent'), { commitDate: '2026-11-25T00:00:00Z' });
  const recentItem = (await scanProjects([recent], { now: NOW }))[0];
  assert.equal(recentItem.tier, 'review');
  assert.match(recentItem.reasons.join(), /used 1 day/);
  assert.equal((await scanProjects([recent], { now: NOW, olderThanDays: 0 }))[0].tier, 'safe');

  const tracked = nodeProject(path.join(tempDir(), 'tracked'), { ignore: [], files: { 'dist/app.js': 'x' } });
  const trackedItem = (await scanProjects([tracked], { now: NOW })).find((item) => item.artifact === 'dist');
  assert.equal(trackedItem.tier, 'blocked');
  assert.match(trackedItem.reasons.join(), /tracked by Git/);
});

test('projects are found under a root, skipping dependency and hidden folders', () => {
  const root = tempDir();
  writeFile(path.join(root, 'a', 'package.json'), '{}');
  writeFile(path.join(root, 'a', 'node_modules', 'dep', 'package.json'), '{}');
  writeFile(path.join(root, 'b', 'deeper', 'pyproject.toml'), '');
  writeFile(path.join(root, '.hidden', 'package.json'), '{}');
  assert.deepEqual(discoverProjects([root]).map((found) => path.relative(root, found)).sort(), ['a', path.join('b', 'deeper')]);
});

test('a project under Desktop can be cleaned, because its folder passed every gate; other kinds stay protected there', async () => {
  const home = tempDir();
  const root = nodeProject(path.join(home, 'Desktop', 'source', 'app'));
  const [item] = await scanProjects([root], { now: NOW });
  assert.equal(item.tier, 'safe');
  const [result] = await pruneItems([item], { homeDir: home, olderThanDays: 30 });
  assert.equal(result.status, 'removed');
  assert.equal(protectedReason(path.join(home, 'Desktop', 'source', 'app'), { homeDir: home }) !== undefined, true);
  assert.equal(protectedReason(path.join(home, 'Desktop', 'source', 'app', 'node_modules'), { homeDir: home, allowUserFolderContents: true }), undefined);
});

test('prune removes a safe project folder, logs it, and a dry run removes nothing', async () => {
  const home = tempDir();
  const root = nodeProject(path.join(tempDir(), 'p'));
  const [item] = await scanProjects([root], { now: NOW });

  const [dry] = await pruneItems([item], { homeDir: home, dryRun: true, olderThanDays: 30 });
  assert.equal(dry.status, 'would-remove');
  assert.equal(dry.method, 'deleted');
  assert.ok(fs.existsSync(path.join(root, 'node_modules')));
  assert.deepEqual(readPruneLog({ homeDir: home }), []);

  const [done] = await pruneItems([item], { homeDir: home, olderThanDays: 30 });
  assert.equal(done.status, 'removed');
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
  assert.ok(fs.existsSync(path.join(root, 'package.json')));
  const [entry] = readPruneLog({ homeDir: home });
  assert.equal(entry.result, 'removed');
  assert.equal(entry.method, 'deleted');
  assert.equal(entry.path, path.join(root, 'node_modules'));
  assert.ok(entry.at);
});

test('prune checks again just before removing: a folder that stopped being safe is skipped', async () => {
  const home = tempDir();
  const root = nodeProject(path.join(tempDir(), 'p'));
  const [item] = await scanProjects([root], { now: NOW });
  // After the scan the lockfile disappears: the install would no longer be reproducible.
  fs.rmSync(path.join(root, 'package-lock.json'));
  const [result] = await pruneItems([item], { homeDir: home, olderThanDays: 30 });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /changed since the scan/);
  assert.ok(fs.existsSync(path.join(root, 'node_modules')));
});

test('review items need permission and then go to the Trash, never a permanent delete', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.Trash'));
  const root = nodeProject(path.join(tempDir(), 'p'), { commitDate: '2026-11-25T00:00:00Z' });
  const [item] = await scanProjects([root], { now: NOW });
  assert.equal(item.tier, 'review');
  const [refused] = await pruneItems([item], { homeDir: home, olderThanDays: 30 });
  assert.equal(refused.status, 'skipped');
  assert.match(refused.reason, /needs review/);
  const [moved] = await pruneItems([item], {
    homeDir: home, allowReview: true, olderThanDays: 30, platform: 'darwin',
  });
  assert.equal(moved.status, 'removed');
  assert.equal(moved.method, 'moved-to-trash');
  assert.ok(fs.existsSync(path.join(home, '.Trash', 'node_modules')));
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
});

test('when the Trash cannot be used nothing is deleted', async () => {
  const home = tempDir(); // no .Trash folder
  const target = path.join(tempDir(), 'cache');
  writeFile(path.join(target, 'f'), 'x');
  const result = moveToTrash(target, { homeDir: home, platform: 'darwin' });
  assert.equal(result.ok, false);
  assert.ok(fs.existsSync(target));
  const noGio = moveToTrash(target, { platform: 'linux', env: { PATH: '' } });
  assert.equal(noGio.ok, false);
  assert.match(noGio.reason, /gio/);
  assert.ok(fs.existsSync(target));
});

test('the Trash gives a free name and the Windows script never contains the path', () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.Trash', 'dist'), { recursive: true });
  const target = path.join(tempDir(), 'dist');
  writeFile(path.join(target, 'f'), 'x');
  const result = moveToTrash(target, { homeDir: home, platform: 'darwin' });
  assert.equal(path.basename(result.destination), 'dist 1');
  const calls = [];
  moveToTrash('C:\\x y\\"quoted"; calc', { platform: 'win32', spawnSync: (exe, args, options) => { calls.push({ exe, args, options }); return { status: 0 }; } });
  assert.equal(calls[0].exe, 'powershell.exe');
  assert.ok(calls[0].args.every((arg) => !arg.includes('calc')));
  assert.equal(calls[0].options.env.DEVCMD_TRASH_PATH.includes('calc'), true);
  assert.match(WINDOWS_SCRIPT, /\$env:DEVCMD_TRASH_PATH/);
});

test('the deny list stops a deletion even when an item asks for it', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, 'Documents', 'work'), { recursive: true });
  const target = path.join(home, 'Documents', 'work');
  const [result] = await pruneItems([{
    id: target, kind: 'app-cache', path: target, bytes: 1, tier: 'review', reasons: [],
  }], { homeDir: home, allowReview: true });
  assert.equal(result.status, 'skipped');
  assert.equal(result.blockedByDenyList, true);
  // Your folders themselves are protected even for a project item.
  for (const folder of ['Documents', 'Desktop']) {
    const protectedFolder = path.join(home, folder);
    fs.mkdirSync(protectedFolder, { recursive: true });
    const [folderResult] = await pruneItems([{
      id: folder, kind: 'project-artifact', path: protectedFolder, projectRoot: home, artifact: 'node_modules', bytes: 1, tier: 'safe', reasons: [],
    }], { homeDir: home });
    assert.equal(folderResult.blockedByDenyList, true, folder);
    assert.ok(fs.existsSync(protectedFolder));
  }
  assert.ok(fs.existsSync(target));
});

test('blocked and display-only items never run', async () => {
  const home = tempDir();
  const target = path.join(home, '.cache-x');
  fs.mkdirSync(target);
  const [blocked] = await pruneItems([{ id: 'b', kind: 'global-cache', path: target, bytes: 1, tier: 'blocked', reasons: ['shown only'] }], { homeDir: home, allowReview: true });
  assert.equal(blocked.status, 'skipped');
  const [info] = await pruneItems([{ id: 'i', kind: 'info', path: target, bytes: 1, tier: 'safe', displayOnly: true, reasons: [] }], { homeDir: home });
  assert.equal(info.status, 'skipped');
  const [admin] = await pruneItems([{ id: 'a', kind: 'global-cache', path: target, bytes: 1, tier: 'safe', needsAdmin: true, reasons: [], clean: { paths: [target] } }], { homeDir: home });
  assert.match(admin.reason, /administrator/);
  assert.ok(fs.existsSync(target));
});

test('a global cache is cleaned by its tool command, and a failing command is reported', async () => {
  const home = tempDir();
  const cache = path.join(home, '.npm');
  writeFile(path.join(cache, 'f'), 'x'.repeat(20_000));
  const calls = [];
  const item = {
    id: 'npm', kind: 'global-cache', path: cache, paths: [cache], bytes: 20_000, tier: 'safe', reasons: [], clean: { executable: 'npm', args: ['cache', 'clean', '--force'] },
  };
  const [dry] = await pruneItems([item], { homeDir: home, dryRun: true, spawnSync: () => { throw new Error('must not run'); } });
  assert.equal(dry.status, 'would-run');
  assert.equal(dry.command, 'npm cache clean --force');
  const [ok] = await pruneItems([item], {
    homeDir: home,
    spawnSync: (executable, args) => { calls.push([executable, ...args]); fs.rmSync(cache, { recursive: true }); return { status: 0 }; },
  });
  assert.deepEqual(calls, [['npm', 'cache', 'clean', '--force']]);
  assert.equal(ok.status, 'removed');
  assert.equal(ok.method, 'tool-command');
  assert.ok(ok.freedBytes > 0);
  const [bad] = await pruneItems([item], { homeDir: home, spawnSync: () => ({ status: 1, stderr: 'boom\nmore' }) });
  assert.equal(bad.status, 'failed');
  assert.equal(bad.reason, 'boom');
  assert.deepEqual(readPruneLog({ homeDir: home }).map((entry) => entry.result), ['removed', 'failed']);
});

test('a folder cleaner (Xcode DerivedData) deletes only that folder inside the home', async () => {
  const home = tempDir();
  const derived = path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData');
  writeFile(path.join(derived, 'App-abc', 'x.o'), 'x');
  const item = {
    id: 'xcode-derived-data', kind: 'global-cache', path: derived, paths: [derived], bytes: 1, tier: 'safe', reasons: [], clean: { paths: ['{home}/Library/Developer/Xcode/DerivedData'] },
  };
  const [result] = await pruneItems([item], { homeDir: home, platform: 'darwin' });
  assert.equal(result.status, 'removed');
  assert.equal(fs.existsSync(derived), false);
  assert.ok(fs.existsSync(path.join(home, 'Library', 'Developer', 'Xcode')));
});

test('scanAll finds projects under roots and totals what is safe to free', async () => {
  const home = tempDir();
  const parent = tempDir();
  nodeProject(path.join(parent, 'old'));
  nodeProject(path.join(parent, 'recent'), { commitDate: '2026-11-25T00:00:00Z' });
  const result = await scanAll({
    homeDir: home, roots: [parent], olderThanDays: 30, now: NOW,
  });
  const projects = result.items.filter((item) => item.kind === 'project-artifact');
  assert.equal(projects.length, 2);
  assert.deepEqual(projects.map((item) => item.tier).sort(), ['review', 'safe']);
  assert.equal(result.totals.reclaimableBytes, projects.find((item) => item.tier === 'safe').bytes + result.items.filter((item) => item.kind !== 'project-artifact' && item.tier === 'safe').reduce((sum, item) => sum + item.bytes, 0));
  assert.equal(result.projectCount, 2);
});

test('the deletion log never leaves this computer: nothing in src writes or reads it outside the prune code', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') && /pruneLogFile|readPruneLog|logPrune/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(path.join(__dirname, '..', 'src'), full));
    }
  };
  walk(path.join(__dirname, '..', 'src'));
  const allowed = ['config/paths.js', 'disk/audit.js', 'disk/prune.js', 'handlers/prune.js'].map((file) => file.split('/').join(path.sep));
  assert.deepEqual(offenders.filter((file) => !allowed.includes(file)), []);
});

test('git helper works inside a repository created by the tests', () => {
  const root = nodeProject(path.join(tempDir(), 'p'));
  assert.equal(git(root, ['rev-parse', '--is-inside-work-tree']), 'true');
});
