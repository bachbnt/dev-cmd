// Copyright (c) 2026 bachbnt

// The one list of project folders that can be rebuilt. `dev clean`, `dev reset`, `dev disk` and
// `dev prune` all read it, so they agree on what a build folder is.
//
//   kind       'reinstall' (dependencies: install again) or 'rebuild' (build output: build again)
//   manifest   a file that must sit next to it, proving the folder belongs to a project of that kind
//   lockfiles  for 'reinstall': at least one must exist, so the install is reproducible
//   recreate   what brings it back

const NODE_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'];
const PYTHON_MANIFESTS = ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'];
const PYTHON_LOCKFILES = ['poetry.lock', 'uv.lock', 'Pipfile.lock', 'requirements.txt', 'pdm.lock'];

const ARTIFACTS = [
  { dir: 'node_modules', kind: 'reinstall', manifest: ['package.json'], lockfiles: NODE_LOCKFILES, recreate: 'install' },
  { dir: '.venv', kind: 'reinstall', manifest: PYTHON_MANIFESTS, lockfiles: PYTHON_LOCKFILES, recreate: 'python -m venv .venv, then install' },
  { dir: 'venv', kind: 'reinstall', manifest: PYTHON_MANIFESTS, lockfiles: PYTHON_LOCKFILES, recreate: 'python -m venv venv, then install' },
  { dir: '.next', kind: 'rebuild', manifest: ['package.json'], recreate: 'build' },
  { dir: '.nuxt', kind: 'rebuild', manifest: ['package.json'], recreate: 'build' },
  { dir: '.output', kind: 'rebuild', manifest: ['package.json'], recreate: 'build' },
  { dir: '.expo', kind: 'rebuild', manifest: ['package.json'], recreate: 'run' },
  { dir: '.turbo', kind: 'rebuild', manifest: ['package.json'], recreate: 'build' },
  { dir: '.parcel-cache', kind: 'rebuild', manifest: ['package.json'], recreate: 'build' },
  { dir: 'dist', kind: 'rebuild', manifest: ['package.json', ...PYTHON_MANIFESTS], recreate: 'build' },
  { dir: 'build', kind: 'rebuild', manifest: ['package.json', ...PYTHON_MANIFESTS], recreate: 'build' },
  { dir: 'coverage', kind: 'rebuild', manifest: ['package.json', ...PYTHON_MANIFESTS], recreate: 'test' },
  { dir: '.pytest_cache', kind: 'rebuild', manifest: PYTHON_MANIFESTS, recreate: 'test' },
  { dir: '.mypy_cache', kind: 'rebuild', manifest: PYTHON_MANIFESTS, recreate: 'check' },
  { dir: '.ruff_cache', kind: 'rebuild', manifest: PYTHON_MANIFESTS, recreate: 'lint' },
  { dir: '.tox', kind: 'rebuild', manifest: PYTHON_MANIFESTS, recreate: 'test' },
  { dir: 'target', kind: 'rebuild', manifest: ['Cargo.toml'], recreate: 'cargo build' },
  { dir: 'Pods', kind: 'reinstall', manifest: ['Podfile'], lockfiles: ['Podfile.lock'], recreate: 'pod install' },
  { dir: '.dart_tool', kind: 'rebuild', manifest: ['pubspec.yaml'], recreate: 'flutter pub get' },
];

// Folders `dev clean` removes, per detected project type (build output only, never dependencies).
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
const PYTHON_TYPES = ['python', 'django', 'fastapi', 'flask'];

// What `dev reset` removes before installing again.
function resetTarget(type) {
  return PYTHON_TYPES.includes(type) ? '.venv' : 'node_modules';
}

module.exports = {
  ARTIFACTS, CLEAN_TARGETS, NODE_LOCKFILES, PYTHON_TYPES, resetTarget,
};
