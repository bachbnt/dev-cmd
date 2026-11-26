// Copyright (c) 2026 bachbnt

const path = require('path');
const { isObject, parseTime } = require('./shared');

// Gemini CLI: ~/.gemini/tmp/<project>/chats/session-*.jsonl. Each line holds the whole message
// list so far (`$set.messages`), so a message appears on many lines; it is counted once per file
// and once across files (`<sessionId>:<message id>`).
//
// The version surveyed on the author's machine writes no token counts (a message has only id,
// timestamp, type and content). Such replies are counted as requests with zero tokens (they show
// as having no price). When a message has `tokens` (input, output, cached, thoughts, tool) they
// are used: `input` includes `cached`, `thoughts` are billed as output and `tool` as input. That
// branch follows Gemini's usage metadata and could not be checked against a real log: unverified.

function tokensOf(raw) {
  const number = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);
  if (!isObject(raw)) return { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
  const cached = number(raw.cached);
  return {
    input: Math.max(0, number(raw.input) - cached) + number(raw.tool),
    output: number(raw.output) + number(raw.thoughts),
    cache_read: cached,
    cache_write_5m: 0,
    cache_write_1h: 0,
  };
}

function messagesOf(line) {
  if (isObject(line.$set) && Array.isArray(line.$set.messages)) return line.$set.messages;
  if (Array.isArray(line.messages)) return line.messages;
  return line.type ? [line] : [];
}

function projectOf(file) {
  const parts = file.split(/[\\/]/);
  const chats = parts.lastIndexOf('chats');
  return chats > 0 ? parts[chats - 1] : '(unknown)';
}

module.exports = {
  tool: 'gemini',
  label: 'Gemini CLI',
  billing: 'requests-only',
  maturity: 'verified for request counts, unverified for tokens',
  defaultDir: (homeDir) => path.join(homeDir, '.gemini', 'tmp'),
  isLog: (name, full) => name.endsWith('.jsonl') && /[\\/]chats[\\/][^\\/]+$/.test(full),
  needles: ['"gemini"'],
  version: 1,
  initState: (file) => ({ session: path.basename(file, '.jsonl'), project: projectOf(file), seen: {} }),
  onLine(text, state, out) {
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      out.skipped += 1;
      return;
    }
    if (!isObject(line)) return;
    if (typeof line.sessionId === 'string') state.session = line.sessionId;
    for (const message of messagesOf(line)) {
      if (!isObject(message) || message.type !== 'gemini') continue;
      const id = typeof message.id === 'string' ? message.id : undefined;
      if (id !== undefined && state.seen[id]) continue;
      const at = parseTime(message.timestamp) ?? parseTime(line.lastUpdated) ?? parseTime(line.startTime);
      if (at === undefined) {
        out.skipped += 1;
        continue;
      }
      if (id !== undefined) state.seen[id] = 1;
      out.records.push({
        key: id === undefined ? null : `${state.session}:${id}`,
        tool: 'gemini',
        model: typeof message.model === 'string' ? message.model : 'gemini (model not recorded)',
        session: state.session,
        project: state.project,
        at,
        tokens: tokensOf(message.tokens),
      });
    }
  },
};
