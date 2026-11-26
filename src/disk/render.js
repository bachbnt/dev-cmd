// Copyright (c) 2026 bachbnt

const { formatBytes } = require('./size');

// Text tables for `dev disk` and `dev prune`.

const TIER_MARK = { safe: 'safe', review: 'review', blocked: 'info' };

// Aligns columns: the first (a size) to the right, the rest to the left.
function pad(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  return rows.map((row) => row.map((cell, column) => (column === 0 ? String(cell).padStart(widths[column]) : String(cell).padEnd(widths[column]))).join('  ').trimEnd());
}

function sizeText(item) {
  return `${item.bytesIsEstimate ? '~' : ''}${formatBytes(item.bytes)}`;
}

function describe(item) {
  return item.kind === 'project-artifact' ? `${item.project}/${item.artifact}` : item.name;
}

function itemTable(items, { showReasons = true } = {}) {
  if (items.length === 0) return '';
  const rows = items.map((item) => [sizeText(item), TIER_MARK[item.tier], describe(item), item.kind === 'project-artifact' ? `${item.ageDays ?? '?'}d` : '']);
  const lines = pad(rows);
  if (!showReasons) return lines.join('\n');
  return items.flatMap((item, index) => [lines[index], ...item.reasons.map((reason) => `    - ${reason}`)]).join('\n');
}

module.exports = { describe, formatBytes, itemTable, pad, sizeText };
