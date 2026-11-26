// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { measure } = require('./size');

// Node versions installed by nvm or fnm, and whether any known project asks for that major
// version (.nvmrc or package.json engines). Display only: DevCmd never uninstalls a version.

function nodeVersionDirectories({ homeDir = os.homedir(), platform = process.platform, env = process.env } = {}) {
  const fnmRoot = env.FNM_DIR
    || (platform === 'darwin' ? path.join(homeDir, 'Library', 'Application Support', 'fnm') : path.join(homeDir, '.local', 'share', 'fnm'));
  return [
    { manager: 'nvm', directory: path.join(env.NVM_DIR || path.join(homeDir, '.nvm'), 'versions', 'node'), versionPath: (name) => name },
    { manager: 'fnm', directory: path.join(fnmRoot, 'node-versions'), versionPath: (name) => path.join(name, 'installation') },
  ];
}

function majorOf(text) {
  const match = /(\d+)/.exec(String(text || ''));
  return match ? Number(match[1]) : undefined;
}

function referencedMajors(projectRoots, fsImpl = fs) {
  const majors = new Set();
  for (const root of projectRoots) {
    try {
      const major = majorOf(fsImpl.readFileSync(path.join(root, '.nvmrc'), 'utf8'));
      if (major !== undefined) majors.add(major);
    } catch {}
    try {
      const engines = JSON.parse(fsImpl.readFileSync(path.join(root, 'package.json'), 'utf8')).engines?.node;
      const major = majorOf(engines);
      if (major !== undefined) majors.add(major);
    } catch {}
  }
  return majors;
}

async function scanToolVersions({ projectRoots = [], fsImpl = fs, ...environment } = {}) {
  const majors = referencedMajors(projectRoots, fsImpl);
  const active = majorOf(process.version);
  const found = [];
  for (const { manager, directory, versionPath } of nodeVersionDirectories(environment)) {
    let names;
    try {
      names = fsImpl.readdirSync(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      const major = majorOf(name);
      const size = await measure(path.join(directory, versionPath(name)));
      found.push({
        tool: 'node', manager, version: name.replace(/^v/, ''), path: path.join(directory, name), bytes: size.bytes,
        inUse: major === active || majors.has(major),
      });
    }
  }
  return found.sort((left, right) => right.bytes - left.bytes);
}

module.exports = { scanToolVersions };
