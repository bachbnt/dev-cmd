// Copyright (c) 2026 bachbnt

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Reads a JSON file. A missing file returns `fallback`. Any other failure also returns `fallback`
// unless `strict` is set, in which case the original error is thrown.
function readJson(file, { fsImpl = fs, fallback, strict = false } = {}) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || !strict) return fallback;
    throw error;
  }
}

// Writes JSON through a temporary file in the same directory and renames it over the target, so a
// reader (or a second `dev` process) never sees a half-written file. Concurrent writers can still
// overwrite each other's changes, but the file is never corrupted.
function writeJsonAtomic(file, data, { fsImpl = fs, space = 2 } = {}) {
  const directory = path.dirname(file);
  fsImpl.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fsImpl.writeFileSync(temporary, `${JSON.stringify(data, null, space)}\n`);
    fsImpl.renameSync(temporary, file);
  } catch (error) {
    try {
      fsImpl.unlinkSync(temporary);
    } catch {}
    throw error;
  }
}

// Appends one JSON record per line. When the file exceeds `maxBytes` it is rotated to `<file>.1`
// (replacing any previous rotation) before the new record is written.
function appendJsonl(file, record, { fsImpl = fs, maxBytes = 5 * 1024 * 1024 } = {}) {
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fsImpl.statSync(file).size > maxBytes) fsImpl.renameSync(file, `${file}.1`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  fsImpl.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

// Reads JSON Lines, skipping lines that are not valid JSON. Returns the newest `limit` records.
function readJsonl(file, { fsImpl = fs, limit } = {}) {
  let content;
  try {
    content = fsImpl.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const records = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {}
  }
  return limit ? records.slice(-limit) : records;
}

module.exports = { appendJsonl, readJson, readJsonl, writeJsonAtomic };
