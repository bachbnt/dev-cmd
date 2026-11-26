// Copyright (c) 2026 bachbnt

const path = require('path');
const { isObject, parseTime, projectName } = require('./shared');

// Codex logs: ~/.codex/sessions/<year>/<month>/<day>/rollout-*.jsonl.
//
// The log does not give the tokens of each request. It gives a running total for the session
// (`token_count` events), so a request is the difference between two totals. The model comes from
// the latest `turn_context`, the folder from `session_meta`.
//
// In these totals `input_tokens` already contains `cached_input_tokens`, and `output_tokens`
// already contains the reasoning tokens (`total_tokens == input_tokens + output_tokens`).

const EMPTY_TOTALS = { input: 0, cached: 0, output: 0, total: 0 };

function count(value, name) {
  const field = value[name];
  return Number.isSafeInteger(field) && field >= 0 ? field : undefined;
}

function readTotals(value) {
  if (!isObject(value)) return undefined;
  const input = count(value, 'input_tokens');
  const output = count(value, 'output_tokens');
  if (input === undefined || output === undefined) return undefined;
  return { input, cached: count(value, 'cached_input_tokens') ?? 0, output, total: count(value, 'total_tokens') ?? 0 };
}

function sameTotals(left, right) {
  return left.input === right.input && left.cached === right.cached && left.output === right.output && left.total === right.total;
}

// Tokens of the request between two running totals. A total that goes down means the counter
// restarted, so the new total is the whole request.
function since(totals, before) {
  const fresh = totals.total < before.total || totals.input < before.input
    ? totals
    : {
      input: totals.input - before.input,
      cached: Math.max(0, totals.cached - before.cached),
      output: Math.max(0, totals.output - before.output),
    };
  return {
    input: Math.max(0, fresh.input - fresh.cached),
    output: fresh.output,
    cache_read: fresh.cached,
    cache_write_5m: 0,
    cache_write_1h: 0,
  };
}

function isEmpty(tokens) {
  return tokens.input + tokens.output + tokens.cache_read === 0;
}

module.exports = {
  tool: 'codex',
  label: 'Codex',
  billing: 'tokens',
  maturity: 'verified',
  defaultDir: (homeDir) => path.join(homeDir, '.codex', 'sessions'),
  isLog: (file) => file.endsWith('.jsonl'),
  needles: ['"token_count"', '"turn_context"', '"session_meta"'],
  version: 2,
  initState: (file) => ({
    session: path.basename(file, path.extname(file)),
    project: '(unknown)',
    cwd: '',
    model: 'unknown',
    previous: { ...EMPTY_TOTALS },
  }),
  onLine(text, state, out) {
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      out.skipped += 1;
      return;
    }
    const payload = isObject(line) ? line.payload : undefined;
    if (payload === undefined || payload === null) {
      out.skipped += 1;
      return;
    }
    if (!isObject(payload)) return;

    if (typeof payload.id === 'string' && 'cwd' in payload) {
      // `session_meta`: the only payload with both an id and a working directory.
      state.session = payload.id;
      state.cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
      state.project = projectName(state.cwd);
    } else if ('turn_id' in payload && 'model' in payload) {
      // `turn_context`: the model of the requests that follow.
      if (typeof payload.model === 'string') state.model = payload.model;
    } else if (payload.type === 'token_count') {
      // Events without `info` only report rate limits.
      const totals = readTotals(payload.info?.total_token_usage);
      if (!totals || sameTotals(totals, state.previous)) return;
      const tokens = since(totals, state.previous);
      state.previous = totals;
      const at = parseTime(line.timestamp);
      if (at === undefined) {
        out.skipped += 1;
        return;
      }
      if (!isEmpty(tokens)) {
        out.records.push({
          key: null, tool: 'codex', model: state.model, session: state.session, project: state.project, cwd: state.cwd, branch: '', sidechain: false, at, tokens,
        });
      }
    }
  },
};
