// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');

// `dev ai --short` feeds a status line, which calls it many times a minute. Reading the logs takes
// about 150 ms even with the scan cache, so the finished output is kept for 30 seconds and the
// `dev` launcher prints it before loading the rest of the CLI (a hit costs little more than
// starting Node).
//
// An entry holds exactly what the command wrote (stdout, stderr, exit code) for one command line,
// working folder, DevCmd version and config file. It is ignored when any of those differ, so
// changing the budget shows up at once, and it is never written for --dry-run, --no-cache, --json or --notify.
// This module only needs `fs`, `os` and `path`: it runs before anything else is loaded.

const TTL_MS = 30 * 1000;
const SKIP_FLAGS = ['--dry-run', '--no-cache', '--json', '--notify'];

function cacheable(argv) {
  return argv[0] === 'ai' && argv.includes('--short') && !SKIP_FLAGS.some((flag) => argv.includes(flag));
}

function modified(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// The identity of one command line. A different config file, folder or DevCmd version is a miss.
function entryKey({ argv, cwd, version, configFile }) {
  return JSON.stringify([argv, cwd, version, modified(configFile)]);
}

function filesOf(homeDir) {
  const root = path.join(homeDir, '.devcmd');
  return { cacheFile: path.join(root, 'ai-short-cache.json'), configFile: path.join(root, 'config.json') };
}

// Returns { stdout, stderr, exitCode } of a fresh entry, or undefined.
function readShort({ argv, homeDir = os.homedir(), cwd = process.cwd(), now = Date.now(), version }) {
  if (!cacheable(argv)) return undefined;
  const { cacheFile, configFile } = filesOf(homeDir);
  try {
    const entry = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const fresh = entry.at <= now && now - entry.at < TTL_MS;
    if (!fresh || entry.key !== entryKey({ argv, cwd, version, configFile })) return undefined;
    if (typeof entry.stdout !== 'string' || typeof entry.stderr !== 'string' || !Number.isInteger(entry.exitCode)) return undefined;
    return { stdout: entry.stdout, stderr: entry.stderr, exitCode: entry.exitCode };
  } catch {
    return undefined;
  }
}

// Written through a temporary file and a rename, so a status line that reads at the same moment
// never sees half an entry. Failing to write is not an error: the next call just reads the logs.
function writeShort({
  argv, homeDir = os.homedir(), cwd = process.cwd(), now = Date.now(), version, stdout, stderr, exitCode,
}) {
  if (!cacheable(argv)) return;
  const { cacheFile, configFile } = filesOf(homeDir);
  const temporary = `${cacheFile}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({
      at: now, key: entryKey({ argv, cwd, version, configFile }), stdout, stderr, exitCode,
    }));
    fs.renameSync(temporary, cacheFile);
  } catch {
    try {
      fs.unlinkSync(temporary);
    } catch {}
  }
}

// For the launcher: print a fresh entry and report that the command is done.
function printShort(argv) {
  const hit = readShort({ argv, version: require('../../package.json').version });
  if (!hit) return false;
  if (hit.stdout) process.stdout.write(hit.stdout);
  if (hit.stderr) process.stderr.write(hit.stderr);
  process.exitCode = hit.exitCode;
  return true;
}

module.exports = {
  TTL_MS, cacheable, printShort, readShort, writeShort,
};
