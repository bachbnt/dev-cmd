// Copyright (c) 2026 bachbnt

const path = require('path');
const { queryRows } = require('../sqlite');
const { projectName } = require('./shared');

// GitHub Copilot CLI: ~/.copilot/session-store.db, table `assistant_usage_events`, one row per
// model reply. `input_tokens` already contains the cache reads and writes, so the fresh input is
// what is left after taking them out; `output_tokens` already contains the reasoning tokens.
// Copilot also stores what it charged (`total_nano_aiu`, in billionths of an AI unit): DevCmd shows
// it 1 unit = 1 USD, which matches the per-million-token rates in each row but is not documented
// by GitHub, so the source is marked experimental.

const SQL = `select e.session_id, e.model, e.input_tokens, e.output_tokens, e.cache_read_tokens,
  e.cache_write_tokens, e.total_nano_aiu, e.created_at, s.cwd
  from assistant_usage_events e left join sessions s on s.id = e.session_id`;

const count = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

function readRows(rows) {
  const records = [];
  let skipped = 0;
  for (const row of rows) {
    // created_at is an ISO time with a Z (the column default, `datetime('now')`, is UTC without a mark).
    const text = String(row.created_at);
    const at = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
    if (Number.isNaN(at) || typeof row.model !== 'string') {
      skipped += 1;
      continue;
    }
    const cacheRead = count(row.cache_read_tokens);
    const cacheWrite = count(row.cache_write_tokens);
    const tokens = {
      input: Math.max(0, count(row.input_tokens) - cacheRead - cacheWrite),
      output: count(row.output_tokens),
      cache_read: cacheRead,
      cache_write_5m: cacheWrite,
      cache_write_1h: 0,
    };
    records.push({
      key: null,
      tool: 'copilot',
      model: row.model,
      session: String(row.session_id ?? ''),
      project: projectName(row.cwd),
      at,
      tokens,
      reportedCost: typeof row.total_nano_aiu === 'number' ? row.total_nano_aiu / 1e9 : undefined,
    });
  }
  return { records, skipped };
}

module.exports = {
  tool: 'copilot',
  label: 'GitHub Copilot CLI',
  kind: 'sqlite',
  billing: 'reported-cost',
  maturity: 'experimental',
  defaultDir: (homeDir) => path.join(homeDir, '.copilot'),
  dbFile: 'session-store.db',
  read: (file, options) => readRows(queryRows(file, SQL, options)),
  readRows,
};
