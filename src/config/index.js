// Copyright (c) 2026 bachbnt

const { version } = require('../../package.json');
const { builtInRegistry, getRecipeDefinitions } = require('../recipes');
const { getPaths } = require('./paths');

const BRAND = 'DevCmd';
const PATHS = getPaths();
const CONFIG_FILE = PATHS.configFile;
const HISTORY_FILE = PATHS.historyFile;
const OPENERS_DIR = PATHS.openersDir;
const PROJECTS_FILE = PATHS.projectsFile;
const RECIPES_DIR = PATHS.recipesDir;
const TRUST_FILE = PATHS.trustFile;
const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn'];
const DEFAULT_DEVICES = {
  android: 'Pixel_9_Pro_Fold',
  ios: 'iPhone 17 Pro',
};

const frameworkDefinitions = getRecipeDefinitions(builtInRegistry);

module.exports = {
  BRAND,
  CONFIG_FILE,
  DEFAULT_DEVICES,
  HISTORY_FILE,
  OPENERS_DIR,
  PACKAGE_MANAGERS,
  PATHS,
  PROJECTS_FILE,
  RECIPES_DIR,
  TRUST_FILE,
  VERSION: version,
  frameworkDefinitions,
  getPaths,
};
