#!/usr/bin/env node
// Copyright (c) 2026 bachbnt

// Compares `dev ai` with `aicost` on the same logs, field by field. Run it by hand before releasing
// a change to src/ai (and after any price change). It prints IDENTICAL or DIFF per grouping and
// never prints log content, only numbers and group names.
//
//   node scripts/ai-parity.js [--aicost <path>] [--claude-dir <dir>] [--codex-dir <dir>]
//
// With no directories it reads the real logs of this computer. Fixture logs live in
// test/fixtures/ai (the unit tests already cover those).

const path = require('node:path');
const { spawnSyncProcess } = require('../src/runner/spawn');

const GROUPS = ['tool', 'model', 'day', 'project', 'week', 'month'];
const TOKEN_FIELDS = ['input', 'output', 'cache_read', 'cache_write_5m', 'cache_write_1h'];
const COST_TOLERANCE = 1e-6;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function runJson(executable, args) {
  const result = spawnSyncProcess(executable, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw new Error(`${executable}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${executable} exited ${result.status}: ${String(result.stderr).slice(0, 300)}`);
  return JSON.parse(result.stdout);
}

function compareRows(label, left, right, differences) {
  if (left.requests !== right.requests) differences.push(`${label}: requests ${left.requests} vs ${right.requests}`);
  for (const field of TOKEN_FIELDS) {
    if (left.tokens[field] !== right.tokens[field]) differences.push(`${label}: ${field} ${left.tokens[field]} vs ${right.tokens[field]}`);
  }
  if (Math.abs(left.cost_usd - right.cost_usd) > COST_TOLERANCE) differences.push(`${label}: cost ${left.cost_usd} vs ${right.cost_usd}`);
  if (left.has_unpriced !== right.has_unpriced) differences.push(`${label}: has_unpriced ${left.has_unpriced} vs ${right.has_unpriced}`);
}

function compare(dev, aicost) {
  const differences = [];
  const byKey = (report) => new Map(report.rows.map((row) => [row.key, row]));
  const devRows = byKey(dev);
  const aicostRows = byKey(aicost);
  for (const key of new Set([...devRows.keys(), ...aicostRows.keys()])) {
    if (!devRows.has(key)) differences.push(`${key}: missing in dev ai`);
    else if (!aicostRows.has(key)) differences.push(`${key}: missing in aicost`);
    else compareRows(key, devRows.get(key), aicostRows.get(key), differences);
  }
  compareRows('total', dev.total, aicost.total, differences);
  for (const field of ['requests', 'duplicates', 'skipped_lines']) {
    if (dev.scan[field] !== aicost.scan[field]) differences.push(`scan.${field} ${dev.scan[field]} vs ${aicost.scan[field]}`);
  }
  const names = (report) => report.unpriced.map((model) => `${model.tool}/${model.model}`).sort().join();
  if (names(dev) !== names(aicost)) differences.push(`unpriced models differ: ${names(dev)} vs ${names(aicost)}`);
  return differences;
}

function main() {
  const aicost = option('--aicost', 'aicost');
  const dirs = [];
  for (const name of ['--claude-dir', '--codex-dir']) {
    const value = option(name);
    if (value) dirs.push(name, value);
  }
  const dev = path.join(__dirname, '..', 'dev');
  let failed = false;
  for (const group of GROUPS) {
    const mine = runJson(process.execPath, [dev, 'ai', 'report', '--by', group, '--json', '--dry-run', ...dirs]);
    const theirs = runJson(aicost, ['report', '--by', group, '--format', 'json', ...dirs]);
    const differences = compare(mine, theirs);
    console.log(`${group.padEnd(8)} ${differences.length === 0 ? 'IDENTICAL' : 'DIFF'}  (${mine.rows.length} rows, ${mine.total.requests} requests)`);
    for (const line of differences.slice(0, 10)) console.log(`  ${line}`);
    if (differences.length > 0) failed = true;
  }
  process.exitCode = failed ? 1 : 0;
}

main();
