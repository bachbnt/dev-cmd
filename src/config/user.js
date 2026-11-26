// Copyright (c) 2026 bachbnt

const fs = require('fs');
const { readJson: readJsonFile, writeJsonAtomic } = require('../store/json-store');
const { CONFIG_FILE, PACKAGE_MANAGERS } = require('./index');

// Every setting is declared once in SCHEMA: its type, its default (or none), how a text value from
// `dev config set` is read, and what makes a stored value valid. `DEFAULT_CONFIG`, `CONFIG_KEYS`,
// `parseConfigValue` and `validateConfig` are all derived from it.
//
//   type      'enum' | 'boolean' | 'string' | 'integer' | 'number' | 'object'
//   default   written into a fresh config; settings without one stay unset until you set them
//   fallback  what the code uses while the setting is unset (not written to the file)
//   settable  false for objects that `dev config set` cannot express (managed by their own command)
//   off       a word that removes the setting (`dev config set aiBudget off`)
//   message   the error shown for an invalid value (and for a bad `set` argument, unless `setMessage`)

const SCHEMA = {
  packageManager: {
    type: 'enum', values: PACKAGE_MANAGERS, default: 'npm', message: `packageManager must be one of: ${PACKAGE_MANAGERS.join(', ')}`,
  },
  initializeGit: { type: 'boolean', default: true, message: 'initializeGit must be true or false.' },
  python: {
    type: 'string', default: process.platform === 'win32' ? 'python' : 'python3', message: 'python must be a non-empty executable name or path.',
  },
  opener: { type: 'string', default: 'vscode', message: 'opener must be a non-empty opener name.' },
  notify: {
    type: 'integer', min: 0, default: 0, message: 'notify must be a non-negative integer (seconds).', setMessage: 'notify must be a non-negative integer (seconds). Use 0 to disable.',
  },
  editor: { type: 'string', message: 'editor must be a non-empty application or executable name.' },
  aiBudget: {
    type: 'number', min: 0, off: 'off', message: 'aiBudget must be a non-negative number (USD per month).', setMessage: 'aiBudget must be a non-negative number (USD per month). Use off to remove it.',
  },
  aiPlan: {
    type: 'number', min: 0, off: 'off', message: 'aiPlan must be a non-negative number (USD per month).', setMessage: 'aiPlan must be a non-negative number (USD per month). Use off to remove it.',
  },
  aiAnomalyFactor: { type: 'number', min: 1, fallback: 3, message: 'aiAnomalyFactor must be a number of at least 1 (times the usual daily cost).' },
  aiAnomalyMinUsd: { type: 'number', min: 0, fallback: 5, message: 'aiAnomalyMinUsd must be a non-negative number (USD).' },
  aiPriceStaleDays: { type: 'integer', min: 1, fallback: 90, message: 'aiPriceStaleDays must be a positive whole number of days.' },
  aiMachine: { type: 'string', pattern: /^[A-Za-z0-9_-]{1,40}$/, message: 'aiMachine must be 1 to 40 letters, digits, dashes or underscores.' },
  aiClients: { type: 'object', settable: false, message: 'aiClients must be an object that maps a folder path to a client name.' },
};

const DEFAULT_CONFIG = Object.fromEntries(Object.entries(SCHEMA).filter(([, entry]) => 'default' in entry).map(([key, entry]) => [key, entry.default]));
const CONFIG_KEYS = Object.entries(SCHEMA).filter(([, entry]) => entry.settable !== false).map(([key]) => key);

function readJson(file, fsImpl = fs) {
  try {
    return readJsonFile(file, { fsImpl, fallback: {}, strict: true });
  } catch (error) {
    throw new Error(`Unable to read config ${file}: ${error.message}`);
  }
}

function isValid(entry, value) {
  switch (entry.type) {
    case 'enum': return entry.values.includes(value);
    case 'boolean': return typeof value === 'boolean';
    case 'string': return typeof value === 'string' && Boolean(value.trim()) && (!entry.pattern || entry.pattern.test(value));
    case 'integer': return Number.isInteger(value) && value >= (entry.min ?? -Infinity);
    case 'number': return typeof value === 'number' && Number.isFinite(value) && value >= (entry.min ?? -Infinity);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.values(value).every((name) => typeof name === 'string' && name.trim());
    default: return false;
  }
}

function validateConfig(config) {
  // Settings with a default are always checked; the others only when present.
  for (const [key, entry] of Object.entries(SCHEMA)) {
    const value = config[key];
    if (value === undefined && (!('default' in entry) || (key === 'opener' && config.editor))) continue;
    if (!isValid(entry, value)) throw new Error(entry.message);
  }
  return config;
}

function loadConfig(options = {}) {
  const file = options.file || CONFIG_FILE;
  const fsImpl = options.fsImpl || fs;
  const saved = readJson(file, fsImpl);
  const config = { ...DEFAULT_CONFIG, ...saved };
  if (saved.editor && saved.opener === undefined) delete config.opener;
  return validateConfig(config);
}

function parseConfigValue(key, value) {
  if (!CONFIG_KEYS.includes(key)) {
    throw new Error(`Unknown config key: ${key}. Available keys: ${CONFIG_KEYS.join(', ')}`);
  }
  const entry = SCHEMA[key];
  const fail = () => { throw new Error(entry.setMessage || entry.message); };
  if (entry.off && value === entry.off) return undefined;
  switch (entry.type) {
    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      return fail();
    case 'integer':
    case 'number': {
      const number = Number(value);
      if (String(value).trim() === '' || !isValid(entry, number)) return fail();
      return number;
    }
    default:
      return isValid(entry, value) ? value : fail();
  }
}

function saveConfig(config, options = {}) {
  const file = options.file || CONFIG_FILE;
  const fsImpl = options.fsImpl || fs;
  const validated = validateConfig({ ...config });
  writeJsonAtomic(file, validated, { fsImpl });
  return validated;
}

function setConfigValue(key, value, options = {}) {
  const config = loadConfig(options);
  if (key === 'editor') delete config.opener;
  if (key === 'opener') delete config.editor;
  const parsed = parseConfigValue(key, value);
  config[key] = parsed;
  return saveConfig(config, options);
}

// A setting's value, or its fallback while unset (for settings with no default in the file).
function configValue(config, key) {
  return config?.[key] ?? SCHEMA[key]?.fallback;
}

module.exports = {
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  SCHEMA,
  configValue,
  loadConfig,
  parseConfigValue,
  saveConfig,
  setConfigValue,
  validateConfig,
};
