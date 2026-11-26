// Copyright (c) 2026 bachbnt

const { readJson, writeJsonAtomic } = require('../store/json-store');
const { addTokens, emptyTokens } = require('./model');
const { dayOf, isTimeGroup, weekStart } = require('./query');
const { emptyScan, newRow } = require('./report');

// A running record of usage per (day, tool, model), kept in ~/.devcmd/ai-daily.json. AI tools may
// delete old logs; the totals stay. Only numbers are stored: no project names, sessions or
// content. For each key the entry with the most requests wins, so a day whose log was later
// deleted is never overwritten by a smaller number.

const SNAPSHOT_VERSION = 1;

function emptySnapshot() {
  return { version: SNAPSHOT_VERSION, days: {} };
}

function loadSnapshot(file) {
  const data = readJson(file, { fallback: undefined });
  if (!data || data.version !== SNAPSHOT_VERSION || typeof data.days !== 'object' || data.days === null) return emptySnapshot();
  return data;
}

// Totals of the requests, keyed day -> tool -> model. `fromDay` leaves out earlier days: a scan
// that skipped old log files has only part of those days.
function aggregate(usages, prices, query, fromDay) {
  const days = {};
  for (const usage of usages) {
    const day = dayOf(query, usage);
    if (fromDay && day < fromDay) continue;
    const perTool = days[day] ??= {};
    const perModel = perTool[usage.tool] ??= {};
    const entry = perModel[usage.model] ??= {
      requests: 0, tokens: emptyTokens(), cost_usd: 0, priced: true, prices: prices.version,
    };
    entry.requests += 1;
    addTokens(entry.tokens, usage.tokens);
    const cost = prices.costOf(usage);
    if (cost === undefined) entry.priced = false;
    else entry.cost_usd += cost;
  }
  return days;
}

function shouldReplace(existing, incoming) {
  if (!existing) return true;
  if (incoming.requests !== existing.requests) return incoming.requests > existing.requests;
  // Same requests: take the new entry only if it gained a price the old one lacked.
  return !existing.priced && incoming.priced;
}

// Merges `days` into the snapshot. Returns how many entries were added or raised.
function mergeSnapshot(snapshot, days) {
  let changed = 0;
  for (const [day, perTool] of Object.entries(days)) {
    for (const [tool, perModel] of Object.entries(perTool)) {
      for (const [model, entry] of Object.entries(perModel)) {
        const target = ((snapshot.days[day] ??= {})[tool] ??= {});
        if (shouldReplace(target[model], entry)) {
          target[model] = entry;
          changed += 1;
        }
      }
    }
  }
  return changed;
}

function saveSnapshot(file, snapshot) {
  writeJsonAtomic(file, snapshot, { space: 0 });
}

const SNAPSHOT_GROUPS = ['day', 'week', 'month', 'model', 'tool'];

function snapshotKey(groupBy, item) {
  switch (groupBy) {
    case 'day': return item.day;
    case 'week': return weekStart(item.day);
    case 'month': return item.day.slice(0, 7);
    case 'model': return item.model;
    default: return item.tool;
  }
}

function addEntry(row, entry) {
  row.requests += entry.requests;
  addTokens(row.tokens, entry.tokens);
  row.cost_usd += entry.cost_usd;
  if (!entry.priced) row.has_unpriced = true;
}

// A report built from the snapshot, for logs that may be gone. Same shape as a live report, but
// only day, week, month, model and tool grouping exist: the snapshot keeps nothing else.
function snapshotReport(snapshot, query) {
  if (!SNAPSHOT_GROUPS.includes(query.groupBy)) {
    throw new Error(`History cannot be grouped by ${query.groupBy}. Use ${SNAPSHOT_GROUPS.join(', ')}.`);
  }
  const rows = new Map();
  const total = newRow('total');
  const lowerModels = query.models.map((needle) => needle.toLowerCase());
  for (const [day, perTool] of Object.entries(snapshot.days)) {
    if ((query.since && day < query.since) || (query.until && day > query.until)) continue;
    for (const [tool, perModel] of Object.entries(perTool)) {
      if (query.tools.length > 0 && !query.tools.includes(tool)) continue;
      for (const [model, entry] of Object.entries(perModel)) {
        if (lowerModels.length > 0 && !lowerModels.some((needle) => model.toLowerCase().includes(needle))) continue;
        const key = snapshotKey(query.groupBy, { day, tool, model });
        if (!rows.has(key)) rows.set(key, newRow(key));
        addEntry(rows.get(key), entry);
        addEntry(total, entry);
      }
    }
  }
  const sorted = [...rows.values()];
  if (isTimeGroup(query.groupBy)) sorted.sort((left, right) => (left.key < right.key ? -1 : 1));
  else sorted.sort((left, right) => right.cost_usd - left.cost_usd || (left.key < right.key ? -1 : 1));
  return {
    group_by: query.groupBy,
    since: query.since ?? null,
    until: query.until ?? null,
    rows: sorted,
    total,
    unpriced: [],
    scan: emptyScan(),
  };
}

module.exports = { aggregate, loadSnapshot, mergeSnapshot, saveSnapshot, snapshotReport };
