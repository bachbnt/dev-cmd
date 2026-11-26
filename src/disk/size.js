// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');

// Disk usage without `du`, so it works the same on Windows. Symbolic links and junctions are never
// followed (they count as the link itself), a file with several hard links counts once, and a
// folder that cannot be read is counted as unreadable instead of stopping the scan.

const UNITS = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
const DEFAULT_CONCURRENCY = 16;

function formatBytes(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1000) break;
    value /= 1000;
    unit = next;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

// "500MB", "1.5 GB", "2gib", "1000" (bytes) to a number of bytes.
function parseSize(text) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(String(text));
  if (!match) throw new Error(`Cannot read the size "${text}": use a number with a unit, like 500MB or 2GB.`);
  const unit = match[2] ? match[2].toUpperCase() : 'B';
  if (!(unit in UNITS)) throw new Error(`Unknown size unit "${match[2]}": use B, KB, MB, GB, TB, KiB, MiB, GiB or TiB.`);
  return Math.round(Number(match[1]) * UNITS[unit]);
}

// Limits how many directory reads are in flight, across one whole measurement.
function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  };
  return async (work) => {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

// Returns { bytes, files, unreadable, shared }. `shared` is true when some file has hard links that
// may point outside the measured folder (pnpm), so freeing the folder may free fewer bytes.
async function measure(target, { concurrency = DEFAULT_CONCURRENCY, fsImpl = fs.promises, onlyDevice } = {}) {
  const result = { bytes: 0, files: 0, unreadable: 0, shared: false };
  const seen = new Set();
  const limit = createLimiter(concurrency);

  async function visit(entryPath, rootDevice) {
    let stat;
    try {
      stat = await fsImpl.lstat(entryPath);
    } catch {
      result.unreadable += 1;
      return;
    }
    if (onlyDevice && stat.dev !== rootDevice) return;
    if (stat.isDirectory()) {
      let names;
      try {
        names = await limit(() => fsImpl.readdir(entryPath));
      } catch {
        result.unreadable += 1;
        return;
      }
      await Promise.all(names.map((name) => visit(path.join(entryPath, name), rootDevice)));
      return;
    }
    if (stat.nlink > 1 && stat.ino) {
      result.shared = true;
      const id = `${stat.dev}:${stat.ino}`;
      if (seen.has(id)) return;
      seen.add(id);
    }
    result.files += 1;
    // Allocated blocks are what the disk really holds; fall back to the logical size.
    result.bytes += stat.blocks ? stat.blocks * 512 : stat.size;
  }

  let rootStat;
  try {
    rootStat = await fsImpl.lstat(target);
  } catch {
    return { ...result, unreadable: 1 };
  }
  await visit(target, rootStat.dev);
  return result;
}

// Direct children with their sizes, biggest first. Used to drill into a folder.
async function measureChildren(directory, options = {}) {
  let entries;
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    return { entries: [], error: error.code || error.message };
  }
  const rows = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    const size = await measure(full, options);
    return {
      name: entry.name, path: full, directory: entry.isDirectory(), symlink: entry.isSymbolicLink(), ...size,
    };
  }));
  return { entries: rows.sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name)) };
}

// Files at least `minBytes` big under the roots, biggest first. Read-only; does not follow links
// and skips node_modules internals by default only when asked.
async function findLargeFiles(roots, { minBytes, limit = 50, fsImpl = fs.promises, skip = new Set(['.git']) } = {}) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fsImpl.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fsImpl.lstat(full);
          const bytes = stat.blocks ? stat.blocks * 512 : stat.size;
          if (bytes >= minBytes) found.push({ path: full, bytes, mtimeMs: stat.mtimeMs });
        } catch {}
      }
    }));
  }
  for (const root of roots) await walk(root);
  return found.sort((left, right) => right.bytes - left.bytes).slice(0, limit);
}

module.exports = { findLargeFiles, formatBytes, measure, measureChildren, parseSize };
