// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const {
  canResume, decodeRecords, emptyCache, encodeRecords, fingerprint, loadCache, saveCache,
} = require('./cache');
const { scanFile } = require('./lines');
const { emptyScan } = require('./report');
const { getSources, sourceRoots } = require('./sources');

// Finds the log files of the wanted tools, reads them (in parallel, through the cache), removes
// requests that were logged more than once, and returns every request in a stable order.

const CONCURRENCY = 8;

async function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function isDirectory(dir) {
  try {
    return (await fs.promises.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

// Every regular file under `root` that the source recognizes. Symbolic links are not followed.
async function listLogs(source, root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && source.isLog(entry.name, full)) files.push(full);
    }
  }
  return files.sort();
}

function needsParse(chunk, needles) {
  return needles.some((needle) => chunk.includes(needle));
}

// Reads one file, resuming from `cached` when that is safe. Returns the requests found, the number
// of damaged lines, and the entry to store. The unterminated last line (which may still be growing)
// counts for this run only: it is parsed on a copy of the state and never cached.
async function readLog(source, file, stat, cached) {
  const size = stat.size;
  const mtimeMs = Math.trunc(stat.mtimeMs);
  const reusable = Boolean(cached) && cached.v === source.version;
  const unchanged = reusable && cached.size === size && cached.mtimeMs === mtimeMs;
  const resume = unchanged || (reusable && await canResume(file, cached, size));

  const out = { records: resume ? decodeRecords(source.tool, cached.data) : [], skipped: resume ? cached.skipped : 0 };
  const state = resume ? structuredClone(cached.state) : source.initState(file);
  const { offset, tail } = await scanFile(file, {
    start: resume ? cached.offset : 0,
    size,
    needles: source.needles,
    onLine: (line) => source.onLine(line, state, out),
  });

  let entry = cached;
  if (!unchanged) {
    const { head, check } = await fingerprint(file, size, offset);
    entry = {
      v: source.version, size, mtimeMs, offset, head, check, state, skipped: out.skipped, data: encodeRecords(out.records),
    };
  }

  const live = { records: [...out.records], skipped: out.skipped };
  if (tail && needsParse(tail, source.needles)) source.onLine(tail, structuredClone(state), live);
  return { entry, records: live.records, skipped: live.skipped, changed: !unchanged };
}

// SQLite sources have no byte stream to resume, so they are read whole each run (they are small).
async function readDatabase(source, file, options) {
  const { records, skipped } = await Promise.resolve(source.read(file, options));
  return { entry: undefined, records, skipped, changed: false };
}

// Newest modification time of a database and its write-ahead log (the log changes first).
function databaseMtime(file) {
  let newest = 0;
  for (const suffix of ['', '-wal']) {
    try {
      newest = Math.max(newest, fs.statSync(file + suffix).mtimeMs);
    } catch {}
  }
  return newest;
}

// config: { homeDir, dirs: { claude, codex }, roots: { <tool>: [extra folders] }, tools: [], modifiedSince: ms, cacheFile }
async function scan(config) {
  const stats = emptyScan();
  const cache = config.cacheFile ? loadCache(config.cacheFile) : emptyCache();
  const nextFiles = {};
  let dirty = false;
  const jobs = [];
  const scannedRoots = [];

  for (const source of getSources(config.tools)) {
    let foundRoot = false;
    for (const root of sourceRoots(source, config)) {
      if (!await isDirectory(root)) continue;
      scannedRoots.push(root);
      if (source.kind === 'sqlite') {
        const file = path.join(root, source.dbFile);
        if (fs.existsSync(file)) {
          foundRoot = true;
          jobs.push({ source, file, database: true });
        }
        continue;
      }
      foundRoot = true;
      for (const file of await listLogs(source, root)) jobs.push({ source, file });
    }
    if (!foundRoot) stats.missing.push(source.tool);
  }
  // Two roots that overlap (a folder and one inside it) must not read a file twice.
  const unique = new Map(jobs.map((job) => [job.file, job]));
  jobs.length = 0;
  jobs.push(...unique.values());

  const statted = await mapLimit(jobs, CONCURRENCY, async (job) => {
    try {
      const stat = await fs.promises.stat(job.file);
      return { ...job, stat: job.database ? { ...stat, mtimeMs: databaseMtime(job.file) } : stat };
    } catch (error) {
      stats.unreadable.push(`${job.file}: ${error.message}`);
      return undefined;
    }
  });
  const known = new Set(statted.filter(Boolean).map((job) => job.file));
  const wanted = statted.filter(Boolean).filter((job) => config.modifiedSince === undefined || job.stat.mtimeMs >= config.modifiedSince);

  const results = await mapLimit(wanted, CONCURRENCY, async ({ source, file, stat, database }) => {
    try {
      if (database) return { file, ...await readDatabase(source, file, config.sqlite) };
      return { file, ...await readLog(source, file, stat, cache.files[file]) };
    } catch (error) {
      return { file, error };
    }
  });

  const seen = new Set();
  const usages = [];
  for (const result of results) {
    if (result.error) {
      stats.unreadable.push(`${result.file}: ${result.error.message}`);
      continue;
    }
    stats.files += 1;
    stats.skipped_lines += result.skipped;
    if (result.entry) nextFiles[result.file] = result.entry;
    if (result.changed) dirty = true;
    for (const record of result.records) {
      if (record.key !== null && seen.has(record.key)) {
        stats.duplicates += 1;
        continue;
      }
      if (record.key !== null) seen.add(record.key);
      usages.push(record);
    }
  }
  stats.requests = usages.length;

  if (config.cacheFile) {
    // Keep entries of files that were skipped by the date filter or are still there; drop the
    // ones whose log no longer exists under a root we just walked.
    for (const [file, entry] of Object.entries(cache.files)) {
      if (file in nextFiles) continue;
      const underRoot = scannedRoots.some((root) => file.startsWith(root + path.sep));
      if (known.has(file) || !underRoot) nextFiles[file] = entry;
      else dirty = true;
    }
    if (dirty && !config.readOnlyCache) {
      try {
        saveCache(config.cacheFile, { ...cache, files: nextFiles });
      } catch {}
    }
  }
  return { usages, stats };
}

module.exports = { scan };
