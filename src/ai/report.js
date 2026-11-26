// Copyright (c) 2026 bachbnt

const { addTokens, emptyTokens, totalTokens } = require('./model');
const { dayOf, groupKey, isTimeGroup, matches } = require('./query');

// The result of a query: rows of tokens and cost, plain data that serializes to the same JSON as
// `aicost --format json` (snake_case keys), so scripts can read either.

function newRow(key) {
  return { key, requests: 0, tokens: emptyTokens(), cost_usd: 0, has_unpriced: false };
}

function addToRow(row, usage, cost) {
  row.requests += 1;
  addTokens(row.tokens, usage.tokens);
  if (cost === undefined) row.has_unpriced = true;
  else row.cost_usd += cost;
}

function compareText(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function emptyScan() {
  return { files: 0, requests: 0, duplicates: 0, skipped_lines: 0, missing: [], unreadable: [] };
}

function buildReport(usages, prices, query, scan = emptyScan()) {
  const rows = new Map();
  const unpriced = new Map();
  const total = newRow('total');

  for (const usage of usages) {
    const day = dayOf(query, usage);
    if (!matches(query, usage, day)) continue;
    const cost = prices.costOf(usage);
    const key = groupKey(query, usage, day);
    if (!rows.has(key)) rows.set(key, newRow(key));
    addToRow(rows.get(key), usage, cost);
    addToRow(total, usage, cost);
    if (cost === undefined) {
      const missingKey = `${usage.tool}\u0000${usage.model}`;
      if (!unpriced.has(missingKey)) {
        unpriced.set(missingKey, { tool: usage.tool, model: usage.model, requests: 0, tokens: emptyTokens() });
      }
      const missing = unpriced.get(missingKey);
      missing.requests += 1;
      addTokens(missing.tokens, usage.tokens);
    }
  }

  const sortedRows = [...rows.values()];
  if (isTimeGroup(query.groupBy)) {
    sortedRows.sort((left, right) => compareText(left.key, right.key));
  } else {
    sortedRows.sort((left, right) => (
      right.cost_usd - left.cost_usd
      || totalTokens(right.tokens) - totalTokens(left.tokens)
      || compareText(left.key, right.key)
    ));
  }
  const sortedUnpriced = [...unpriced.values()].sort((left, right) => (
    totalTokens(right.tokens) - totalTokens(left.tokens) || compareText(left.model, right.model)
  ));

  return {
    group_by: query.groupBy,
    since: query.since ?? null,
    until: query.until ?? null,
    rows: sortedRows,
    total,
    unpriced: sortedUnpriced,
    scan,
  };
}

module.exports = { buildReport, emptyScan, newRow };
