// Copyright (c) 2026 bachbnt

const { getPaths } = require('../config/paths');
const { appendJsonl, readJsonl } = require('../store/json-store');

// The deletion log, ~/.devcmd/prune-log.jsonl: when, what, how big, which tier, what happened.
// It stays on this computer: it is never sent to MCP, written to `dev ai` data or printed by --json
// of other commands. It rotates at 5 MB.

const MAX_BYTES = 5 * 1024 * 1024;

function logPrune(record, { homeDir, now = () => new Date(), fsImpl } = {}) {
  const file = getPaths(homeDir).pruneLogFile;
  appendJsonl(file, { at: now().toISOString(), ...record }, { maxBytes: MAX_BYTES, ...(fsImpl ? { fsImpl } : {}) });
}

function readPruneLog({ homeDir, limit = 50 } = {}) {
  return readJsonl(getPaths(homeDir).pruneLogFile, { limit });
}

module.exports = { logPrune, readPruneLog };
