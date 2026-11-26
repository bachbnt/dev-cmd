// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
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

// --- Hard deny list -----------------------------------------------------------------------------
// Paths that DevCmd never deletes, whatever asked and whoever runs it (root included). Compared on
// real paths, so a symbolic link into one of them does not get around the list.

const HOME_FOLDERS = ['Documents', 'Desktop', 'Downloads', 'Pictures', 'Movies', 'Music', 'Videos', 'Public'];
const MAC_HOME_PROTECTED = [
  'Library/Mobile Documents', 'Library/Keychains', 'Library/Mail', 'Library/Messages', 'Library/Safari',
  'Library/Application Support/MobileSync', 'Library/Photos',
];
const POSIX_EXACT = ['/', '/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/boot', '/dev', '/proc', '/var', '/private', '/Applications', '/opt', '/Volumes'];
const POSIX_TREES = ['/System', '/usr', '/bin', '/sbin', '/etc', '/boot', '/dev', '/proc', '/Library/Apple', '/private/var/db'];
const WINDOWS_TREES = ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'];
const WINDOWS_EXACT = ['C:\\', 'C:\\Users'];

function normalizeForCompare(file, platform) {
  if (platform === 'win32') return path.win32.resolve(file).toLowerCase().replace(/\\+$/, '');
  return path.posix.resolve(file).replace(/\/+$/, '') || '/';
}

function realOrResolved(file, fsImpl, platform = process.platform) {
  try {
    return fsImpl.realpathSync(file);
  } catch {
    return platform === 'win32' ? path.win32.resolve(file) : path.resolve(file);
  }
}

// `exact` entries are protected themselves but not what lies inside (home itself, /Library), so
// `~/Library/Caches/x` stays deletable; `trees` are protected with everything inside. Your own
// folders (Documents, Desktop, ...) are trees too, except for a project's rebuildable folder
// (`allowUserFolderContents`): code often lives under Desktop, and `node_modules` there has already
// passed every project gate. The folders themselves stay protected either way.
function protectedPaths({ homeDir = os.homedir(), platform = process.platform, allowUserFolderContents = false } = {}) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const userFolders = HOME_FOLDERS.map((name) => join(homeDir, name));
  const trees = [
    ...(allowUserFolderContents ? [] : userFolders),
    ...(platform === 'darwin' ? MAC_HOME_PROTECTED.map((name) => join(homeDir, name)) : []),
    ...(platform === 'win32' ? WINDOWS_TREES : POSIX_TREES),
  ];
  const exact = [homeDir, ...userFolders, ...(platform === 'win32' ? WINDOWS_EXACT : POSIX_EXACT)];
  return { trees, exact };
}

// Returns a reason string when `target` must not be deleted, otherwise undefined.
function protectedReason(target, options = {}) {
  const {
    homeDir = os.homedir(), platform = process.platform, fsImpl = fs, allowUserFolderContents = false,
  } = options;
  const { trees, exact } = protectedPaths({ homeDir, platform, allowUserFolderContents });
  const real = normalizeForCompare(realOrResolved(target, fsImpl, platform), platform);
  const normalize = (list) => list.map((entry) => normalizeForCompare(realOrResolved(entry, fsImpl, platform), platform));
  if (normalize(exact).includes(real)) return `${target} is a protected location`;
  const separator = platform === 'win32' ? '\\' : '/';
  const hit = normalize(trees).find((entry) => real === entry || real.startsWith(entry + separator));
  if (hit) return `${target} is inside a protected location (${hit})`;
  if (platform === 'win32' && /^[a-z]:$/.test(real)) return `${target} is a drive root`;
  if (platform !== 'win32' && /^\/Volumes\/[^/]+$/.test(real)) return `${target} is a volume root`;
  return undefined;
}

// Is `relativePath` ignored by Git? undefined when Git cannot tell (no repository, no git).
function isGitIgnored(root, relativePath, { spawnSync = spawnSyncProcess } = {}) {
  const result = spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', toPosix(relativePath)], { encoding: 'utf8' });
  if (result.error) return undefined;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return undefined;
}

// Age in days of the last commit in `root`, or undefined without Git history.
function lastCommitAgeDays(root, { spawnSync = spawnSyncProcess, now = Date.now() } = {}) {
  const result = spawnSync('git', ['-C', root, 'log', '-1', '--format=%ct'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return undefined;
  const seconds = Number(String(result.stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.max(0, (now - seconds * 1000) / 86_400_000);
}

// The final check, run right before a path is removed. `allowedRoots` are the folders this kind
// of item may live in; the real path must still be inside one of them (no symlink escape).
function assertRemovable(target, {
  allowedRoots, homeDir, platform, fsImpl = fs, allowUserFolderContents = false,
} = {}) {
  try {
    fsImpl.lstatSync(target);
  } catch {
    return { ok: false, reason: 'it no longer exists' };
  }
  const reason = protectedReason(target, {
    homeDir, platform, fsImpl, allowUserFolderContents,
  });
  if (reason) return { ok: false, reason };
  const real = realOrResolved(target, fsImpl);
  if (!allowedRoots.some((root) => isInside(realOrResolved(root, fsImpl), real))) {
    return { ok: false, reason: 'its real location is outside the allowed folder' };
  }
  return { ok: true };
}

module.exports = {
  assertRemovable, isGitIgnored, isInside, isTracked, lastCommitAgeDays, listTrackedFiles, protectedPaths, protectedReason,
};
