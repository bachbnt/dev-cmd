// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findExecutable } = require('../runner/check');
const { getPaths } = require('../config/paths');
const { validateCleaner } = require('./schema');
const builtIns = require('./built-ins.json');

// Built-in cleaners plus the user's own in ~/.devcmd/cleaners/*.json (same schema). A user file
// with an existing id replaces the built-in one. `{home}`, `{localappdata}` and `{appdata}` in
// paths are expanded for the current user.

function loadCleaners({ homeDir = os.homedir(), includeUser = true, fsImpl = fs } = {}) {
  const registry = new Map();
  for (const raw of builtIns.cleaners) registry.set(raw.id, { ...validateCleaner(raw, 'built-in cleaner'), source: 'built-in' });
  const directory = getPaths(homeDir).cleanersDir;
  if (includeUser && fsImpl.existsSync(directory)) {
    for (const name of fsImpl.readdirSync(directory).filter((file) => file.endsWith('.json')).sort()) {
      const file = path.join(directory, name);
      let data;
      try {
        data = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
      } catch (error) {
        throw new Error(`Invalid cleaner file ${file}: ${error.message}`);
      }
      for (const raw of Array.isArray(data.cleaners) ? data.cleaners : [data]) {
        const cleaner = validateCleaner(raw, file);
        // A user cleaner can never take away a protection: it may not claim the safe tier for admin work.
        if (cleaner.needsAdmin) throw new Error(`${file}: ${cleaner.id}: user cleaners cannot request administrator rights`);
        registry.set(cleaner.id, { ...cleaner, source: 'user' });
      }
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
