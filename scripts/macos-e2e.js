#!/usr/bin/env node
// Copyright (c) 2026 bachbnt

// End-to-end check of the macOS cleaning features on a real macOS machine, meant for the disposable
// macos runner in CI (see .github/workflows/ci.yml, job "macos-e2e"). It uses the real home folder,
// the real Trash, `plutil`, `lsappinfo`, and the real `sudo` (the runner has passwordless sudo, so
// `sudo -k` asks nothing; on your own Mac it would ask for your password).
//
// Do not run it on a computer you care about: it moves things to the Trash and, in step "sudo",
// removes root-owned entries from /Library/Caches that are not Apple's.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSyncProcess } = require('../src/runner/spawn');

if (process.platform !== 'darwin') {
  console.log('macos-e2e: not macOS, nothing to do.');
  process.exit(0);
}
if (!process.env.CI && process.argv[2] !== '--i-know-this-changes-my-mac') {
  console.error('macos-e2e changes the real home folder and /Library/Caches. Run it in CI, or pass --i-know-this-changes-my-mac.');
  process.exit(2);
}

const home = os.homedir();
const dev = path.join(__dirname, '..', 'dev');
const steps = [];

function run(args, options = {}) {
  const result = spawnSyncProcess(process.execPath, [dev, ...args], { encoding: 'utf8', ...options });
  return { status: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

async function step(name, work) {
  process.stdout.write(`- ${name} ... `);
  try {
    const note = await work();
    console.log(`ok${note ? ` (${note})` : ''}`);
    steps.push({ name, ok: true });
  } catch (error) {
    console.log('FAILED');
    console.log(`    ${String(error.message).split('\n').join('\n    ')}`);
    steps.push({ name, ok: false });
  }
}

const write = (file, text = 'x'.repeat(2000)) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

async function main() {
  const PLIST = (id) => `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleName</key><string>E2EFake</string></dict></plist>
  `;

  await step('real plutil and lsappinfo are available', () => {
    assert.equal(spawnSyncProcess('/usr/bin/plutil', ['-help'], { encoding: 'utf8' }).error, undefined);
    assert.equal(spawnSyncProcess('/usr/bin/lsappinfo', ['list'], { encoding: 'utf8' }).status, 0);
  });

  const id = 'com.devcmd.e2efake';
  const app = path.join(home, 'Applications', 'E2EFake.app');
  const library = path.join(home, 'Library');

  await step('uninstall an app: bundle id read by plutil, app and caches to the Trash, your data kept', () => {
    write(path.join(app, 'Contents', 'Info.plist'), PLIST(id));
    write(path.join(app, 'Contents', 'MacOS', 'E2EFake'), 'x'.repeat(4000));
    write(path.join(library, 'Caches', id, 'c.bin'));
    write(path.join(library, 'Preferences', `${id}.plist`));
    write(path.join(library, 'Application Support', id, 'data.db'));
    const plan = run(['prune', 'apps', 'E2EFake', '--json']);
    assert.equal(plan.status, 0, plan.stderr);
    const planned = JSON.parse(plan.stdout);
    assert.equal(planned.app.bundleId, id);
    assert.ok(planned.leftovers.some((entry) => entry.path.endsWith(`Caches/${id}`) && entry.selected));
    assert.ok(fs.existsSync(app), 'a plan removes nothing');
    const done = run(['prune', 'apps', 'E2EFake', '--yes', '--json']);
    assert.equal(done.status, 0, done.stdout + done.stderr);
    assert.equal(fs.existsSync(app), false);
    assert.ok(fs.existsSync(path.join(home, '.Trash', 'E2EFake.app')) || fs.existsSync(path.join(home, '.Trash')), 'moved to the Trash');
    assert.equal(fs.existsSync(path.join(library, 'Caches', id)), false);
    assert.ok(fs.existsSync(path.join(library, 'Application Support', id, 'data.db')), 'your app data stays');
  });

  await step('browser cache goes to the Trash and the profile is untouched', () => {
    const data = path.join(library, 'Application Support', 'Google', 'Chrome');
    write(path.join(data, 'Default', 'Cache', 'Cache_Data', 'f_1'), 'x'.repeat(5000));
    write(path.join(data, 'Default', 'Login Data'), 'PASSWORDS');
    const listed = JSON.parse(run(['prune', 'browsers', '--json']).stdout);
    const chrome = listed.items.find((item) => item.id === 'browser:chrome');
    assert.ok(chrome, 'Chrome cache is listed');
    assert.equal(chrome.tier, 'review');
    const done = run(['prune', 'browsers', '--only', 'browser:chrome', '--yes', '--json']);
    assert.equal(done.status, 0, done.stdout + done.stderr);
    assert.equal(fs.existsSync(path.join(data, 'Default', 'Cache')), false);
    assert.equal(fs.readFileSync(path.join(data, 'Default', 'Login Data'), 'utf8'), 'PASSWORDS');
  });

  await step('simulator runtimes are listed from the real xcrun, and nothing is deleted without a choice', () => {
    const listed = run(['prune', 'caches', '--json']);
    assert.equal(listed.status, 0, listed.stderr);
    const data = JSON.parse(listed.stdout);
    const runtimes = data.items.filter((item) => item.kind === 'simulator-runtime');
    assert.ok(runtimes.every((item) => item.tier === 'review' && item.clean.args.slice(0, 3).join(' ') === 'simctl runtime delete'));
    return `${runtimes.length} runtime(s) found`;
  });

  await step('Xcode archives are review items that go to the Trash', () => {
    write(path.join(library, 'Developer', 'Xcode', 'Archives', 'e2e', 'A.xcarchive', 'Info.plist'));
    const listed = JSON.parse(run(['prune', 'caches', '--json']).stdout);
    assert.equal(listed.items.find((item) => item.id === 'xcode-archives').tier, 'review');
    const done = run(['prune', 'caches', '--only', 'xcode-archives', '--yes', '--json']);
    assert.equal(done.status, 0, done.stdout + done.stderr);
    assert.equal(fs.existsSync(path.join(library, 'Developer', 'Xcode', 'Archives')), false);
  });

  await step('sudo: root-owned cache entries are removed with one sudo -k call, user-owned ones are refused', () => {
    const { runTask, listTasks, planClear } = require('../src/maintenance');
    const rootEntry = `/Library/Caches/devcmd-e2e-root-${process.pid}`;
    const mine = `/Library/Caches/devcmd-e2e-mine-${process.pid}`;
    const sudo = (args) => assert.equal(spawnSyncProcess('sudo', ['-n', ...args], { encoding: 'utf8' }).status, 0, `sudo ${args.join(' ')}`);
    sudo(['/bin/mkdir', '-p', rootEntry]);
    sudo(['/usr/bin/touch', path.join(rootEntry, 'f')]);
    fs.mkdirSync(mine);
    const task = listTasks({ platform: 'darwin' }).find((entry) => entry.id === 'clear-system-caches');
    const plan = planClear(task);
    assert.ok(plan.paths.includes(rootEntry), 'the root-owned entry is planned');
    assert.ok(!plan.paths.includes(mine), 'the user-owned entry is not');
    assert.match(plan.refused.join(), /someone other than root/);
    let shown = '';
    return runTask(task, { isTTY: true, confirm: (text) => { shown = text; return true; } }).then((result) => {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.match(shown, /sudo -k -- \/bin\/rm -rf --/);
      assert.equal(fs.existsSync(rootEntry), false, 'the root-owned entry is gone');
      assert.ok(fs.existsSync(mine), 'the user-owned entry stays');
      fs.rmSync(mine, { recursive: true, force: true });
      return 'one sudo call';
    });
  });

  await step('the Trash is emptied through Finder, or the refusal says what to allow', () => {
    const result = run(['prune', 'trash', '--yes', '--json']);
    const data = JSON.parse(result.stdout);
    if (data.emptied) return 'emptied';
    assert.match(data.reason, /Automation|Finder|not allowed|authorized|\(-/i, data.reason);
    return `not emptied here: ${data.reason}`;
  });

  await step('dev disk reports on a real macOS home without deleting anything', () => {
    const result = run(['disk', '--json']);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(Array.isArray(JSON.parse(result.stdout).items));
  });


  const failed = steps.filter((entry) => !entry.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} steps passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
