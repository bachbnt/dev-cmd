// Copyright (c) 2026 bachbnt

const fs = require('fs');
const { readJson, writeJsonAtomic } = require('../store/json-store');

// Incremental scan cache. Logs are append-only, so for each file we keep the requests found so
// far, the byte position read up to, and the reader's state there (needed by Codex, whose requests
// are differences between running totals). Next time only the new bytes are read. The cache holds
// numbers and short names (model, project, session), never message content.
//
// A file is trusted only if it did not shrink and its first bytes and the bytes just before the
// saved position are unchanged; anything else is read again from the start.

const CACHE_VERSION = 1;
const HEAD_BYTES = 256;
const CHECK_BYTES = 64;

function emptyCache() {
  return { version: CACHE_VERSION, files: {} };
}

function loadCache(file) {
  const cache = readJson(file, { fallback: undefined });
  if (!cache || cache.version !== CACHE_VERSION || typeof cache.files !== 'object' || cache.files === null) return emptyCache();
  return cache;
}

function saveCache(file, cache) {
  // Compact JSON: this file can hold tens of thousands of records.
  writeJsonAtomic(file, cache, { space: 0 });
}

// Records as arrays with a string table: [key, model, session, project, at, ...token counts].
function encodeRecords(records) {
  const table = [];
  const index = new Map();
  const id = (text) => {
    if (!index.has(text)) {
      index.set(text, table.length);
      table.push(text);
    }
    return index.get(text);
  };
  const rows = records.map((record) => {
    const { input, output, cache_read: read, cache_write_5m: five, cache_write_1h: hour } = record.tokens;
    return [record.key, id(record.model), id(record.session), id(record.project), record.at, input, output, read, five, hour];
  });
  return { table, rows };
}

function decodeRecords(tool, { table, rows }) {
  return rows.map(([key, model, session, project, at, input, output, read, five, hour]) => ({
    key,
    tool,
    model: table[model],
    session: table[session],
    project: table[project],
    at,
    tokens: {
      input, output, cache_read: read, cache_write_5m: five, cache_write_1h: hour,
    },
  }));
}

async function readRange(handle, position, length) {
  if (length <= 0) return '';
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead).toString('base64');
}

// First bytes of the file and the bytes just before `offset`.
async function fingerprint(file, size, offset) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const head = await readRange(handle, 0, Math.min(HEAD_BYTES, size));
    const checkLength = Math.min(CHECK_BYTES, offset);
    const check = await readRange(handle, offset - checkLength, checkLength);
    return { head, check };
  } finally {
    await handle.close();
  }
}

// Can the cached entry be extended with the bytes after `entry.offset`?
async function canResume(file, entry, size) {
  if (size < entry.size || size < entry.offset) return false;
  const now = await fingerprint(file, size, entry.offset);
  return now.head === entry.head && now.check === entry.check;
}

module.exports = {
  CACHE_VERSION,
  canResume,
  decodeRecords,
  emptyCache,
  encodeRecords,
  fingerprint,
  loadCache,
  saveCache,
};
