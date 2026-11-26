// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findExecutable } = require('../runner/check');
const { getPaths } = require('../config/paths');
const { createFileLoaders } = require('../registry/files');
const { validateCleaner } = require('./schema');
const builtIns = require('./built-ins.json');

// Built-in cleaners plus the user's own in ~/.devcmd/cleaners/*.json (same schema). A user file
// with an existing id replaces the built-in one. `{home}`, `{localappdata}` and `{appdata}` in
// paths are expanded for the current user.

const { loadDirectory } = createFileLoaders({
  noun: 'cleaner',
  validate: (raw) => validateCleaner(raw, 'cleaner'),
  attach: (cleaner, source) => ({ ...cleaner, source }),
  expand: (parsed) => (Array.isArray(parsed.cleaners) ? parsed.cleaners : [parsed]),
});

function loadCleaners({ homeDir = os.homedir(), includeUser = true, fsImpl = fs } = {}) {
  const registry = new Map();
  for (const raw of builtIns.cleaners) registry.set(raw.id, { ...validateCleaner(raw, 'built-in cleaner'), source: 'built-in' });
  if (includeUser) {
    for (const cleaner of loadDirectory(getPaths(homeDir).cleanersDir, 'user', { fsImpl })) {
      // A user cleaner can never take away a protection: it may not ask for administrator rights.
      if (cleaner.needsAdmin) throw new Error(`${cleaner.id}: user cleaners cannot request administrator rights`);
      registry.set(cleaner.id, cleaner);
    }
  }
  return registry;
}

function expandPath(template, { homeDir = os.homedir(), env = process.env } = {}) {
  const localAppData = env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
  const appData = env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
  return path.normalize(template
    .replace('{home}', homeDir)
    .replace('{localappdata}', localAppData)
    .replace('{appdata}', appData));
}

// The cleaners that apply on this platform and whose tool or folder is present.
function detectCleaners(registry, { homeDir = os.homedir(), platform = process.platform, env = process.env, fsImpl = fs } = {}) {
  const found = [];
  for (const cleaner of registry.values()) {
    if (!cleaner.platforms.includes(platform)) continue;
    const paths = (cleaner.measure[platform] || []).map((entry) => expandPath(entry, { homeDir, env }));
    const detect = cleaner.detect;
    const hasTool = detect.executable ? Boolean(findExecutable(detect.executable, { env })) : false;
    const hasPath = (detect.paths || []).some((entry) => fsImpl.existsSync(expandPath(entry, { homeDir, env })));
    if (!hasTool && !hasPath && !paths.some((entry) => fsImpl.existsSync(entry))) continue;
    found.push({ cleaner, paths, hasTool });
  }
  return found;
}

module.exports = { detectCleaners, expandPath, loadCleaners };
