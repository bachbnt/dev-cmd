// Copyright (c) 2026 bachbnt

// A cleaner describes one global cache: where it lives, how it is measured, and how it is cleaned
// (an official tool command, or a list of folders). Cleaners may not name a shell as executable.

const PLATFORMS = ['darwin', 'linux', 'win32'];
const CATEGORIES = ['dev-cache', 'app-cache', 'log', 'artifact', 'info'];
const TIERS = ['safe', 'review', 'blocked'];
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const ALLOWED_FIELDS = new Set(['id', 'name', 'category', 'platforms', 'detect', 'measure', 'clean', 'recreate', 'tier', 'needsAdmin', 'reversible']);

function validateCleaner(raw, label) {
  const fail = (message) => { throw new Error(`${label}: ${message}`); };
  if (!raw || typeof raw !== 'object') fail('a cleaner must be an object');
  for (const key of Object.keys(raw)) if (!ALLOWED_FIELDS.has(key)) fail(`unknown field "${key}"`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(raw.id || '')) fail('id must be lowercase letters, digits and dashes');
  if (typeof raw.name !== 'string' || !raw.name) fail(`${raw.id}: name is required`);
  if (!CATEGORIES.includes(raw.category)) fail(`${raw.id}: category must be one of ${CATEGORIES.join(', ')}`);
  if (!Array.isArray(raw.platforms) || raw.platforms.length === 0 || !raw.platforms.every((name) => PLATFORMS.includes(name))) {
    fail(`${raw.id}: platforms must be a list of ${PLATFORMS.join(', ')}`);
  }
  if (!TIERS.includes(raw.tier)) fail(`${raw.id}: tier must be one of ${TIERS.join(', ')}`);
  if (typeof raw.recreate !== 'string' || !raw.recreate) fail(`${raw.id}: recreate must say what happens after cleaning`);
  const detect = raw.detect || {};
  if (!detect.executable && !Array.isArray(detect.paths)) fail(`${raw.id}: detect needs an executable or paths`);
  const clean = raw.clean;
  if (raw.tier !== 'blocked' && !clean) fail(`${raw.id}: only blocked (display-only) cleaners may omit clean`);
  if (clean) {
    const hasCommand = typeof clean.executable === 'string';
    const hasPaths = Array.isArray(clean.paths) && clean.paths.length > 0;
    if (hasCommand === hasPaths) fail(`${raw.id}: clean needs either executable and args, or paths`);
    if (hasCommand) {
      if (SHELLS.has(clean.executable.toLowerCase().replace(/^.*[\\/]/, ''))) fail(`${raw.id}: a shell cannot be a cleaner executable`);
      if (!Array.isArray(clean.args) || !clean.args.every((arg) => typeof arg === 'string')) fail(`${raw.id}: args must be a list of strings`);
    }
    if (hasPaths && !clean.paths.every((entry) => typeof entry === 'string' && entry.startsWith('{home}'))) {
      fail(`${raw.id}: cleaner paths must start with {home}`);
    }
  }
  return { needsAdmin: false, reversible: false, measure: {}, ...raw };
}

module.exports = { CATEGORIES, PLATFORMS, TIERS, validateCleaner };
