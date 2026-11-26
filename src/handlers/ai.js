// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPaths } = require('../config/paths');
const { AI_PERIODS } = require('../ai/constants');
const { budgetLines, budgetStatus, monthSpend, shortLine } = require('../ai/budget');
const { loadPriceTable } = require('../ai/pricing');
const {
  addDays, createQuery, currentOffsetMinutes, dayOfInstant, modifiedSince, parseDate,
} = require('../ai/query');
const render = require('../ai/render');
const { buildReport } = require('../ai/report');
const { scan } = require('../ai/scan');
const { describeSources } = require('../ai/sources');
const {
  aggregate, loadSnapshot, mergeSnapshot, saveSnapshot, snapshotReport,
} = require('../ai/snapshot');

// `dev ai`: what the AI coding tools on this computer cost, worked out from their own logs.
// `collectAi` gathers data (and updates the daily history); `handleAi` shows it. `--json` prints
// what `collectAi` returns, so both paths share one code path.

function resolvePeriod(period, options, today) {
  if ((options.since || options.until) && period !== 'report' && !options.history) {
    throw new Error('--since and --until are only valid with `dev ai report` or --history.');
  }
  if (period === 'today') return { since: today, until: undefined, groupBy: 'project' };
  if (period === 'week') return { since: parseDate('7d', today), until: undefined, groupBy: 'day' };
  if (period === 'month') return { since: `${today.slice(0, 7)}-01`, until: undefined, groupBy: 'day' };
  return {
    since: options.since ? parseDate(options.since, today) : undefined,
    until: options.until ? parseDate(options.until, today) : undefined,
    groupBy: 'day',
  };
}

function buildPlan(context) {
  const { options, positionals, config } = context;
  const period = positionals[0] || 'month';
  if (!AI_PERIODS.includes(period) || positionals.length > 1) {
    throw new Error(`Usage: dev ai [${AI_PERIODS.join('|')}] [options]. Run dev help for the options.`);
  }
  const homeDir = context.homeDir || os.homedir();
  const now = context.now ? context.now() : new Date();
  const offsetMinutes = currentOffsetMinutes(now);
  const today = dayOfInstant(now.getTime(), offsetMinutes);
  const resolved = resolvePeriod(period, options, today);

  const history = Boolean(options.history);
  const query = createQuery({
    since: resolved.since,
    until: resolved.until,
    groupBy: options.by || (history ? 'month' : resolved.groupBy),
    tools: options.aiTools || [],
    projects: options.repos || [],
    models: options.models || [],
    offsetMinutes,
  });
  return {
    period, homeDir, today, offsetMinutes, query, history, paths: getPaths(homeDir), budgetUsd: config?.aiBudget,
  };
}

function snapshotAllowed(options) {
  return !options.noSnapshot && !options.dryRun;
}

async function collectAi(context) {
  const { options } = context;
  const plan = buildPlan(context);
  const {
    homeDir, today, offsetMinutes, query, paths,
  } = plan;

  if (options.showTools) {
    const sources = describeSources({
      homeDir, dirs: { claude: options.claudeDir, codex: options.codexDir },
    });
    return { mode: 'tools', data: sources, exitCode: 0 };
  }

  const wantsBudget = plan.budgetUsd !== undefined || options.check || options.short;
  const writeSnapshot = snapshotAllowed(options);
  const firstRun = writeSnapshot && !fs.existsSync(paths.aiDailyFile);

  // How far back the logs must be read. Reading everything is slow only the first time (the scan
  // cache makes later runs read just the new bytes); the first run also backfills the history.
  let scanSince = plan.history ? addDays(today, -7) : query.since;
  const monthStart = `${today.slice(0, 7)}-01`;
  if (wantsBudget && scanSince !== undefined && monthStart < scanSince) scanSince = monthStart;
  if (firstRun) scanSince = undefined;

  const prices = loadPriceTable({
    homeDir, extraFile: options.pricing ? path.resolve(options.pricing) : undefined,
  });
  const { usages, stats } = await scan({
    homeDir,
    dirs: { claude: options.claudeDir, codex: options.codexDir },
    tools: wantsBudget ? [] : query.tools,
    modifiedSince: scanSince ? modifiedSince({ since: scanSince, offsetMinutes }) : undefined,
    cacheFile: options.noCache ? undefined : paths.aiScanCacheFile,
    readOnlyCache: Boolean(options.dryRun),
  });
  if (query.tools.length > 0) stats.missing = stats.missing.filter((tool) => query.tools.includes(tool));

  const notes = [];
  const snapshot = loadSnapshot(paths.aiDailyFile);
  const changed = mergeSnapshot(snapshot, aggregate(usages, prices, { offsetMinutes }, scanSince));
  if (writeSnapshot && (changed > 0 || firstRun)) {
    try {
      saveSnapshot(paths.aiDailyFile, snapshot);
      if (firstRun) notes.push(`Daily totals are kept in ${paths.aiDailyFile}, so history survives when a tool deletes its logs.`);
    } catch (error) {
      notes.push(`Could not save daily history: ${error.message}`);
    }
  }

  let budget;
  if (wantsBudget) {
    budget = budgetStatus(monthSpend(usages, prices, { today, offsetMinutes }), { today, budgetUsd: plan.budgetUsd });
  }

  if (options.check || options.short) {
    let exitCode = 0;
    if (options.check) {
      if (plan.budgetUsd === undefined) {
        notes.push('No budget is set. Run: dev config set aiBudget <usd per month>');
        exitCode = 2;
      } else if (budget.over) {
        exitCode = 1;
      }
    }
    return {
      mode: 'budget', data: budget, budget, notes, exitCode,
    };
  }

  const report = plan.history ? snapshotReport(snapshot, query) : buildReport(usages, prices, query, stats);
  return {
    mode: plan.history ? 'history' : 'report', data: report, report, budget, notes, exitCode: 0,
  };
}

function showSources(out, sources) {
  const rows = sources.map((source) => [source.label, source.found ? 'found' : 'not found', source.maturity, source.billing, source.dir]);
  const header = ['Tool', 'Status', 'Verified', 'Billing', 'Logs'];
  const widths = header.map((text, column) => Math.max(text.length, ...rows.map((row) => row[column].length)));
  const format = (cells) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd();
  out.write(`${[format(header), ...rows.map(format)].join('\n')}\n`);
}

async function handleAi(context) {
  const { p, options } = context;
  const out = context.stdout || process.stdout;
  const result = await collectAi(context);

  if (result.mode === 'tools') {
    showSources(out, result.data);
    return 0;
  }

  if (result.mode === 'budget') {
    if (options.short) out.write(`${shortLine(result.budget)}\n`);
    else {
      for (const line of budgetLines(result.budget).length ? budgetLines(result.budget) : [shortLine(result.budget)]) out.write(`${line}\n`);
    }
    for (const note of result.notes) (context.stderr || process.stderr).write(`${note}\n`);
    return result.exitCode;
  }

  const { report } = result;
  if (options.format === 'json') {
    out.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  if (options.format === 'csv') {
    out.write(`${render.csv(report)}\n`);
    return 0;
  }

  if (report.rows.length > 0) out.write(`${render.table(report)}\n`);
  for (const note of [...result.notes, ...render.notes(report, { verbose: options.verbose })]) {
    if (note.startsWith('Cost is the API price') || note.startsWith('Daily totals')) p.log.info(note);
    else p.log.warn(note);
  }
  if (result.budget) for (const line of budgetLines(result.budget)) p.log.info(line);
  p.outro(result.mode === 'history' ? 'History from daily totals.' : 'Done.');
  return 0;
}

module.exports = { collectAi, handleAi };
