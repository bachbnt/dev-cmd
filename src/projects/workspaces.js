// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');

function readJsonSafe(file, fsImpl) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function readPnpmPatterns(root, fsImpl) {
  let content;
  try {
    content = fsImpl.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  } catch {
    return [];
  }
  const patterns = [];
  let inPackages = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = line.match(/^\s+-\s+['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/);
      if (item) patterns.push(item[1]);
      else if (/^\S/.test(line)) inPackages = false;
    }
  }
  return patterns;
}

function declaredPatterns(root, packageJson, fsImpl) {
  const declared = packageJson?.workspaces;
  const fromPackage = Array.isArray(declared) ? declared : declared?.packages;
  return [
    ...(Array.isArray(fromPackage) ? fromPackage : []),
    ...readPnpmPatterns(root, fsImpl),
  ].filter((pattern) => typeof pattern === 'string' && pattern && !pattern.startsWith('!'));
}

function expandPattern(root, pattern, fsImpl) {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (normalized.split('/').includes('..') || path.isAbsolute(normalized)) return [];
  if (!normalized.includes('*')) return [normalized];
  const base = normalized.replace(/\/\*{1,2}$/, '');
  if (base.includes('*')) return [];
  try {
    return fsImpl.readdirSync(path.join(root, base), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
      .map((entry) => `${base}/${entry.name}`);
  } catch {
    return [];
  }
}

function findWorkspaces(root, packageJson, fsImpl = fs) {
  const seen = new Set();
  const workspaces = [];
  for (const pattern of declaredPatterns(root, packageJson, fsImpl)) {
    for (const dir of expandPattern(root, pattern, fsImpl)) {
      if (seen.has(dir)) continue;
      const manifest = readJsonSafe(path.join(root, dir, 'package.json'), fsImpl);
      if (!manifest) continue;
      seen.add(dir);
      workspaces.push({ name: manifest.name || path.basename(dir), dir, packageJson: manifest });
    }
  }
  return workspaces;
}

function resolveWorkspace(project, filter) {
  const workspaces = project.workspaces || [];
  if (workspaces.length === 0) {
    throw new Error('--filter requires a Node.js workspace project (no workspaces were detected).');
  }
  const normalized = filter.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const match = workspaces.find((workspace) => workspace.name === filter)
    || workspaces.find((workspace) => workspace.dir === normalized)
    || workspaces.find((workspace) => path.basename(workspace.dir) === filter);
  if (!match) {
    throw new Error(
      `Workspace not found: ${filter}. Available: ${workspaces.map((workspace) => workspace.name).join(', ')}.`
    );
  }
  return match;
}

module.exports = {
  findWorkspaces,
  resolveWorkspace,
};
