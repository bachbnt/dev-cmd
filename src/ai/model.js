// Copyright (c) 2026 bachbnt

// The data every other `src/ai` module speaks: token counts and the tools whose logs are read.

const TOKEN_FIELDS = ['input', 'output', 'cache_read', 'cache_write_5m', 'cache_write_1h'];

function emptyTokens() {
  return { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
}

function totalTokens(tokens) {
  return tokens.input + tokens.output + tokens.cache_read + tokens.cache_write_5m + tokens.cache_write_1h;
}

function cacheWrite(tokens) {
  return tokens.cache_write_5m + tokens.cache_write_1h;
}

function addTokens(target, other) {
  for (const field of TOKEN_FIELDS) target[field] += other[field];
  return target;
}

module.exports = { TOKEN_FIELDS, addTokens, cacheWrite, emptyTokens, totalTokens };
