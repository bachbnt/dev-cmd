// Copyright (c) 2026 bachbnt

const os = require('os');
const path = require('path');

// Every DevCmd file location under one home directory. Code that needs a testable home passes
// `homeDir`; the legacy constants in `config/index.js` are `getPaths()` evaluated once.
function getPaths(homeDir = os.homedir()) {
  const root = path.join(homeDir, '.devcmd');
  return Object.freeze({
    homeDir,
    root,
    configFile: path.join(root, 'config.json'),
    historyFile: path.join(root, 'history.json'),
    projectsFile: path.join(root, 'projects.json'),
    trustFile: path.join(root, 'trusted.json'),
    recipesDir: path.join(root, 'recipes'),
    openersDir: path.join(root, 'openers'),
    cleanersDir: path.join(root, 'cleaners'),
    maintenanceDir: path.join(root, 'maintenance'),
    pruneLogFile: path.join(root, 'prune-log.jsonl'),
    diskDailyFile: path.join(root, 'disk-daily.json'),
    aiDailyFile: path.join(root, 'ai-daily.json'),
    aiScanCacheFile: path.join(root, 'ai-scan-cache.json'),
    aiShortCacheFile: path.join(root, 'ai-short-cache.json'),
    aiImportedDir: path.join(root, 'ai-imported'),
  });
}

module.exports = { getPaths };
