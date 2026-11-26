// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { findExecutable } = require('../runner/check');
const {
  buildElevatedCommand, combineRemovals, planElevatedRemoval, runElevated,
} = require('../runner/elevate');
const { spawnSyncProcess } = require('../runner/spawn');
const catalog = require('./built-ins.json');

// A short list of maintenance tasks. DevCmd does not promise speed: each task says what it does,
// whether it needs administrator rights, and whether it can be undone. Tasks that need
// administrator rights only run through `runElevated` (see runner/elevate.js).

const SHELL_NAMES = /^(sh|bash|zsh|fish|cmd|powershell|pwsh)(\.exe)?$/i;

function validateTask(task) {
  if (task.removeChildrenOf) {
    if (!task.needsAdmin || !task.removeChildrenOf.startsWith('/')) throw new Error(`maintenance task ${task.id}: removeChildrenOf needs an absolute path and administrator rights`);
    return task;
  }
  const names = [task.command.executable, task.then?.executable].filter(Boolean);
  for (const name of names) {
    if (SHELL_NAMES.test(name.replace(/^.*[\\/]/, ''))) throw new Error(`maintenance task ${task.id}: a shell cannot be a task executable`);
    if (task.needsAdmin && !name.startsWith('/')) throw new Error(`maintenance task ${task.id}: an administrator task needs absolute executable paths`);
  }
  return task;
}

function listTasks({ platform = process.platform, env = process.env } = {}) {
  return catalog.tasks.map(validateTask)
    .filter((task) => task.platforms.includes(platform))
    .map((task) => ({ ...task, available: task.detect ? Boolean(findExecutable(task.detect, { env })) : true }));
}

// Entries of a folder that a clearing task may remove: not on its skip list, and (when the task
// names an age or a name pattern) old enough and matching.
function clearable(task, name, stat, now) {
  if ((task.skipPrefixes || []).some((prefix) => name.startsWith(prefix))) return false;
  if (task.pattern && !new RegExp(task.pattern).test(name)) return false;
  if (task.filesOnly && !stat.isFile()) return false;
  if (task.olderThanDays && now - stat.mtimeMs < task.olderThanDays * 86_400_000) return false;
  return true;
}

// The one `rm` command that clears a folder as root, plus what was left out and why.
function planClear(task, { fsImpl = fs, homeDir, platform = process.platform, now = Date.now() } = {}) {
  let names = [];
  try {
    names = fsImpl.readdirSync(task.removeChildrenOf);
  } catch {}
  const eligible = [];
  for (const name of names) {
    const full = path.join(task.removeChildrenOf, name);
    let stat;
    try {
      stat = fsImpl.lstatSync(full);
    } catch {
      continue;
    }
    if (clearable(task, name, stat, now)) eligible.push(full);
  }
  const plans = eligible.map((target) => planElevatedRemoval(target, { fsImpl, homeDir, platform }));
  return {
    commands: combineRemovals(plans),
    paths: plans.filter((plan) => plan.ok).map((plan) => plan.path),
    refused: [...new Set(plans.filter((plan) => !plan.ok).map((plan) => plan.reason))],
  };
}

async function runTask(task, {
  confirm, isTTY, spawnSync = spawnSyncProcess, platform = process.platform, env = process.env, fsImpl = fs, homeDir,
} = {}) {
  if (task.removeChildrenOf) {
    const { commands, refused } = planClear(task, { fsImpl, homeDir, platform });
    if (commands.length === 0) return { ok: refused.length === 0, reason: refused[0] || 'nothing to delete', results: [] };
    return runElevated(commands, { confirm, isTTY, spawnSync, platform });
  }
  if (task.needsAdmin) {
    const commands = [task.command, task.then].filter(Boolean);
    return runElevated(commands, { confirm, isTTY, spawnSync, platform });
  }
  const result = spawnSync(task.command.executable, task.command.args, { stdio: 'inherit', env });
  return { ok: result.status === 0, results: [{ command: [task.command.executable, ...task.command.args].join(' '), status: result.status, ok: result.status === 0 }] };
}

module.exports = { buildElevatedCommand, listTasks, planClear, runTask, validateTask };
