// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectCleaners, loadCleaners } = require('../cleaners');
const { getExistingProjects } = require('../projects/recent');
const { ARTIFACTS } = require('./catalog');
const {
  isGitIgnored, isTracked, lastCommitAgeDays, listTrackedFiles,
} = require('./safety');
const { measure } = require('./size');

// Finds what could be freed. Everything here only reads; deleting lives in `prune.js`.
//
// An item is `safe` only when it passes every gate; a failed gate makes it `review` with the
// reason, and tracked files make it `blocked`:
//   1. a manifest next to it proves it belongs to a project of that kind
//   2. a lockfile exists (for dependency folders), so installing again gives the same result
//   3. Git ignores it (so it is not part of the project)
//   4. the project has not been touched for `olderThanDays`

const MARKERS = ['package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'Cargo.toml', 'pubspec.yaml', 'Podfile'];
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'Library', 'Applications', 'Pods', 'venv', '.venv', 'target']);
const DAY_MS = 86_400_000;

function hasAny(root, names, fsImpl = fs) {
  return names.some((name) => fsImpl.existsSync(path.join(root, name)));
}

function newestMtime(root, names, fsImpl = fs) {
  let newest = 0;
  for (const name of names) {
    try {
      newest = Math.max(newest, fsImpl.statSync(path.join(root, name)).mtimeMs);
    } catch {}
  }
  return newest;
}

// Project folders under the roots (depth-limited). A folder with a marker is a project and is not
// searched further; hidden folders and dependency folders are skipped.
function discoverProjects(roots, { maxDepth = 3, fsImpl = fs } = {}) {
  const found = [];
  function walk(directory, depth) {
    if (hasAny(directory, MARKERS, fsImpl)) {
      found.push(directory);
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = fsImpl.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(path.join(directory, entry.name), depth + 1);
    }
  }
  for (const root of roots) walk(path.resolve(root), 0);
  return [...new Set(found)];
}

function assessArtifact(root, artifact, context) {
  const { tracked, olderThanDays, ageDays } = context;
  const reasons = [];
  let tier = 'safe';
  const downgrade = (reason, to = 'review') => {
    reasons.push(reason);
    if (tier !== 'blocked') tier = to;
  };
  if (!hasAny(root, artifact.manifest)) downgrade(`no ${artifact.manifest[0]} next to it`);
  if (artifact.kind === 'reinstall' && !hasAny(root, artifact.lockfiles)) downgrade('no lockfile, so installing again may give different versions');
  if (isTracked(tracked, artifact.dir)) {
    downgrade('it contains files tracked by Git', 'blocked');
  } else {
    const ignored = context.isIgnored(artifact.dir);
    if (ignored === false) downgrade('Git does not ignore it');
    else if (ignored === undefined) downgrade('not a Git repository, so it cannot be confirmed as disposable');
  }
  if (ageDays !== undefined && ageDays < olderThanDays) downgrade(`the project was used ${Math.floor(ageDays)} day(s) ago (limit ${olderThanDays})`);
  return { tier, reasons };
}

// Items for the artifact folders of every project. `projects` are roots; each is measured once.
async function scanProjects(projectRoots, options = {}) {
  const {
    olderThanDays = 30, now = Date.now(), fsImpl = fs, spawnSync, measureOptions,
  } = options;
  const items = [];
  const gitOptions = spawnSync ? { spawnSync } : {};
  for (const root of projectRoots) {
    const present = ARTIFACTS.filter((artifact) => fsImpl.existsSync(path.join(root, artifact.dir)));
    if (present.length === 0) continue;
    const tracked = listTrackedFiles(root, gitOptions);
    const commitAge = lastCommitAgeDays(root, { ...gitOptions, now });
    const touched = newestMtime(root, [...MARKERS, 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'uv.lock'], fsImpl);
    const ageDays = commitAge !== undefined ? commitAge : (touched ? (now - touched) / DAY_MS : undefined);
    const context = {
      tracked, olderThanDays, ageDays, isIgnored: (relative) => isGitIgnored(root, relative, gitOptions),
    };
    for (const artifact of present) {
      const full = path.join(root, artifact.dir);
      const [size, assessment] = [await measure(full, measureOptions), assessArtifact(root, artifact, context)];
      items.push({
        kind: 'project-artifact',
        id: `${root}::${artifact.dir}`,
        path: full,
        project: path.basename(root),
        projectRoot: root,
        artifact: artifact.dir,
        artifactKind: artifact.kind,
        bytes: size.bytes,
        bytesIsEstimate: size.shared,
        unreadable: size.unreadable,
        ageDays: ageDays === undefined ? null : Math.floor(ageDays),
        tier: assessment.tier,
        reasons: assessment.reasons,
        recreate: artifact.recreate,
      });
    }
  }
  return items;
}

// Items for the global caches (npm, pip, Xcode, ...). Display-only caches have tier `blocked`.
async function scanGlobal({
  homeDir = os.homedir(), platform = process.platform, env = process.env, fsImpl = fs, registry, measureOptions,
} = {}) {
  const cleaners = registry || loadCleaners({ homeDir });
  const items = [];
  for (const { cleaner, paths, hasTool } of detectCleaners(cleaners, { homeDir, platform, env, fsImpl })) {
    let bytes = 0;
    let estimate = false;
    let unreadable = 0;
    for (const entry of paths) {
      if (!fsImpl.existsSync(entry)) continue;
      const size = await measure(entry, measureOptions);
      bytes += size.bytes;
      estimate = estimate || size.shared;
      unreadable += size.unreadable;
    }
    const displayOnly = cleaner.category === 'info';
    const usable = displayOnly || Boolean(cleaner.clean?.paths) || hasTool;
    items.push({
      kind: cleaner.category === 'info' ? 'info' : 'global-cache',
      id: cleaner.id,
      name: cleaner.name,
      path: paths[0] || null,
      paths,
      bytes,
      bytesIsEstimate: estimate,
      unreadable,
      tier: usable ? cleaner.tier : 'blocked',
      reasons: usable ? [] : [`${cleaner.detect.executable || 'its tool'} is not installed`],
      displayOnly,
      recreate: cleaner.recreate,
      needsAdmin: cleaner.needsAdmin,
      clean: cleaner.clean || null,
    });
  }
  return items;
}

// Everything `dev disk` and `dev prune` look at, in one result with totals.
async function scanAll(options = {}) {
  const {
    homeDir = os.homedir(), roots = [], olderThanDays = 30, now = Date.now(), recentFile, fsImpl = fs,
  } = options;
  const recent = getExistingProjects(recentFile ? { file: recentFile } : {}).map((project) => project.path);
  const projectRoots = [...new Set([...discoverProjects(roots, { fsImpl }), ...(roots.length > 0 ? [] : recent)])];
  const [projects, globals] = await Promise.all([
    scanProjects(projectRoots, { ...options, olderThanDays, now }),
    scanGlobal({ ...options, homeDir }),
  ]);
  const items = [...projects, ...globals].sort((left, right) => right.bytes - left.bytes);
  const reclaimable = items.filter((item) => item.tier === 'safe').reduce((sum, item) => sum + item.bytes, 0);
  return {
    scannedAt: new Date(now).toISOString(),
    totals: { bytes: items.reduce((sum, item) => sum + item.bytes, 0), reclaimableBytes: reclaimable },
    projectCount: projectRoots.length,
    recentLimited: roots.length === 0 && recent.length >= 50,
    items,
  };
}

module.exports = { assessArtifact, discoverProjects, scanAll, scanGlobal, scanProjects };
