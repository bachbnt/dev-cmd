// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { builtInRegistry } = require('../recipes');
const { loadProfile } = require('./profile');
const { findWorkspaces } = require('./workspaces');

function exists(root, name, fsImpl = fs) {
  return fsImpl.existsSync(path.join(root, name));
}

function readJson(file, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error.message}`);
  }
}

function detectPackageManager(root, packageJson = {}, fsImpl = fs) {
  if (exists(root, 'pnpm-lock.yaml', fsImpl)) return 'pnpm';
  if (exists(root, 'yarn.lock', fsImpl)) return 'yarn';
  if (exists(root, 'package-lock.json', fsImpl)) return 'npm';
  const declared = packageJson.packageManager?.split('@')[0];
  return ['npm', 'pnpm', 'yarn'].includes(declared) ? declared : 'npm';
}

function detectNodeType(packageJson) {
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (dependencies.next) return 'next';
  if (dependencies.nuxt) return 'nuxt';
  if (dependencies['@nestjs/core']) return 'nest';
  if (dependencies.expo) return 'react_native';
  if (dependencies['react-native']) return 'react_native_cli';
  if (dependencies.vue) return 'vue';
  if (dependencies.react) return 'react';
  if (dependencies.express) return 'express';
  return 'node';
}

function readText(root, file, fsImpl = fs) {
  try {
    return fsImpl.readFileSync(path.join(root, file), 'utf8').toLowerCase();
  } catch (error) {
    return undefined;
  }
}

function recipeRuleMatches(root, rule, packageJson, fsImpl = fs) {
  if (rule.files && !rule.files.every((file) => exists(root, file, fsImpl))) return false;
  if (rule.dependencies) {
    if (!packageJson) return false;
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (!rule.dependencies.every((name) => dependencies[name])) return false;
  }
  if (rule.contains && !Object.entries(rule.contains).every(([file, text]) => {
    const content = readText(root, file, fsImpl);
    return content !== undefined && content.includes(text.toLowerCase());
  })) return false;
  return true;
}

function detectRecipeAtRoot(root, registry, packageJson, fsImpl = fs) {
  const candidates = [...registry.values()]
    .filter((recipe) => recipe.detect)
    .sort((left, right) => (right.detect.priority || 0) - (left.detect.priority || 0));
  return candidates.find((recipe) =>
    recipe.detect.rules.some((rule) => recipeRuleMatches(root, rule, packageJson, fsImpl))
  );
}

function readPyproject(root, fsImpl = fs) {
  try {
    return fsImpl.readFileSync(path.join(root, 'pyproject.toml'), 'utf8').toLowerCase();
  } catch (error) {
    return '';
  }
}

function findXcodeContainer(root, fsImpl = fs) {
  try {
    const entries = fsImpl.readdirSync(root);
    const workspace = entries.find((entry) => entry.endsWith('.xcworkspace'));
    if (workspace) return { kind: 'workspace', file: workspace };
    const project = entries.find((entry) => entry.endsWith('.xcodeproj'));
    if (project) return { kind: 'project', file: project };
  } catch (error) {
    return undefined;
  }
  return undefined;
}

function detectBase(root, fsImpl = fs, registry = builtInRegistry) {
  const packageJson = exists(root, 'package.json', fsImpl)
    ? readJson(path.join(root, 'package.json'), fsImpl)
    : undefined;
  const recipe = detectRecipeAtRoot(root, registry, packageJson, fsImpl);
  if (recipe) {
    return {
      type: recipe.name,
      name: packageJson?.name || path.basename(root),
      root,
      packageJson,
      workspaces: packageJson ? findWorkspaces(root, packageJson, fsImpl) : [],
      packageManager: packageJson ? detectPackageManager(root, packageJson, fsImpl) : undefined,
      recipe,
    };
  }

  if (packageJson) {
    const type = detectNodeType(packageJson);
    return {
      type,
      name: packageJson.name || path.basename(root),
      root,
      packageJson,
      workspaces: findWorkspaces(root, packageJson, fsImpl),
      packageManager: detectPackageManager(root, packageJson, fsImpl),
      recipe: registry.get(type),
    };
  }

  if (exists(root, 'pubspec.yaml', fsImpl)) {
    return { type: 'flutter', name: path.basename(root), root, recipe: registry.get('flutter') };
  }

  if (exists(root, 'gradlew', fsImpl) || exists(root, 'gradlew.bat', fsImpl)) {
    return { type: 'android', name: path.basename(root), root };
  }

  const xcode = findXcodeContainer(root, fsImpl);
  if (xcode) return { type: 'ios', name: path.basename(root), root, xcode };

  if (exists(root, 'manage.py', fsImpl)) {
    return { type: 'django', name: path.basename(root), root, recipe: registry.get('django') };
  }

  if (exists(root, 'pyproject.toml', fsImpl)) {
    const pyproject = readPyproject(root, fsImpl);
    let type = 'python';
    if (/\bfastapi(?:\[|[<>=\s"])/.test(pyproject)) type = 'fastapi';
    else if (/\bflask(?:[<>=\s"])/.test(pyproject)) type = 'flask';
    else if (/\bdjango(?:[<>=\s"])/.test(pyproject)) type = 'django';
    return { type, name: path.basename(root), root, recipe: registry.get(type) };
  }

  return undefined;
}

function detectAtRoot(root, fsImpl = fs, registry = builtInRegistry) {
  const project = detectBase(root, fsImpl, registry);
  const profile = loadProfile(root, fsImpl);
  if (!profile) return project;
  if (project) return { ...project, profile };
  return { type: 'custom', name: profile.name || path.basename(root), root, profile };
}

function detectProject(start = process.cwd(), options = {}) {
  const fsImpl = options.fsImpl || fs;
  const registry = options.registry || builtInRegistry;
  let current = path.resolve(start);
  try {
    if (!fsImpl.statSync(current).isDirectory()) current = path.dirname(current);
  } catch (error) {
    throw new Error(`Project path does not exist: ${current}`);
  }

  while (true) {
    const project = detectAtRoot(current, fsImpl, registry);
    if (project) return project;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`No supported project was detected from: ${path.resolve(start)}`);
}

module.exports = {
  detectAtRoot,
  detectRecipeAtRoot,
  detectNodeType,
  detectPackageManager,
  detectProject,
  findXcodeContainer,
  recipeRuleMatches,
};
