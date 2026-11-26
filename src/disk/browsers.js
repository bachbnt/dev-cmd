// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runningBundleIds } = require('../apps/macos');
const { spawnSyncProcess } = require('../runner/spawn');
const { measure } = require('./size');

// Browser caches, one item per browser. Only folders that hold downloaded copies are ever listed
// (HTTP cache, code cache, GPU cache, service-worker cache); a profile folder itself, with its
// passwords, history, bookmarks and cookies, is never in the list. Every item is `review`, goes to
// the Trash, and is blocked while the browser is running.

const PROFILE_CACHES = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache', path.join('Service Worker', 'CacheStorage')];

// vendor: the folder name under Caches / .cache; data: the user-data folder that holds profiles.
const BROWSERS = [
  {
    id: 'chrome', name: 'Google Chrome', bundleId: 'com.google.Chrome', process: { linux: 'chrome', win32: 'chrome.exe' },
    darwin: { caches: ['Library/Caches/Google/Chrome'], data: 'Library/Application Support/Google/Chrome' },
    linux: { caches: ['.cache/google-chrome'], data: '.config/google-chrome' },
    win32: { caches: [], data: 'AppData/Local/Google/Chrome/User Data' },
  },
  {
    id: 'brave', name: 'Brave', bundleId: 'com.brave.Browser', process: { linux: 'brave', win32: 'brave.exe' },
    darwin: { caches: ['Library/Caches/BraveSoftware/Brave-Browser'], data: 'Library/Application Support/BraveSoftware/Brave-Browser' },
    linux: { caches: ['.cache/BraveSoftware/Brave-Browser'], data: '.config/BraveSoftware/Brave-Browser' },
    win32: { caches: [], data: 'AppData/Local/BraveSoftware/Brave-Browser/User Data' },
  },
  {
    id: 'edge', name: 'Microsoft Edge', bundleId: 'com.microsoft.edgemac', process: { linux: 'msedge', win32: 'msedge.exe' },
    darwin: { caches: ['Library/Caches/Microsoft Edge'], data: 'Library/Application Support/Microsoft Edge' },
    linux: { caches: ['.cache/microsoft-edge'], data: '.config/microsoft-edge' },
    win32: { caches: [], data: 'AppData/Local/Microsoft/Edge/User Data' },
  },
  {
    id: 'arc', name: 'Arc', bundleId: 'company.thebrowser.Browser', process: { win32: 'Arc.exe' },
    darwin: { caches: ['Library/Caches/company.thebrowser.Browser'], data: 'Library/Application Support/Arc/User Data' },
    linux: { caches: [], data: null },
    win32: { caches: [], data: null },
  },
  {
    id: 'vivaldi', name: 'Vivaldi', bundleId: 'com.vivaldi.Vivaldi', process: { linux: 'vivaldi-bin', win32: 'vivaldi.exe' },
    darwin: { caches: ['Library/Caches/Vivaldi'], data: 'Library/Application Support/Vivaldi' },
    linux: { caches: ['.cache/vivaldi'], data: '.config/vivaldi' },
    win32: { caches: [], data: 'AppData/Local/Vivaldi/User Data' },
  },
  {
    id: 'opera', name: 'Opera', bundleId: 'com.operasoftware.Opera', process: { linux: 'opera', win32: 'opera.exe' },
    darwin: { caches: ['Library/Caches/com.operasoftware.Opera'], data: null },
    linux: { caches: ['.cache/opera'], data: null },
    win32: { caches: [], data: null },
  },
  {
    id: 'firefox', name: 'Firefox', bundleId: 'org.mozilla.firefox', process: { linux: 'firefox', win32: 'firefox.exe' },
    darwin: { caches: [], firefox: 'Library/Caches/Firefox/Profiles' },
    linux: { caches: [], firefox: '.cache/mozilla/firefox' },
    win32: { caches: [], firefox: 'AppData/Local/Mozilla/Firefox/Profiles' },
  },
  {
    id: 'safari', name: 'Safari', bundleId: 'com.apple.Safari', process: {},
    darwin: { caches: ['Library/Caches/com.apple.Safari'] },
    linux: { caches: [], data: null },
    win32: { caches: [], data: null },
  },
];

function isProfileFolder(name) {
  return name === 'Default' || /^Profile \d+$/.test(name) || name === 'Guest Profile';
}

function existingDirectory(file, fsImpl) {
  try {
    return fsImpl.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

// Every cache folder of one browser that exists. Never returns a profile folder itself.
function cacheFolders(browser, { homeDir, platform, fsImpl }) {
  const spec = browser[platform];
  if (!spec) return [];
  const folders = (spec.caches || []).map((entry) => path.join(homeDir, ...entry.split('/')));
  if (spec.data) {
    const data = path.join(homeDir, ...spec.data.split('/'));
    let names = [];
    try {
      names = fsImpl.readdirSync(data);
    } catch {}
    for (const name of names.filter(isProfileFolder)) {
      for (const cache of PROFILE_CACHES) folders.push(path.join(data, name, cache));
    }
  }
  if (spec.firefox) {
    const profiles = path.join(homeDir, ...spec.firefox.split('/'));
    let names = [];
    try {
      names = fsImpl.readdirSync(profiles);
    } catch {}
    for (const name of names) folders.push(path.join(profiles, name, 'cache2'));
  }
  return folders.filter((folder) => existingDirectory(folder, fsImpl));
}

// Names of browsers that are running now (the browser's own ids, see BROWSERS).
function runningBrowsers({ platform, spawnSync = spawnSyncProcess } = {}) {
  const running = new Set();
  if (platform === 'darwin') {
    const ids = runningBundleIds(spawnSync);
    for (const browser of BROWSERS) if (ids?.has(browser.bundleId)) running.add(browser.id);
  } else if (platform === 'linux') {
    for (const browser of BROWSERS) {
      const name = browser.process.linux;
      if (name && spawnSync('pgrep', ['-x', name], { encoding: 'utf8' }).status === 0) running.add(browser.id);
    }
  } else if (platform === 'win32') {
    const result = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const text = String(result.stdout || '').toLowerCase();
    for (const browser of BROWSERS) {
      const name = browser.process.win32;
      if (name && text.includes(`"${name.toLowerCase()}"`)) running.add(browser.id);
    }
  }
  return running;
}

async function scanBrowsers(options = {}) {
  const {
    homeDir = os.homedir(), platform = process.platform, fsImpl = fs, spawnSync, running = runningBrowsers({ platform, spawnSync }),
  } = options;
  const items = [];
  for (const browser of BROWSERS) {
    const folders = cacheFolders(browser, { homeDir, platform, fsImpl });
    if (folders.length === 0) continue;
    let bytes = 0;
    let unreadable = 0;
    for (const folder of folders) {
      const size = await measure(folder);
      bytes += size.bytes;
      unreadable += size.unreadable;
    }
    const isRunning = running.has(browser.id);
    items.push({
      kind: 'browser-cache',
      id: `browser:${browser.id}`,
      name: `${browser.name} cache`,
      path: folders[0],
      paths: folders,
      bytes,
      bytesIsEstimate: false,
      unreadable,
      tier: isRunning ? 'blocked' : 'review',
      reasons: isRunning ? [`${browser.name} is running; quit it first`] : [unreadable > 0 ? 'some parts cannot be read (macOS privacy settings)' : 'pages load a little slower once; your profile, passwords and history are not touched'],
      recreate: 'The browser downloads what it needs again.',
    });
  }
  return items.filter((item) => item.bytes > 0 || item.unreadable > 0).sort((left, right) => right.bytes - left.bytes);
}

module.exports = {
  BROWSERS, PROFILE_CACHES, cacheFolders, isProfileFolder, runningBrowsers, scanBrowsers,
};
