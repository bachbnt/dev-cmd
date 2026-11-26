// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runningBundleIds } = require('../apps/macos');
const { measure } = require('./size');

// Caches and logs of apps (not of dev tools). Every item is `review`: shown with its size, never
// selected for you, and moved to the Trash. Apple's own caches and the caches of tools that
// already have a cleaner are left out. A running app's cache is never offered.

const DAY_MS = 86_400_000;
const COVERED_BY_CLEANERS = new Set(['Homebrew', 'pip', 'Yarn', 'CocoaPods', 'go-build', 'node-gyp', 'typescript', 'pnpm']);

function sourcesFor({ homeDir, platform, env }) {
  if (platform === 'darwin') {
    return [{ directory: path.join(homeDir, 'Library', 'Caches'), label: 'cache' }, { directory: path.join(homeDir, 'Library', 'Logs'), label: 'logs' }];
  }
  if (platform === 'win32') {
    return [{ directory: path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'Temp'), label: 'temporary files', olderThanDays: 7 }];
  }
  return [{ directory: path.join(env.XDG_CACHE_HOME || path.join(homeDir, '.cache')), label: 'cache' }];
}

async function scanAppCaches(options = {}) {
  const {
    homeDir = os.homedir(), platform = process.platform, env = process.env, fsImpl = fs, now = Date.now(), running = platform === 'darwin' ? runningBundleIds() : undefined,
  } = options;
  const items = [];
  for (const { directory, label, olderThanDays } of sourcesFor({ homeDir, platform, env })) {
    let entries;
    try {
      entries = fsImpl.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('com.apple.') || COVERED_BY_CLEANERS.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      let mtimeMs = 0;
      try {
        mtimeMs = fsImpl.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      if (olderThanDays && now - mtimeMs < olderThanDays * DAY_MS) continue;
      const isRunning = Boolean(running && running.has(entry.name));
      const size = await measure(full);
      if (size.bytes === 0) continue;
      items.push({
        kind: 'app-cache',
        id: full,
        name: `${entry.name} (${label})`,
        path: full,
        bytes: size.bytes,
        bytesIsEstimate: false,
        unreadable: size.unreadable,
        ageDays: Math.floor((now - mtimeMs) / DAY_MS),
        tier: isRunning ? 'blocked' : 'review',
        reasons: isRunning ? ['the app is running'] : ['the app rebuilds it; it may start slower once'],
        recreate: 'The app creates it again when needed.',
      });
    }
  }
  return items.sort((left, right) => right.bytes - left.bytes);
}

module.exports = { scanAppCaches };
