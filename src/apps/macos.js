// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSyncProcess } = require('../runner/spawn');
const { measure } = require('../disk/size');

// Uninstall planning for macOS apps. Read-only: it lists apps and finds the files they left
// behind; removing goes through `disk/prune.js` (Trash, deny list, log).
//
// Leftovers have two confidence levels: an exact bundle id match (strong) and a match on the app
// name only (weak, never selected for you). User data (Application Support, Containers) is never
// selected for you either.

function appFolders(homeDir) {
  return ['/Applications', path.join(homeDir, 'Applications')];
}

function readBundleId(appPath, spawnSync = spawnSyncProcess) {
  const result = spawnSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return undefined;
  const id = String(result.stdout).trim();
  return id || undefined;
}

// Bundle ids of apps that are running now, from `lsappinfo` (needs no permission).
function runningBundleIds(spawnSync = spawnSyncProcess) {
  const result = spawnSync('/usr/bin/lsappinfo', ['list'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) return undefined;
  return new Set([...String(result.stdout).matchAll(/bundleID="([^"]+)"/g)].map((match) => match[1]));
}

function listApps({ homeDir = os.homedir(), fsImpl = fs, spawnSync = spawnSyncProcess } = {}) {
  const apps = [];
  for (const folder of appFolders(homeDir)) {
    let names;
    try {
      names = fsImpl.readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names.filter((entry) => entry.endsWith('.app'))) {
      const appPath = path.join(folder, name);
      apps.push({
        name: name.slice(0, -4), path: appPath, bundleId: readBundleId(appPath, spawnSync),
      });
    }
  }
  return apps.sort((left, right) => left.name.localeCompare(right.name));
}

// Why this app may not be uninstalled, or undefined.
function refusal(app, running) {
  if (app.path.startsWith('/System/')) return 'it is a macOS system app';
  if (!app.bundleId) return 'its bundle id could not be read, so its files cannot be matched safely';
  if (app.bundleId.startsWith('com.apple.')) return 'it is an Apple app that comes with macOS';
  if (running && running.has(app.bundleId)) return 'it is running; quit it first';
  return undefined;
}

function leftoverCandidates(app, homeDir) {
  const library = path.join(homeDir, 'Library');
  const id = app.bundleId;
  const name = app.name;
  const exact = (directory, entry, userData = false) => ({ path: path.join(library, directory, entry), confidence: 'exact', userData });
  return [
    exact('Caches', id),
    exact('Preferences', `${id}.plist`),
    exact('Saved Application State', `${id}.savedState`),
    exact('HTTPStorages', id),
    exact('WebKit', id),
    exact('Logs', id),
    exact('Application Support', id, true),
    exact('Containers', id, true),
    { path: path.join(library, 'Application Support', name), confidence: 'name', userData: true },
    { path: path.join(library, 'Caches', name), confidence: 'name', userData: false },
    { path: path.join(library, 'Logs', name), confidence: 'name', userData: false },
  ];
}

// Folders in "Group Containers" and "LaunchAgents" are matched by id inside the name.
function scanDirectoryFor(directory, id, fsImpl, confidence = 'exact', userData = true) {
  try {
    return fsImpl.readdirSync(directory)
      .filter((entry) => entry.includes(id))
      .map((entry) => ({ path: path.join(directory, entry), confidence, userData }));
  } catch {
    return [];
  }
}

async function findLeftovers(app, { homeDir = os.homedir(), fsImpl = fs } = {}) {
  const library = path.join(homeDir, 'Library');
  const found = [
    ...leftoverCandidates(app, homeDir),
    ...scanDirectoryFor(path.join(library, 'Group Containers'), app.bundleId, fsImpl),
    ...scanDirectoryFor(path.join(library, 'LaunchAgents'), app.bundleId, fsImpl, 'exact', false),
  ].filter((entry) => fsImpl.existsSync(entry.path));
  const unique = [...new Map(found.map((entry) => [entry.path, entry])).values()];
  return Promise.all(unique.map(async (entry) => ({ ...entry, bytes: (await measure(entry.path)).bytes })));
}

// Homebrew cask that installed this app, if any (`brew list --cask` matched on the app name).
function findCask(app, spawnSync = spawnSyncProcess) {
  const result = spawnSync('brew', ['list', '--cask'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return undefined;
  const wanted = app.name.toLowerCase().replace(/\s+/g, '-');
  return String(result.stdout).split('\n').map((line) => line.trim()).find((cask) => cask === wanted);
}

async function planUninstall(app, options = {}) {
  const { homeDir = os.homedir(), spawnSync = spawnSyncProcess, running = runningBundleIds(spawnSync) } = options;
  const refused = refusal(app, running);
  const size = await measure(app.path);
  const leftovers = refused ? [] : await findLeftovers(app, options);
  return {
    app: { ...app, bytes: size.bytes },
    refused,
    cask: refused ? undefined : findCask(app, spawnSync),
    leftovers: leftovers.map((entry) => ({ ...entry, selected: entry.confidence === 'exact' && !entry.userData })),
    homeDir,
  };
}

module.exports = {
  findCask, findLeftovers, listApps, planUninstall, readBundleId, refusal, runningBundleIds,
};
