// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BROWSERS, PROFILE_CACHES, cacheFolders, scanBrowsers } = require('../src/disk/browsers');
const { pruneItems } = require('../src/disk/prune');
const { scanSimulatorRuntimes, compareVersions } = require('../src/disk/simruntimes');
const { emptyCommand, emptyTrash, trashSize } = require('../src/disk/trashbin');
const { detectCleaners, loadCleaners } = require('../src/cleaners');
const { collectPrune } = require('../src/handlers/prune');
const { parseArgs } = require('../src/utils/args');
const { tempDir, writeFile } = require('./helpers');

function chromeHome() {
  const home = tempDir();
  const data = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  for (const profile of ['Default', 'Profile 1']) {
    writeFile(path.join(data, profile, 'Cache', 'Cache_Data', 'f_000001'), 'x'.repeat(3000));
    writeFile(path.join(data, profile, 'Code Cache', 'js', 'a'), 'x'.repeat(1000));
    writeFile(path.join(data, profile, 'Login Data'), 'PASSWORDS');
    writeFile(path.join(data, profile, 'History'), 'HISTORY');
    writeFile(path.join(data, profile, 'Cookies'), 'COOKIES');
    writeFile(path.join(data, profile, 'Bookmarks'), 'BOOKMARKS');
  }
  writeFile(path.join(data, 'Local State'), '{}');
  writeFile(path.join(home, 'Library', 'Caches', 'Google', 'Chrome', 'Default', 'x'), 'x'.repeat(2000));
  return { home, data };
}

test('browser caches list only cache folders, never a profile or what it holds', () => {
  const { home, data } = chromeHome();
  const chrome = BROWSERS.find((browser) => browser.id === 'chrome');
  const folders = cacheFolders(chrome, { homeDir: home, platform: 'darwin', fsImpl: fs });
  assert.ok(folders.length >= 5);
  for (const folder of folders) {
    const last = path.basename(folder);
    assert.ok(['Chrome', 'Cache', 'Code Cache'].includes(last), folder);
    assert.notEqual(folder, path.join(data, 'Default'));
  }
  const joined = folders.join('\n');
  assert.doesNotMatch(joined, /Login Data|History|Cookies|Bookmarks|Local State/);
  for (const cache of PROFILE_CACHES) assert.doesNotMatch(cache, /Login|History|Cookies|Bookmarks|Preferences|Extensions|Local Storage/);
});

test('a browser that is running is blocked, and a closed one goes to the Trash with its profile untouched', async () => {
  const { home, data } = chromeHome();
  fs.mkdirSync(path.join(home, '.Trash'));
  const blocked = await scanBrowsers({ homeDir: home, platform: 'darwin', running: new Set(['chrome']) });
  assert.equal(blocked[0].tier, 'blocked');
  assert.match(blocked[0].reasons[0], /running/);
  const [blockedResult] = await pruneItems(blocked, { homeDir: home, allowReview: true, platform: 'darwin' });
  assert.equal(blockedResult.status, 'skipped');

  const [item] = await scanBrowsers({ homeDir: home, platform: 'darwin', running: new Set() });
  assert.equal(item.kind, 'browser-cache');
  assert.equal(item.tier, 'review');
  assert.ok(item.bytes >= 7000);
  const [refused] = await pruneItems([item], { homeDir: home, platform: 'darwin' });
  assert.equal(refused.status, 'skipped', 'review needs permission');
  const [moved] = await pruneItems([item], { homeDir: home, allowReview: true, platform: 'darwin' });
  assert.equal(moved.status, 'removed');
  assert.equal(moved.method, 'moved-to-trash');
  for (const kept of ['Login Data', 'History', 'Cookies', 'Bookmarks']) assert.ok(fs.existsSync(path.join(data, 'Default', kept)), kept);
  assert.equal(fs.existsSync(path.join(data, 'Default', 'Cache')), false);
  assert.ok(fs.existsSync(path.join(home, '.Trash')));
});

test('Firefox caches are the cache2 folder of each profile', async () => {
  const home = tempDir();
  writeFile(path.join(home, 'Library', 'Caches', 'Firefox', 'Profiles', 'abc.default', 'cache2', 'entries', 'x'), 'x'.repeat(2000));
  writeFile(path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles', 'abc.default', 'logins.json'), 'SECRET');
  const [item] = await scanBrowsers({ homeDir: home, platform: 'darwin', running: new Set() });
  assert.equal(item.name, 'Firefox cache');
  assert.deepEqual(item.paths.map((file) => path.basename(file)), ['cache2']);
});

const runtimeListing = JSON.stringify({
  AAA: { identifier: 'AAA', kind: 'Disk Image', version: '26.1', build: '23B', state: 'Ready', deletable: true, sizeBytes: 7_000_000_000, platformIdentifier: 'com.apple.platform.iphonesimulator' },
  BBB: { identifier: 'BBB', kind: 'Disk Image', version: '27.0', build: '24A', state: 'Ready', deletable: true, sizeBytes: 8_000_000_000, platformIdentifier: 'com.apple.platform.iphonesimulator' },
  CCC: { identifier: 'CCC', kind: 'Disk Image', version: '11.0', state: 'Ready', deletable: true, sizeBytes: 3_000_000_000, platformIdentifier: 'com.apple.platform.watchsimulator' },
  DDD: { identifier: 'DDD', version: '1.0', deletable: false, sizeBytes: 1, platformIdentifier: 'com.apple.platform.iphonesimulator' },
});

test('simulator runtimes: older ones are named as older, the newest of each platform says so, and Xcode deletes them', async () => {
  const items = scanSimulatorRuntimes({ platform: 'darwin', spawnSync: () => ({ status: 0, stdout: runtimeListing }) });
  assert.equal(items.length, 3, 'runtimes that cannot be deleted are left out');
  const byName = Object.fromEntries(items.map((item) => [item.name.split(' Simulator')[0], item]));
  assert.match(byName['iOS 26.1'].reasons[0], /older than iOS 27\.0/);
  assert.match(byName['iOS 27.0'].reasons[0], /newest iOS runtime/);
  assert.match(byName['watchOS 11.0'].reasons[0], /newest watchOS runtime/);
  assert.deepEqual(byName['iOS 26.1'].clean, { executable: 'xcrun', args: ['simctl', 'runtime', 'delete', 'AAA'] });
  assert.equal(byName['iOS 26.1'].bytes, 7_000_000_000);
  assert.equal(compareVersions('26.10', '26.9') > 0, true);
  assert.deepEqual(scanSimulatorRuntimes({ platform: 'linux', spawnSync: () => { throw new Error('no'); } }), []);
  assert.deepEqual(scanSimulatorRuntimes({ platform: 'darwin', spawnSync: () => ({ status: 1 }) }), []);
  assert.deepEqual(scanSimulatorRuntimes({ platform: 'darwin', spawnSync: () => ({ status: 0, stdout: 'not json' }) }), []);

  const calls = [];
  const spawnSync = (executable, args) => { calls.push([executable, ...args]); return { status: 0 }; };
  const home = tempDir();
  const [skipped] = await pruneItems([byName['iOS 26.1']], { homeDir: home, spawnSync });
  assert.equal(skipped.status, 'skipped');
  assert.equal(calls.length, 0);
  const [dry] = await pruneItems([byName['iOS 26.1']], { homeDir: home, spawnSync, allowReview: true, dryRun: true });
  assert.equal(dry.command, 'xcrun simctl runtime delete AAA');
  const [done] = await pruneItems([byName['iOS 26.1']], { homeDir: home, spawnSync, allowReview: true });
  assert.equal(done.status, 'removed');
  assert.equal(done.freedBytes, 7_000_000_000);
  assert.deepEqual(calls, [['xcrun', 'simctl', 'runtime', 'delete', 'AAA']]);
});

test('Xcode: device support is safe and rebuilt, Archives are review and go to the Trash', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.Trash'));
  const developer = path.join(home, 'Library', 'Developer', 'Xcode');
  writeFile(path.join(developer, 'iOS DeviceSupport', '17.0 (21A)', 'Symbols', 'a'), 'x'.repeat(5000));
  writeFile(path.join(developer, 'Archives', '2026-01-01', 'App.xcarchive', 'Info.plist'), 'x'.repeat(500));
  const registry = loadCleaners({ homeDir: home, includeUser: false });
  const found = Object.fromEntries(detectCleaners(registry, { homeDir: home, platform: 'darwin', env: { PATH: '' } }).map((entry) => [entry.cleaner.id, entry]));
  assert.equal(found['xcode-device-support'].cleaner.tier, 'safe');
  assert.equal(found['xcode-archives'].cleaner.tier, 'review');
  const { scanGlobal } = require('../src/disk/scan');
  const items = Object.fromEntries((await scanGlobal({ homeDir: home, platform: 'darwin', env: { PATH: '' }, registry })).map((item) => [item.id, item]));
  const [support] = await pruneItems([items['xcode-device-support']], { homeDir: home, platform: 'darwin' });
  assert.equal(support.status, 'removed');
  assert.equal(support.method, 'deleted');
  assert.equal(fs.existsSync(path.join(developer, 'iOS DeviceSupport')), false);
  const [skipped] = await pruneItems([items['xcode-archives']], { homeDir: home, platform: 'darwin' });
  assert.equal(skipped.status, 'skipped');
  const [archived] = await pruneItems([items['xcode-archives']], { homeDir: home, platform: 'darwin', allowReview: true });
  assert.equal(archived.method, 'moved-to-trash');
  assert.ok(fs.existsSync(path.join(home, '.Trash', 'Archives')));
});

test('the Trash command is a fixed script per system, and a refusal explains what to allow', () => {
  assert.deepEqual(emptyCommand({ platform: 'darwin' }), { executable: 'osascript', args: ['-e', 'tell application "Finder" to empty trash'] });
  assert.match(emptyCommand({ platform: 'win32' }).args.join(' '), /Clear-RecycleBin/);
  assert.equal(emptyCommand({ platform: 'linux', env: { PATH: '' } }), undefined);
  assert.equal(emptyTrash({ platform: 'linux', env: { PATH: '' } }).ok, false);
  const calls = [];
  assert.equal(emptyTrash({ platform: 'darwin', spawnSync: (exe, args) => { calls.push([exe, ...args]); return { status: 0 }; } }).ok, true);
  assert.deepEqual(calls, [['osascript', '-e', 'tell application "Finder" to empty trash']]);
  const denied = emptyTrash({ platform: 'darwin', spawnSync: () => ({ status: 1, stderr: 'execution error: Not authorized to send Apple events to Finder. (-1743)' }) });
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /Automation/);
});

test('the Trash size is measured when readable and reported as unknown when the system forbids it', async () => {
  const home = tempDir();
  writeFile(path.join(home, '.Trash', 'old', 'f'), 'x'.repeat(10_000));
  const known = await trashSize({ homeDir: home, platform: 'darwin' });
  assert.equal(known.known, true);
  assert.ok(known.bytes >= 10_000);
  assert.equal((await trashSize({ homeDir: tempDir(), platform: 'darwin' })).known, true);
  assert.equal((await trashSize({ homeDir: home, platform: 'win32' })).known, false);
});

test('dev prune trash lists first, empties only with --yes, and never under --dry-run', async () => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.Trash'));
  const calls = [];
  const spawnSync = (exe, args) => { calls.push([exe, ...args]); return { status: 0 }; };
  const run = (args) => {
    const { options, positionals } = parseArgs(['prune', ...args]);
    return collectPrune({ options, positionals, homeDir: home, platform: 'darwin', spawnSync });
  };
  const listed = await run(['trash']);
  assert.equal(listed.data.dryRun, true);
  assert.equal(calls.length, 0);
  assert.equal((await run(['trash', '--yes', '--dry-run'])).data.dryRun, true);
  assert.equal(calls.length, 0);
  const done = await run(['trash', '--yes']);
  assert.equal(done.data.emptied, true);
  assert.equal(calls.length, 1);
  const log = await run(['--log']);
  assert.equal(log.data.entries.at(-1).id, 'trash');
  assert.equal(log.data.entries.at(-1).method, 'tool-command');
});
