// Copyright (c) 2026 bachbnt

const os = require('os');
const path = require('path');
const { version } = require('../../package.json');
const { builtInRegistry, getRecipeDefinitions } = require('../recipes');

const BRAND = 'DevCmd';
const CONFIG_FILE = path.join(os.homedir(), '.devcmd', 'config.json');
const HISTORY_FILE = path.join(os.homedir(), '.devcmd', 'history.json');
const OPENERS_DIR = path.join(os.homedir(), '.devcmd', 'openers');
const PROJECTS_FILE = path.join(os.homedir(), '.devcmd', 'projects.json');
const RECIPES_DIR = path.join(os.homedir(), '.devcmd', 'recipes');
const TRUST_FILE = path.join(os.homedir(), '.devcmd', 'trusted.json');
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
  PROJECTS_FILE,
  RECIPES_DIR,
  TRUST_FILE,
  VERSION: version,
  frameworkDefinitions,
};
