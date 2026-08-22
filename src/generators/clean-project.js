#!/usr/bin/env node
// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const type = process.argv[3] || 'unknown';

const CLEAN_TARGETS = {
  node: ['dist', 'build', 'coverage', '.cache'],
  react: ['dist', 'build', 'coverage', '.cache'],
  vue: ['dist', 'coverage', '.cache'],
  next: ['.next', 'out', 'coverage'],
  nuxt: ['.nuxt', '.output', 'dist', 'coverage'],
  nest: ['dist', 'coverage'],
  express: ['dist', 'coverage'],
  react_native: ['.expo', 'dist', 'coverage'],
  react_native_cli: ['android/app/build', 'ios/build', 'coverage'],
  python: ['build', 'dist', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.coverage'],
  django: ['build', 'dist', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.coverage'],
  fastapi: ['build', 'dist', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.coverage'],
  flask: ['build', 'dist', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.coverage'],
};

const PYTHON_CACHE_DIRECTORIES = new Set(['__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache']);
const PYTHON_SKIP_DIRECTORIES = new Set(['.git', '.venv', '.tox', 'node_modules']);

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
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else if (entry.isDirectory() && !PYTHON_SKIP_DIRECTORIES.has(entry.name)) {
      removePythonCaches(fullPath);
    } else if (entry.isFile() && /\.py[co]$/.test(entry.name)) {
      fs.rmSync(fullPath, { force: true });
    }
  }
}

for (const target of CLEAN_TARGETS[type] || CLEAN_TARGETS.node) {
  fs.rmSync(path.join(root, target), { recursive: true, force: true });
}

if (['python', 'django', 'fastapi', 'flask'].includes(type)) removePythonCaches(root);
