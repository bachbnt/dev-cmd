// Copyright (c) 2026 bachbnt

const { spawnSyncProcess } = require('../runner/spawn');

// iOS (and watchOS, tvOS, visionOS) Simulator runtimes: each is a disk image of several GB.
// `xcrun simctl runtime list -j` lists them and `xcrun simctl runtime delete <id>` removes one, so
// DevCmd leaves the work to Xcode's own tool. Every runtime is a `review` item: you choose which,
// and the newest runtime of each platform says so, since that is the one you most likely use.

function parseVersion(text) {
  return String(text || '0').split('.').map((part) => Number(part) || 0);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function platformName(identifier) {
  const match = /\.platform\.([a-z]+?)(?:simulator)?$/.exec(identifier || '');
  return match ? match[1].replace('iphone', 'iOS').replace('appletv', 'tvOS').replace('watch', 'watchOS').replace('xr', 'visionOS') : 'Simulator';
}

// Items for the runtimes `simctl` says can be deleted. Empty when Xcode's tools are not installed.
function scanSimulatorRuntimes({ spawnSync = spawnSyncProcess, platform = process.platform } = {}) {
  if (platform !== 'darwin') return [];
  const result = spawnSync('xcrun', ['simctl', 'runtime', 'list', '-j'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) return [];
  let listing;
  try {
    listing = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const runtimes = Object.entries(listing)
    .filter(([, runtime]) => runtime && runtime.deletable === true && typeof runtime.version === 'string')
    .map(([id, runtime]) => ({ id: runtime.identifier || id, runtime, platform: platformName(runtime.platformIdentifier) }));
  const newest = new Map();
  for (const { runtime, platform: name } of runtimes) {
    if (!newest.has(name) || compareVersions(runtime.version, newest.get(name)) > 0) newest.set(name, runtime.version);
  }
  return runtimes.map(({ id, runtime, platform: name }) => {
    const isNewest = compareVersions(runtime.version, newest.get(name)) === 0;
    return {
      kind: 'simulator-runtime',
      id: `simulator-runtime:${id}`,
      name: `${name} ${runtime.version} Simulator runtime${runtime.build ? ` (${runtime.build})` : ''}`,
      path: null,
      paths: [],
      bytes: Number(runtime.sizeBytes) || 0,
      bytesIsEstimate: false,
      unreadable: 0,
      tier: 'review',
      reasons: [isNewest ? `the newest ${name} runtime: you probably use it` : `older than ${name} ${newest.get(name)}`],
      recreate: 'Download it again in Xcode > Settings > Components.',
      clean: { executable: 'xcrun', args: ['simctl', 'runtime', 'delete', id] },
      lastUsedAt: runtime.lastUsedAt ?? null,
    };
  });
}

module.exports = { compareVersions, platformName, scanSimulatorRuntimes };
