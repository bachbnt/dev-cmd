// Copyright (c) 2026 bachbnt

const { cacheWrite, totalTokens } = require('./model');

// Showing a report: a table for people, CSV for scripts (JSON is the report object itself).

const HEADINGS = {
  day: 'Day', week: 'Week of', month: 'Month', project: 'Project', model: 'Model', tool: 'Tool', session: 'Session',
};

function compact(count) {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1e3).toFixed(1)}K`;
  if (count < 1_000_000_000) return `${(count / 1e6).toFixed(1)}M`;
  return `${(count / 1e9).toFixed(1)}B`;
}

// Dollars rounded to cents with thousands separators. `partial` marks a total that leaves out
// models without a price; a total with nothing priced is "n/a", never $0.00.
function money(usd, partial = false) {
  const mark = partial ? '*' : '';
  if (partial && usd <= 0) return 'n/a';
  if (usd > 0 && usd < 0.01) return `<$0.01${mark}`;
  const [whole, fraction] = usd.toFixed(2).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}${mark}`;
}

function numbers(row) {
  return [
    String(row.requests),
    compact(row.tokens.input),
    compact(row.tokens.output),
    compact(row.tokens.cache_read),
    compact(cacheWrite(row.tokens)),
    compact(totalTokens(row.tokens)),
    money(row.cost_usd, row.has_unpriced),
  ];
}

function table(report) {
  const header = [HEADINGS[report.group_by] ?? 'Key', 'Requests', 'Input', 'Output', 'Cache read', 'Cache write', 'Total', 'Cost'];
  const body = [...report.rows.map((row) => [row.key, ...numbers(row)]), ['Total', ...numbers(report.total)]];
  const widths = header.map((text, column) => Math.max(text.length, ...body.map((row) => row[column].length)));
  const line = (char) => `+${char.repeat(widths.reduce((sum, width) => sum + width + 3, 0) - 1)}+`;
  const format = (cells) => `| ${cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('   ')} |`;
  return [line('-'), format(header), line('='), ...body.map(format), line('-')].join('\n');
}

function csvField(text) {
  return /[,"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(report) {
  const lines = ['key,requests,input,output,cache_read,cache_write,total_tokens,cost_usd,has_unpriced'];
  for (const row of [...report.rows, report.total]) {
    lines.push([
      csvField(row.key), row.requests, row.tokens.input, row.tokens.output, row.tokens.cache_read,
      cacheWrite(row.tokens), totalTokens(row.tokens), row.cost_usd.toFixed(6), row.has_unpriced,
    ].join(','));
  }
  return lines.join('\n');
}

// Messages for people about what the scan could not do. Scripts that asked for JSON never see them.
function notes(report, { verbose = false } = {}) {
  const result = [];
  const { scan } = report;
  for (const tool of scan.missing) result.push(`No ${tool} logs found on this computer; skipped.`);
  if (report.rows.length === 0) result.push('No usage found for this period and these filters.');
  if (report.unpriced.length > 0) {
    const list = report.unpriced.map((model) => `${model.model} (${compact(totalTokens(model.tokens))} tokens, ${model.requests} requests)`);
    result.push(`* No price for: ${list.join(', ')}. Their tokens are counted, their cost is not. Add them to ~/.config/aicost/pricing.toml.`);
  }
  if (scan.skipped_lines > 0) result.push(`${scan.skipped_lines} log lines could not be read and were skipped.`);
  for (const problem of scan.unreadable) result.push(`Could not read ${problem}`);
  if (verbose) result.push(`Read ${scan.files} files: ${scan.requests} requests kept, ${scan.duplicates} duplicates ignored.`);
  if (report.rows.length > 0) result.push('Cost is the API price of this usage. On a subscription plan it is not what you pay.');
  return result;
}

module.exports = { compact, csv, money, notes, table };
