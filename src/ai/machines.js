// Copyright (c) 2026 bachbnt

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getPaths } = require('../config/paths');
const { readJson, writeJsonAtomic } = require('../store/json-store');
const { addTokens, emptyTokens } = require('./model');

// Daily totals from several computers. Each machine exports its `ai-daily.json` totals under a
// label; another machine imports the file and `dev ai --history` then sums them. The file holds
// numbers only (the same as the local daily totals): no paths, projects, sessions or client names.
// The label is a random id unless you set `aiMachine`, never the computer's name.

const KIND = 'devcmd-ai-snapshot';
const LABEL = /^[A-Za-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_FIELDS = ['input', 'output', 'cache_read', 'cache_write_5m', 'cache_write_1h'];

function newLabel() {
  return `m-${crypto.randomBytes(4).toString('hex')}`;
}

function exportSnapshot(snapshot, label) {
  return {
    kind: KIND, version: 1, machine: label, exportedAt: new Date().toISOString(), days: snapshot.days,
  };
}

function isCount(value) {
  return Number.isFinite(value) && value >= 0;
}

// Throws a message about the first thing wrong; returns the validated snapshot.
function validateImport(data) {
  const fail = (message) => { throw new Error(`Not a DevCmd AI snapshot: ${message}`); };
  if (!data || data.kind !== KIND || data.version !== 1) fail('wrong kind or version');
  if (typeof data.machine !== 'string' || !LABEL.test(data.machine)) fail('the machine label is missing or not 1 to 40 letters, digits, dashes or underscores');
  if (!data.days || typeof data.days !== 'object' || Array.isArray(data.days)) fail('days is missing');
  for (const [day, perTool] of Object.entries(data.days)) {
    if (!DAY.test(day)) fail(`"${day}" is not a date`);
    if (!perTool || typeof perTool !== 'object') fail(`${day} is not an object`);
    for (const [tool, perModel] of Object.entries(perTool)) {
      if (tool.length > 60 || !perModel || typeof perModel !== 'object') fail(`${day}/${tool} is not valid`);
      for (const [model, entry] of Object.entries(perModel)) {
        if (model.length > 200 || !entry || typeof entry !== 'object') fail(`${day}/${tool}/${model} is not valid`);
        if (!isCount(entry.requests) || !isCount(entry.cost_usd) || typeof entry.priced !== 'boolean') fail(`${day}/${tool}/${model}: bad numbers`);
        if (!entry.tokens || !TOKEN_FIELDS.every((field) => isCount(entry.tokens[field]))) fail(`${day}/${tool}/${model}: bad tokens`);
      }
    }
  }
  return data;
}

function importedFile(homeDir, label) {
  return path.join(getPaths(homeDir).aiImportedDir, `${label}.json`);
}

function saveImport(homeDir, data) {
  writeJsonAtomic(importedFile(homeDir, data.machine), data, { space: 0 });
}

function listImported(homeDir) {
  const directory = getPaths(homeDir).aiImportedDir;
  let names = [];
  try {
    names = fs.readdirSync(directory).filter((name) => name.endsWith('.json'));
  } catch {}
  const machines = [];
  for (const name of names.sort()) {
    const data = readJson(path.join(directory, name), { fallback: undefined });
    try {
      machines.push(validateImport(data));
    } catch {}
  }
  return machines;
}

// Local totals plus every imported machine, summed per (day, tool, model).
function mergeMachines(local, imported) {
  const merged = { version: 1, days: {} };
  for (const source of [local, ...imported]) {
    for (const [day, perTool] of Object.entries(source.days)) {
      for (const [tool, perModel] of Object.entries(perTool)) {
        for (const [model, entry] of Object.entries(perModel)) {
          const target = ((merged.days[day] ??= {})[tool] ??= {});
          const into = target[model] ??= {
            requests: 0, tokens: emptyTokens(), cost_usd: 0, priced: true,
          };
          into.requests += entry.requests;
          addTokens(into.tokens, entry.tokens);
          into.cost_usd += entry.cost_usd;
          if (!entry.priced) into.priced = false;
        }
      }
    }
  }
  return merged;
}

function summarize(snapshot) {
  const days = Object.keys(snapshot.days).sort();
  let costUsd = 0;
  let requests = 0;
  for (const perTool of Object.values(snapshot.days)) {
    for (const perModel of Object.values(perTool)) {
      for (const entry of Object.values(perModel)) {
        costUsd += entry.cost_usd;
        requests += entry.requests;
      }
    }
  }
  return {
    first_day: days[0] ?? null, last_day: days[days.length - 1] ?? null, days: days.length, requests, cost_usd: costUsd,
  };
}

module.exports = {
  exportSnapshot, importedFile, listImported, mergeMachines, newLabel, saveImport, summarize, validateImport,
};
