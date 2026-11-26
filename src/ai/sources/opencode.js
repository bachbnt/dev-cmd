// Copyright (c) 2026 bachbnt

const path = require('path');
const { queryRows } = require('../sqlite');
const { isObject, projectName } = require('./shared');

// OpenCode: ~/.local/share/opencode/opencode.db (or $XDG_DATA_HOME/opencode), table `message`, one
// JSON document per message. Assistant messages carry `tokens` (input without the cache, output
// including reasoning, cache.read, cache.write), `modelID`, `path.cwd` and `cost`, the cost
// OpenCode itself worked out (0 for free models). Checked on a real database: `tokens.total` is
// input + output + cache read + cache write, so reasoning is already inside `output`.

const SQL = `select m.id, m.session_id, m.time_created, m.data, s.directory
  from message m left join session s on s.id = m.session_id`;

const count = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

function readRows(rows) {
  const records = [];
  let skipped = 0;
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      skipped += 1;
      continue;
    }
    if (!isObject(data) || data.role !== 'assistant' || !isObject(data.tokens)) continue;
    const { tokens } = data;
    const cache = isObject(tokens.cache) ? tokens.cache : {};
    const usage = {
      input: count(tokens.input),
      output: count(tokens.output),
      cache_read: count(cache.read),
      cache_write_5m: count(cache.write),
      cache_write_1h: 0,
    };
    if (usage.input + usage.output + usage.cache_read + usage.cache_write_5m === 0) continue;
    const at = Number(data.time?.completed ?? data.time?.created ?? row.time_created);
    if (!Number.isFinite(at)) {
      skipped += 1;
      continue;
    }
    records.push({
      key: null,
      tool: 'opencode',
      model: typeof data.modelID === 'string' ? data.modelID : 'unknown',
      session: String(row.session_id ?? ''),
      project: projectName(data.path?.cwd ?? row.directory),
      cwd: String(data.path?.cwd ?? row.directory ?? ''),
      branch: '',
      sidechain: false,
      at,
      tokens: usage,
      reportedCost: typeof data.cost === 'number' && data.cost >= 0 ? data.cost : undefined,
    });
  }
  return { records, skipped };
}

module.exports = {
  tool: 'opencode',
  label: 'OpenCode',
  kind: 'sqlite',
  billing: 'reported-cost',
  maturity: 'verified',
  defaultDir: (homeDir, env = process.env) => path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), 'opencode'),
  dbFile: 'opencode.db',
  read: (file, options) => readRows(queryRows(file, SQL, options)),
  readRows,
};
