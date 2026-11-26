#!/usr/bin/env node
// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { CLEAN_TARGETS, PYTHON_TYPES } = require('../disk/catalog');
const { isTracked, listTrackedFiles } = require('../disk/safety');

const root = path.resolve(process.argv[2] || '.');
const type = process.argv[3] || 'unknown';

const PYTHON_CACHE_DIRECTORIES = new Set(['__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache']);
const PYTHON_SKIP_DIRECTORIES = new Set(['.git', '.venv', '.tox', 'node_modules']);

// Files Git tracks under the project, or undefined when that is unknown (no Git, not a repository).
const tracked = listTrackedFiles(root);

function removeUnlessTracked(fullPath, isDirectory = true) {
  const relative = path.relative(root, fullPath);
  if (isTracked(tracked, relative)) {
    console.log(`Skipped ${relative.split(path.sep).join('/')}: ${isDirectory ? 'it contains files tracked by Git' : 'it is tracked by Git'}.`);
    return;
  }
  fs.rmSync(fullPath, { recursive: true, force: true });
}

function removePythonCaches(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && PYTHON_CACHE_DIRECTORIES.has(entry.name)) {
      removeUnlessTracked(fullPath);
    } else if (entry.isDirectory() && !PYTHON_SKIP_DIRECTORIES.has(entry.name)) {
      removePythonCaches(fullPath);
    } else if (entry.isFile() && /\.py[co]$/.test(entry.name)) {
      removeUnlessTracked(fullPath, false);
    }
  }
}

for (const target of CLEAN_TARGETS[type] || CLEAN_TARGETS.node) {
  removeUnlessTracked(path.join(root, target));
}

if (PYTHON_TYPES.includes(type)) removePythonCaches(root);
