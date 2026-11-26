// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { platformSupport } = require('../src/apps');
const macos = require('../src/apps/macos');
const { pruneItems } = require('../src/disk/prune');
const { scanAppCaches } = require('../src/disk/appcaches');
const { tempDir, writeFile } = require('./helpers');

// A fake macOS home: ~/Applications/Fake.app and the files it leaves in ~/Library. `plutil` and
// `lsappinfo` are replaced by a stub, so these tests run on every platform.
function fakeMac({ running = [] } = {}) {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.Trash'));
  const app = path.join(home, 'Applications', 'Fake.app');
  writeFile(path.join(app, 'Contents', 'Info.plist'), 'plist');
  writeFile(path.join(app, 'Contents', 'MacOS', 'Fake'), 'x'.repeat(5000));
  const library = path.join(home, 'Library');
  for (const file of [
    'Caches/com.example.fake/c.bin', 'Preferences/com.example.fake.plist', 'Application Support/com.example.fake/data.db',
    'Application Support/Fake/other.db', 'Containers/com.example.fake/Data/x', 'Group Containers/ABC.com.example.fake/y', 'Logs/Fake/log.txt',
    'Application Support/Unrelated/keep.txt', 'LaunchAgents/com.example.fake.helper.plist',
  ]) writeFile(path.join(library, file), 'x'.repeat(100));
  const spawnSync = (executable, args) => {
    if (executable.endsWith('plutil')) return { status: 0, stdout: args[5].includes('Fake.app') ? 'com.example.fake\n' : 'com.apple.Safari\n' };
    if (executable.endsWith('lsappinfo')) return { status: 0, stdout: running.map((id) => `bundleID="${id}"`).join('\n') };
    if (executable === 'brew') return { status: 0, stdout: 'fake\nother\n' };
    return { status: 1 };
  };
  return { home, app, library, spawnSync };
}

test('apps are listed with their bundle id', () => {
  const { home, spawnSync } = fakeMac();
  const apps = macos.listApps({ homeDir: home, spawnSync }).filter((app) => app.path.startsWith(home));
  assert.deepEqual(apps.map((app) => [app.name, app.bundleId]), [['Fake', 'com.example.fake']]);
});

test('system apps, Apple apps, running apps and apps without a bundle id are refused', () => {
  assert.match(macos.refusal({ path: '/System/Applications/Mail.app', bundleId: 'x' }), /system app/);
  assert.match(macos.refusal({ path: '/Applications/Safari.app', bundleId: 'com.apple.Safari' }), /Apple/);
  assert.match(macos.refusal({ path: '/Applications/A.app' }), /bundle id/);
  assert.match(macos.refusal({ path: '/Applications/A.app', bundleId: 'com.x' }, new Set(['com.x'])), /running/);
  assert.equal(macos.refusal({ path: '/Applications/A.app', bundleId: 'com.x' }, new Set()), undefined);
});

test('leftovers: exact id matches are strong, name matches are weak, user data is never selected for you', async () => {
  const { home, app, library, spawnSync } = fakeMac();
  const plan = await macos.planUninstall({ name: 'Fake', path: app, bundleId: 'com.example.fake' }, { homeDir: home, spawnSync, running: new Set() });
  assert.equal(plan.refused, undefined);
  const rel = (entry) => path.relative(library, entry.path).split(path.sep).join('/');
  const byPath = Object.fromEntries(plan.leftovers.map((entry) => [rel(entry), entry]));
  assert.equal(byPath['Caches/com.example.fake'].selected, true);
  assert.equal(byPath['Preferences/com.example.fake.plist'].selected, true);
  assert.equal(byPath['LaunchAgents/com.example.fake.helper.plist'].selected, true);
  assert.equal(byPath['Application Support/com.example.fake'].selected, false);
  assert.equal(byPath['Application Support/com.example.fake'].userData, true);
  assert.equal(byPath['Containers/com.example.fake'].selected, false);
  assert.equal(byPath['Group Containers/ABC.com.example.fake'].confidence, 'exact');
  assert.equal(byPath['Application Support/Fake'].confidence, 'name');
  assert.equal(byPath['Application Support/Fake'].selected, false);
  assert.equal(byPath['Logs/Fake'].selected, false);
  assert.equal(byPath['Application Support/Unrelated'], undefined);
  assert.equal(plan.cask, 'fake');
});

test('a running app gets a refusal and no leftovers are listed', async () => {
  const { home, app, spawnSync } = fakeMac({ running: ['com.example.fake'] });
  const plan = await macos.planUninstall({ name: 'Fake', path: app, bundleId: 'com.example.fake' }, { homeDir: home, spawnSync });
  assert.match(plan.refused, /running/);
  assert.deepEqual(plan.leftovers, []);
});

test('uninstalling moves the app and the selected leftovers to the Trash and logs them', async () => {
  const { home, app, library, spawnSync } = fakeMac();
  const plan = await macos.planUninstall({ name: 'Fake', path: app, bundleId: 'com.example.fake' }, { homeDir: home, spawnSync, running: new Set() });
  const items = [
    { id: app, kind: 'app', path: app, bytes: plan.app.bytes, tier: 'review', reasons: [] },
    ...plan.leftovers.filter((entry) => entry.selected).map((entry) => ({ id: entry.path, kind: 'app-cache', path: entry.path, bytes: entry.bytes, tier: 'review', reasons: [] })),
  ];
  const results = await pruneItems(items, { homeDir: home, allowReview: true, platform: 'darwin' });
  assert.ok(results.every((result) => result.status === 'removed' && result.method === 'moved-to-trash'), JSON.stringify(results));
  assert.equal(fs.existsSync(app), false);
  assert.ok(fs.existsSync(path.join(home, '.Trash', 'Fake.app')));
  assert.equal(fs.existsSync(path.join(library, 'Caches', 'com.example.fake')), false);
  // Your data stays, and so does everything unrelated.
  assert.ok(fs.existsSync(path.join(library, 'Application Support', 'com.example.fake', 'data.db')));
  assert.ok(fs.existsSync(path.join(library, 'Application Support', 'Unrelated', 'keep.txt')));
});

test('app caches are review items, skip Apple and covered tools, and never offer a running app', async () => {
  const home = tempDir();
  for (const file of ['com.example.app/a.bin', 'com.example.running/b.bin', 'com.apple.Safari/c.bin', 'Homebrew/d.bin']) {
    writeFile(path.join(home, 'Library', 'Caches', file), 'x'.repeat(1000));
  }
  const items = await scanAppCaches({ homeDir: home, platform: 'darwin', running: new Set(['com.example.running']), now: Date.now() });
  const byName = Object.fromEntries(items.map((item) => [path.basename(item.path), item]));
  assert.equal(byName['com.example.app'].tier, 'review');
  assert.equal(byName['com.example.running'].tier, 'blocked');
  assert.equal(byName['com.apple.Safari'], undefined);
  assert.equal(byName.Homebrew, undefined);
});

test('Windows temporary files are offered only when older than 7 days', async () => {
  const home = tempDir();
  const local = path.join(home, 'AppData', 'Local');
  writeFile(path.join(local, 'Temp', 'old', 'a.tmp'), 'x'.repeat(100));
  writeFile(path.join(local, 'Temp', 'fresh', 'a.tmp'), 'x'.repeat(100));
  const old = new Date(Date.now() - 20 * 86_400_000);
  fs.utimesSync(path.join(local, 'Temp', 'old'), old, old);
  const items = await scanAppCaches({ homeDir: home, platform: 'win32', env: { LOCALAPPDATA: local }, now: Date.now() });
  assert.deepEqual(items.map((item) => path.basename(item.path)), ['old']);
});

test('uninstalling apps is automatic only on macOS; elsewhere it prints the official command', () => {
  assert.equal(platformSupport('darwin').automatic, true);
  assert.match(platformSupport('win32').hints.join(' '), /winget uninstall/);
  assert.match(platformSupport('linux').hints.join(' '), /flatpak/);
});
