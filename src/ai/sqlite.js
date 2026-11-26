// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSyncProcess } = require('../runner/spawn');

// Read-only SQL access for the AI tools that keep their usage in SQLite (OpenCode, Copilot).
// `node:sqlite` is used when this Node has it (22.5+), otherwise the `sqlite3` command. Nothing is
// ever written to the database; when the tool holds it open, a copy of the files is read instead.

let nodeSqlite;
function loadNodeSqlite() {
  if (nodeSqlite !== undefined) return nodeSqlite;
  const emit = process.emitWarning;
  // `node:sqlite` prints an experimental warning on first use; a usage report should not.
  process.emitWarning = () => {};
  try {
    nodeSqlite = require('node:sqlite');
  } catch {
    nodeSqlite = null;
  } finally {
    process.emitWarning = emit;
  }
  return nodeSqlite;
}

function rowsFromNode(file, sql) {
  const { DatabaseSync } = loadNodeSqlite();
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

function rowsFromCli(file, sql, spawnSync) {
  const result = spawnSync('sqlite3', ['-readonly', '-json', file, sql], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (result.error) throw new Error('reading this tool needs Node 22.5 or newer, or the sqlite3 command');
  if (result.status !== 0) throw new Error(String(result.stderr || `sqlite3 exited ${result.status}`).trim().split('\n')[0]);
  const text = String(result.stdout).trim();
  return text ? JSON.parse(text) : [];
}

// Rows for `sql` (a SELECT) on the database at `file`.
function queryRows(file, sql, { spawnSync = spawnSyncProcess, preferCli = false } = {}) {
  const attempt = () => (!preferCli && loadNodeSqlite() ? rowsFromNode(file, sql) : rowsFromCli(file, sql, spawnSync));
  try {
    return attempt();
  } catch (error) {
    // The tool may be writing (journal or WAL in use): read a copy of the database files.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-sqlite-'));
    try {
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, path.join(directory, path.basename(file) + suffix));
      }
      const copy = path.join(directory, path.basename(file));
      return !preferCli && loadNodeSqlite() ? rowsFromNode(copy, sql) : rowsFromCli(copy, sql, spawnSync);
    } catch {
      throw error;
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

module.exports = { queryRows };
