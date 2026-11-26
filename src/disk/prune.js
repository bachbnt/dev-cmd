// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expandPath } = require('../cleaners');
const { spawnSyncProcess } = require('../runner/spawn');
const { logPrune } = require('./audit');
const { ARTIFACTS } = require('./catalog');
const { assertRemovable, protectedReason } = require('./safety');
const { scanProjects } = require('./scan');
const { measure } = require('./size');
const { moveToTrash } = require('./trash');

// The only place that deletes. Every item goes through the same steps:
//   1. tier: `blocked` never runs; `review` runs only when the caller allows it, and goes to the Trash
//   2. check again just before removing (it exists, its real path is still inside the allowed
//      folder, it is not on the deny list, and a project folder still passes its gates)
//   3. remove: rebuildable output is deleted, anything else goes to the Trash, a global cache is
//      cleaned by its tool's own command
//   4. write the outcome to the deletion log

function outcome(item, status, details = {}) {
  return {
    id: item.id, kind: item.kind, path: item.path ?? null, bytes: item.bytes, tier: item.tier, status, ...details,
  };
}

async function recheckProjectItem(item, options) {
  const artifact = ARTIFACTS.find((entry) => entry.dir === item.artifact);
  if (!artifact) return { ok: false, reason: 'unknown artifact kind' };
  const [fresh] = (await scanProjects([item.projectRoot], options)).filter((candidate) => candidate.artifact === item.artifact);
  if (!fresh) return { ok: false, reason: 'it no longer exists' };
  if (fresh.tier === 'blocked') return { ok: false, reason: fresh.reasons.join('; ') };
  if (item.tier === 'safe' && fresh.tier !== 'safe') return { ok: false, reason: `it changed since the scan: ${fresh.reasons.join('; ')}` };
  return { ok: true };
}

function removeDirectory(target, fsImpl) {
  fsImpl.rmSync(target, {
    recursive: true, force: true, maxRetries: 3, retryDelay: 100,
  });
}

async function pruneOne(item, options) {
  const {
    homeDir, platform, fsImpl, spawnSync, allowReview, trash, env,
  } = options;
  if (item.tier === 'blocked' || item.displayOnly) return outcome(item, 'skipped', { reason: item.reasons?.join('; ') || 'shown for information only' });
  if (item.tier === 'review' && !allowReview) return outcome(item, 'skipped', { reason: `needs review: ${(item.reasons || []).join('; ')}` });
  if (item.needsAdmin) return outcome(item, 'skipped', { reason: 'needs administrator rights, which this command does not use' });

  if (item.clean?.executable) {
    if (options.dryRun) return outcome(item, 'would-run', { command: [item.clean.executable, ...item.clean.args].join(' ') });
    const before = item.bytes;
    const result = spawnSync(item.clean.executable, item.clean.args, { encoding: 'utf8', env });
    if (result.error || result.status !== 0) {
      return outcome(item, 'failed', { method: 'tool-command', reason: String(result.stderr || result.error?.message || `exit ${result.status}`).trim().split('\n')[0] });
    }
    let after = 0;
    for (const entry of item.paths || []) if (fsImpl.existsSync(entry)) after += (await measure(entry)).bytes;
    return outcome(item, 'removed', { method: 'tool-command', command: [item.clean.executable, ...item.clean.args].join(' '), freedBytes: Math.max(0, before - after) });
  }

  // Folder cleaners name their folders; a browser cache lists its folders in `paths`; the rest is one path.
  // A folder that is not there (no iPad support files, say) is simply left out.
  const wanted = item.kind === 'global-cache'
    ? item.clean.paths.map((entry) => expandPath(entry, { homeDir }))
    : (item.kind === 'browser-cache' ? item.paths : [item.path]);
  const targets = wanted.length > 1 ? wanted.filter((entry) => fsImpl.existsSync(entry)) : wanted;
  if (targets.length === 0) return outcome(item, 'skipped', { reason: 'it no longer exists' });
  const allowedRoots = item.kind === 'project-artifact' ? [item.projectRoot] : targets;
  for (const target of targets) {
    const verdict = assertRemovable(target, {
      allowedRoots, homeDir, platform, fsImpl, allowUserFolderContents: item.kind === 'project-artifact',
    });
    if (!verdict.ok) {
      if (verdict.reason === 'it no longer exists') return outcome(item, 'skipped', { reason: verdict.reason });
      return outcome(item, 'skipped', { reason: verdict.reason, blockedByDenyList: true });
    }
  }
  if (item.kind === 'project-artifact') {
    const verdict = await recheckProjectItem(item, options);
    if (!verdict.ok) return outcome(item, 'skipped', { reason: verdict.reason });
  }

  const toTrash = item.tier === 'review' || ['app', 'app-cache', 'browser-cache'].includes(item.kind);
  if (options.dryRun) return outcome(item, 'would-remove', { method: toTrash ? 'moved-to-trash' : 'deleted' });
  for (const target of targets) {
    if (toTrash) {
      const moved = trash(target, { homeDir, platform, fsImpl, spawnSync, env });
      if (!moved.ok) return outcome(item, 'failed', { method: 'moved-to-trash', reason: moved.reason });
    } else {
      try {
        removeDirectory(target, fsImpl);
      } catch (error) {
        return outcome(item, 'failed', { method: 'deleted', reason: error.code === 'EBUSY' || error.code === 'EPERM' ? `in use: ${error.message}` : error.message });
      }
    }
  }
  return outcome(item, 'removed', { method: toTrash ? 'moved-to-trash' : 'deleted', freedBytes: item.bytes });
}

// Runs the removal for the chosen items and returns one outcome per item. Nothing is deleted when
// `dryRun` is set. The deletion log gets every real outcome (and nothing on a dry run).
async function pruneItems(items, options = {}) {
  const resolved = {
    homeDir: os.homedir(),
    platform: process.platform,
    fsImpl: fs,
    spawnSync: spawnSyncProcess,
    trash: moveToTrash,
    env: process.env,
    allowReview: false,
    dryRun: false,
    ...options,
  };
  const results = [];
  for (const item of items) {
    // Last line of defense, before anything else: the deny list cannot be argued with.
    const denied = item.path ? protectedReason(item.path, { ...resolved, allowUserFolderContents: item.kind === 'project-artifact' }) : undefined;
    let result;
    if (denied && !item.displayOnly) result = outcome(item, 'skipped', { reason: denied, blockedByDenyList: true });
    else {
      try {
        result = await pruneOne(item, resolved);
      } catch (error) {
        result = outcome(item, 'failed', { reason: error.message });
      }
    }
    if (!resolved.dryRun && ['removed', 'failed'].includes(result.status)) {
      try {
        logPrune({
          path: result.path, id: result.id, bytes: result.bytes, tier: result.tier, result: result.status, method: result.method, command: result.command, reason: result.reason,
        }, { homeDir: resolved.homeDir });
      } catch {}
    }
    results.push(result);
  }
  return results;
}

module.exports = { pruneItems };
