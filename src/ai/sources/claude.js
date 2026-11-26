// Copyright (c) 2026 bachbnt

const path = require('path');
const {
  BROKEN,
  isObject,
  optionalCount,
  optionalObject,
  optionalString,
  parseTime,
  projectName,
} = require('./shared');

// Claude Code logs: ~/.claude/projects/<project>/<session>.jsonl, and the same under
// <session>/subagents/ for sub-agents.
//
// Every reply of the assistant carries `message.usage`. Claude Code writes the same reply several
// times (once per content block, and again in the sub-agent's file), so the pair `message.id` +
// `requestId` is the key that removes the copies.

function cacheTokens(usage) {
  const written = optionalCount(usage.cache_creation_input_tokens) ?? 0;
  const split = optionalObject(usage.cache_creation);
  const five = split ? optionalCount(split.ephemeral_5m_input_tokens) ?? 0 : 0;
  const hour = split ? optionalCount(split.ephemeral_1h_input_tokens) ?? 0 : 0;
  // Without the split every write is a 5 minute write; so is whatever the split does not account for.
  return { five: five + Math.max(0, written - (five + hour)), hour };
}

// Returns a usage record, null for a line that holds no request, and throws BROKEN for a damaged one.
function readLine(text) {
  let line;
  try {
    line = JSON.parse(text);
  } catch {
    throw BROKEN;
  }
  if (!isObject(line)) throw BROKEN;
  const timestamp = optionalString(line.timestamp);
  const cwd = optionalString(line.cwd);
  const sessionId = optionalString(line.sessionId);
  const requestId = optionalString(line.requestId);
  const message = optionalObject(line.message);
  if (!message) return null;
  const id = optionalString(message.id);
  const model = optionalString(message.model);
  const usage = optionalObject(message.usage);
  if (model === undefined || !usage) return null;
  // `<synthetic>` is Claude Code's own placeholder reply (an error, an interruption): no model ran.
  if (model.startsWith('<')) return null;

  const write = cacheTokens(usage);
  const tokens = {
    input: optionalCount(usage.input_tokens) ?? 0,
    output: optionalCount(usage.output_tokens) ?? 0,
    cache_read: optionalCount(usage.cache_read_input_tokens) ?? 0,
    cache_write_5m: write.five,
    cache_write_1h: write.hour,
  };
  const at = parseTime(timestamp);
  if (at === undefined) throw BROKEN;
  if (tokens.input + tokens.output + tokens.cache_read + tokens.cache_write_5m + tokens.cache_write_1h === 0) return null;

  return {
    key: id !== undefined && requestId !== undefined ? `${id}:${requestId}` : null,
    tool: 'claude',
    model,
    session: sessionId ?? '',
    project: projectName(cwd),
    cwd: cwd ?? '',
    branch: optionalString(line.gitBranch) ?? '',
    sidechain: line.isSidechain === true,
    at,
    tokens,
  };
}

module.exports = {
  tool: 'claude',
  label: 'Claude Code',
  billing: 'tokens',
  maturity: 'verified',
  defaultDir: (homeDir) => path.join(homeDir, '.claude', 'projects'),
  isLog: (file) => file.endsWith('.jsonl'),
  needles: ['"usage"'],
  // Bump when the way a line is read changes: cached results from older readers are dropped.
  version: 2,
  initState: () => ({}),
  onLine(text, _state, out) {
    try {
      const record = readLine(text);
      if (record) out.records.push(record);
    } catch (error) {
      if (error !== BROKEN) throw error;
      out.skipped += 1;
    }
  },
};
