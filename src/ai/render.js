// Copyright (c) 2026 bachbnt

const { cacheWrite, totalTokens } = require('./model');

// Showing a report: a table for people, CSV for scripts (JSON is the report object itself).

const HEADINGS = {
  day: 'Day', week: 'Week of', month: 'Month', project: 'Project', model: 'Model', tool: 'Tool', session: 'Session', branch: 'Branch', client: 'Client',
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

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function markdown(report) {
  const header = [HEADINGS[report.group_by] ?? 'Key', 'Requests', 'Input', 'Output', 'Cache read', 'Cache write', 'Total', 'Cost'];
  const rows = [...report.rows.map((row) => [row.key, ...numbers(row)]), ['**Total**', ...numbers(report.total).map((cell) => `**${cell}**`)]];
  const escape = (cell) => String(cell).replace(/\|/g, '\\|');
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map((_, column) => (column === 0 ? '---' : '---:')).join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n');
}

// One self-contained page: no scripts, no external files, so it can be mailed or archived.
function html(report, { title = 'AI cost report' } = {}) {
  const header = [HEADINGS[report.group_by] ?? 'Key', 'Requests', 'Input', 'Output', 'Cache read', 'Cache write', 'Total', 'Cost'];
  const row = (cells, tag = 'td') => `<tr>${cells.map((cell, column) => `<${tag}${column > 0 ? ' class="n"' : ''}>${escapeHtml(cell)}</${tag}>`).join('')}</tr>`;
  const body = [...report.rows.map((entry) => [entry.key, ...numbers(entry)]), ['Total', ...numbers(report.total)]];
  const period = report.since || report.until ? `${report.since ?? '…'} to ${report.until ?? 'today'}` : 'all time';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem}
table{border-collapse:collapse;width:100%}th,td{padding:.35rem .6rem;border-bottom:1px solid #8884}th{text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{font-weight:600}p{opacity:.75}</style></head><body>
<h1>${escapeHtml(title)}</h1><p>Period: ${escapeHtml(period)}. Grouped by ${escapeHtml(report.group_by)}. Cost is the API price of this usage; on a subscription plan it is not what you pay.</p>
<table><thead>${row(header, 'th')}</thead><tbody>${body.map((cells) => row(cells)).join('')}</tbody></table>
</body></html>`;
}

// Prometheus/OpenMetrics text: one gauge per number, labelled with the group key.
function openmetrics(report) {
  const label = (key) => `{${report.group_by}="${String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"}`;
  const metrics = [
    ['devcmd_ai_requests', 'Requests', (row) => row.requests],
    ['devcmd_ai_cost_usd', 'Cost in USD at API prices', (row) => row.cost_usd],
    ['devcmd_ai_tokens_input', 'Input tokens', (row) => row.tokens.input],
    ['devcmd_ai_tokens_output', 'Output tokens', (row) => row.tokens.output],
    ['devcmd_ai_tokens_cache_read', 'Cache read tokens', (row) => row.tokens.cache_read],
    ['devcmd_ai_tokens_cache_write', 'Cache write tokens', (row) => cacheWrite(row.tokens)],
  ];
  const lines = [];
  for (const [name, help, value] of metrics) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
    for (const row of report.rows) lines.push(`${name}${label(row.key)} ${value(row)}`);
  }
  lines.push('# EOF');
  return lines.join('\n');
}

function sessionsTable(rows) {
  const header = ['Session', 'Tool', 'Project', 'Branch', 'Requests', 'Total', 'Cost', 'Last active'];
  const body = rows.map((row) => [row.session, row.tool, row.project, row.branch || '-', String(row.requests), compact(totalTokens(row.tokens)), money(row.cost_usd, row.has_unpriced), row.last.slice(0, 16).replace('T', ' ')]);
  const widths = header.map((text, column) => Math.max(text.length, ...body.map((cells) => cells[column].length)));
  const format = (cells) => cells.map((cell, column) => ([4, 5, 6].includes(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column]))).join('  ').trimEnd();
  return [format(header), ...body.map(format)].join('\n');
}

function efficiencyLines(data) {
  const percent = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
  const lines = [
    `Cache hit ratio: ${percent(data.cache_hit_ratio)} of input-side tokens came from the cache.`,
    `Sub-agent share of cost: ${percent(data.sub_agent_share)}.`,
  ];
  for (const model of data.models.slice(0, 8)) lines.push(`  ${model.percent.toFixed(1).padStart(5)}%  ${money(model.cost_usd)}  ${model.model}`);
  if (data.plan) {
    const { plan_usd: plan, api_usd_this_month: api, ratio } = data.plan;
    lines.push(api === null ? `Plan: ${money(plan)} a month.` : `Plan ${money(plan)} a month; this month's usage at API prices is ${money(api)}${ratio === null ? '' : ` (${ratio.toFixed(1)}x the plan)`}.`);
  }
  lines.push(data.note);
  return lines;
}

function pricesTable(table) {
  const header = ['Model', 'Input', 'Output', 'Cache read', 'Cache write 5m', 'Cache write 1h'];
  const body = table.entries.map((entry) => [entry.label, ...['input', 'output', 'cache_read', 'cache_write_5m', 'cache_write_1h'].map((field) => entry.price[field].toFixed(2))]);
  const widths = header.map((text, column) => Math.max(text.length, ...body.map((cells) => cells[column].length)));
  const format = (cells) => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ');
  return [format(header), ...body.map(format)].join('\n');
}

module.exports = {
  compact, csv, efficiencyLines, html, markdown, money, notes, openmetrics, pricesTable, sessionsTable, table,
};
