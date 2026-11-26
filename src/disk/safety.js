// Copyright (c) 2026 bachbnt

const path = require('path');
const { spawnSyncProcess } = require('../runner/spawn');

// Shared safety checks for every command that deletes files (`dev clean` today; `dev prune` later).

// True when `candidate` is `root` itself or lies inside it, comparing real path text. Does not touch
// the file system, so callers resolve symlinks first when that matters.
function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// The files Git tracks under `root`, as a sorted array of forward-slash paths relative to `root`.
// Returns undefined when Git is unavailable or `root` is not inside a repository, meaning "unknown".
function listTrackedFiles(root, { spawnSync = spawnSyncProcess } = {}) {
  const result = spawnSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout.split('\0').filter(Boolean).sort();
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/\/+$/, '');
}

// True when `relativePath` (file or directory) is, or contains, a tracked file.
function isTracked(trackedFiles, relativePath) {
  if (!trackedFiles) return false;
  const target = toPosix(relativePath);
  const prefix = `${target}/`;
  return trackedFiles.some((file) => file === target || file.startsWith(prefix));
}

module.exports = { isInside, isTracked, listTrackedFiles };
