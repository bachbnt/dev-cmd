// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPaths } = require('../config/paths');
const { VERSION } = require('../config');
const { configValue, saveConfig } = require('../config/user');
const { AI_PERIODS } = require('../ai/constants');
const { budgetLines, budgetStatus, monthSpend, shortLine } = require('../ai/budget');
const { detectAnomaly, efficiency, topSessions } = require('../ai/analysis');
const machines = require('../ai/machines');
const { loadPriceTable, PriceTable } = require('../ai/pricing');
const {
  addDays, createQuery, currentOffsetMinutes, dayOfInstant, modifiedSince, parseDate,
} = require('../ai/query');
const render = require('../ai/render');
const { buildReport } = require('../ai/report');
const { scan } = require('../ai/scan');
const { writeShort } = require('../ai/short-cache');
const { describeSources } = require('../ai/sources');
const { projectName } = require('../ai/sources/shared');
const {
  aggregate, loadSnapshot, mergeSnapshot, saveSnapshot, snapshotReport,
} = require('../ai/snapshot');
const { spawnSyncProcess } = require('../runner/spawn');

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

function clientList(config) {
  return Object.entries(config?.aiClients || {}).map(([prefix, name]) => ({ prefix, name }));
}

function buildPlan(context) {
  const { options, positionals, config } = context;
  const period = positionals[0] || 'month';
  if (!AI_PERIODS.includes(period) || (period !== 'clients' && positionals.length > 1)) {
    throw new Error(`Usage: dev ai [${AI_PERIODS.join('|')}] [options]. Run dev help for the options.`);
  }
  const homeDir = context.homeDir || os.homedir();
  const now = context.now ? context.now() : new Date();
  const offsetMinutes = currentOffsetMinutes(now);
  const today = dayOfInstant(now.getTime(), offsetMinutes);
  const resolved = period === 'clients' ? { since: undefined, until: undefined, groupBy: 'day' } : resolvePeriod(period, options, today);

  const history = Boolean(options.history);
  const query = createQuery({
    since: resolved.since,
    until: resolved.until,
    groupBy: options.by || (history ? 'month' : resolved.groupBy),
    tools: options.aiTools?.length ? options.aiTools : (config?.aiTools || []),
    projects: [...(options.repos || []), ...(options.here ? [projectName(process.cwd())] : [])],
    models: options.models || [],
    clients: clientList(config),
    offsetMinutes,
  });
  return {
    period, homeDir, today, offsetMinutes, query, history, paths: getPaths(homeDir), budgetUsd: config?.aiBudget,
  };
}

function snapshotAllowed(options) {
  return !options.noSnapshot && !options.dryRun;
}

// Notes about the price table: it ages, and the person should know when it has.
function priceNotes(prices, config, today) {
  if (!prices.updated) return [];
  const days = Math.floor((Date.parse(today) - Date.parse(prices.updated)) / 86_400_000);
  const limit = configValue(config, 'aiPriceStaleDays');
  return days > limit ? [`Prices were last checked on ${prices.updated} (${days} days ago). Update DevCmd (dev update), or add current prices with --pricing <file>.`] : [];
}

function collectClients(context, plan) {
  const { options, positionals, config } = context;
  const [, action, ...rest] = positionals;
  const clients = { ...(config?.aiClients || {}) };
  if (!action || action === 'list') return { mode: 'clients', data: { clients }, exitCode: 0 };
  if (action === 'add') {
    if (rest.length !== 2) throw new Error('Usage: dev ai clients add <name> <folder>');
    const [name, folder] = rest;
    if (!name.trim() || name.length > 60) throw new Error('A client name is 1 to 60 characters.');
    clients[path.resolve(folder)] = name;
  } else if (action === 'remove') {
    if (rest.length !== 1) throw new Error('Usage: dev ai clients remove <name>');
    const before = Object.keys(clients).length;
    for (const [folder, name] of Object.entries(clients)) if (name === rest[0]) delete clients[folder];
    if (Object.keys(clients).length === before) throw new Error(`No client named "${rest[0]}".`);
  } else {
    throw new Error('Usage: dev ai clients [add <name> <folder> | remove <name>]');
  }
  if (!options.dryRun) saveConfig({ ...config, aiClients: clients }, { file: plan.paths.configFile });
  return { mode: 'clients', data: { clients, changed: true }, exitCode: 0 };
}

// Looks up the pull request of each branch with `gh` (network). A branch it cannot find stays blank.
function attachPullRequests(report, usages, spawnSync = spawnSyncProcess) {
  const where = new Map();
  for (const usage of usages) {
    if (usage.branch && usage.cwd && !where.has(usage.branch)) where.set(usage.branch, usage.cwd);
  }
  for (const row of report.rows.slice(0, 30)) {
    const cwd = where.get(row.key);
    if (!cwd || !fs.existsSync(cwd)) continue;
    const result = spawnSync('gh', ['pr', 'list', '--head', row.key, '--state', 'all', '--json', 'number,title', '--limit', '1'], { cwd, encoding: 'utf8' });
    if (result.error || result.status !== 0) continue;
    try {
      const [pull] = JSON.parse(result.stdout);
      if (pull) row.pr = { number: pull.number, title: pull.title };
    } catch {}
  }
}

function importSnapshot(context, plan) {
  const { options, config = {} } = context;
  const data = machines.validateImport(JSON.parse(fs.readFileSync(path.resolve(options.importSnapshot), 'utf8')));
  if (data.machine === config.aiMachine) {
    throw new Error('This file comes from this computer (same machine label); importing it would count everything twice.');
  }
  if (!options.dryRun) machines.saveImport(plan.homeDir, data);
  return { mode: 'import', data: { machine: data.machine, ...machines.summarize(data) }, exitCode: 0 };
}

function exportSnapshot(context, plan, snapshot, notes) {
  const { options, config = {} } = context;
  let label = config.aiMachine;
  if (!label) {
    label = machines.newLabel();
    if (!options.dryRun) saveConfig({ ...config, aiMachine: label }, { file: plan.paths.configFile });
  }
  const data = machines.exportSnapshot(snapshot, label);
  if (options.exportSnapshot !== '-' && !options.dryRun) fs.writeFileSync(path.resolve(options.exportSnapshot), `${JSON.stringify(data)}\n`);
  return {
    mode: 'export',
    data: options.exportSnapshot === '-' ? data : { machine: label, file: options.exportSnapshot, ...machines.summarize(snapshot) },
    exitCode: 0,
    notes,
  };
}

async function collectAi(context) {
  const { options, config = {} } = context;
  if (options.notify && !options.check) throw new Error('--notify works with --check: dev ai --check --notify');
  if (options.notify && options.json) throw new Error('--notify cannot be combined with --json.');
  const plan = buildPlan(context);
  const {
    homeDir, today, offsetMinutes, query, paths,
  } = plan;
  const enabled = config.aiTools || [];

  if (plan.period === 'clients') return collectClients(context, plan);

  if (options.showTools) {
    const sources = describeSources({
      homeDir, dirs: { claude: options.claudeDir, codex: options.codexDir }, roots: config.aiSourceRoots, enabled,
    });
    return { mode: 'tools', data: sources, exitCode: 0 };
  }

  const prices = loadPriceTable({ homeDir, extraFile: options.pricing ? path.resolve(options.pricing) : undefined });
  const builtIn = PriceTable.builtIn();
  if (options.showPrices) {
    const models = prices.entries.map((entry) => ({ match: entry.label, source: entry.source ?? null, ...entry.price }));
    return {
      mode: 'prices', data: { updated: builtIn.updated ?? null, stale: priceNotes(builtIn, config, today).length > 0, models }, exitCode: 0, prices,
    };
  }
  if (options.statuslineConfig) {
    return { mode: 'statusline', data: { statusLine: { type: 'command', command: 'dev ai --short' } }, exitCode: 0 };
  }
  if (options.importSnapshot) return importSnapshot(context, plan);

  const imported = machines.listImported(homeDir);
  const wantsBudget = plan.budgetUsd !== undefined || options.check || options.short || options.efficiency;
  const writeSnapshot = snapshotAllowed(options);
  const firstRun = writeSnapshot && !fs.existsSync(paths.aiDailyFile);
  const needsHistory = plan.history || options.machines || options.exportSnapshot;

  // How far back the logs must be read. Reading everything is slow only the first time (the scan
  // cache makes later runs read just the new bytes); the first run also backfills the history.
  let scanSince = needsHistory ? addDays(today, -7) : query.since;
  const monthStart = `${today.slice(0, 7)}-01`;
  if (wantsBudget && scanSince !== undefined) {
    // Budget needs the month, the anomaly check needs the two weeks before today.
    const earliest = [monthStart, addDays(today, -14)].sort()[0];
    if (earliest < scanSince) scanSince = earliest;
  }
  if (firstRun) scanSince = undefined;

  const { usages, stats } = await scan({
    homeDir,
    dirs: { claude: options.claudeDir, codex: options.codexDir },
    tools: wantsBudget ? enabled : query.tools,
    roots: config.aiSourceRoots,
    modifiedSince: scanSince ? modifiedSince({ since: scanSince, offsetMinutes }) : undefined,
    cacheFile: options.noCache ? undefined : paths.aiScanCacheFile,
    readOnlyCache: Boolean(options.dryRun),
  });
  // A tool you never installed is not worth a note, except Claude Code and Codex (the original pair)
  // or a tool you asked for by name.
  stats.missing = stats.missing.filter((tool) => (query.tools.length > 0 ? query.tools.includes(tool) : ['claude', 'codex'].includes(tool)));

  const notes = [...priceNotes(builtIn, config, today)];
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

  if (options.exportSnapshot) return exportSnapshot(context, plan, snapshot, notes);
  if (options.machines) {
    const rows = [
      { machine: config.aiMachine ?? '(this computer)', local: true, ...machines.summarize(snapshot) },
      ...imported.map((data) => ({ machine: data.machine, local: false, ...machines.summarize(data) })),
    ];
    return { mode: 'machines', data: { machines: rows }, notes, exitCode: 0 };
  }

  let budget;
  if (wantsBudget) {
    budget = budgetStatus(monthSpend(usages, prices, { today, offsetMinutes }), { today, budgetUsd: plan.budgetUsd });
    budget.anomaly = detectAnomaly(usages, prices, {
      today, offsetMinutes, factor: configValue(config, 'aiAnomalyFactor'), minUsd: configValue(config, 'aiAnomalyMinUsd'),
    });
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
  if (options.sessions) {
    return { mode: 'sessions', data: { sessions: topSessions(usages, prices, query, Number(options.sessions)) }, notes, exitCode: 0 };
  }
  if (options.efficiency) {
    return {
      mode: 'efficiency', data: efficiency(usages, prices, query, { planUsd: config.aiPlan, monthUsd: budget?.month_usd }), notes, exitCode: 0,
    };
  }

  let report;
  if (plan.history) {
    report = snapshotReport(machines.mergeMachines(snapshot, imported), query);
    if (imported.length > 0) notes.push(`Includes ${imported.length} imported computer(s): ${imported.map((data) => data.machine).join(', ')}.`);
  } else {
    report = buildReport(usages, prices, query, stats);
    if (options.pr && query.groupBy === 'branch') attachPullRequests(report, usages);
  }
  return {
    mode: plan.history ? 'history' : 'report', data: report, report, budget, notes, exitCode: 0,
  };
}

function table(headers, rows, rightFrom = 99) {
  const widths = headers.map((text, column) => Math.max(text.length, ...rows.map((row) => String(row[column]).length)));
  const format = (cells) => cells.map((cell, column) => (column >= rightFrom ? String(cell).padStart(widths[column]) : String(cell).padEnd(widths[column]))).join('  ').trimEnd();
  return `${[format(headers), ...rows.map(format)].join('\n')}\n`;
}

function showStatic(out, { mode, data, prices }) {
  if (mode === 'tools') {
    out.write(table(['Tool', 'Status', 'Verified', 'Billing', 'Logs'], data.map((source) => [
      source.label, source.enabled === false ? 'off (aiTools)' : (source.found ? 'found' : (source.reason ? 'no data' : 'not found')), source.maturity, source.billing, [source.dir, ...(source.extra || [])].filter(Boolean).join(' + ') || source.reason || '',
    ])));
  } else if (mode === 'prices') {
    out.write(`${render.pricesTable(prices)}\nUSD per 1,000,000 tokens. Prices last checked: ${data.updated ?? 'unknown'}${data.stale ? ' (older than aiPriceStaleDays)' : ''}.\n`);
  } else if (mode === 'statusline') {
    out.write(`Add this to ~/.claude/settings.json to show your cost in Claude Code's status line:\n\n${JSON.stringify(data, null, 2)}\n`);
  } else if (mode === 'clients') {
    const entries = Object.entries(data.clients);
    out.write(entries.length ? table(['Client', 'Folder'], entries.map(([folder, name]) => [name, folder])) : 'No clients. Add one: dev ai clients add <name> <folder>\n');
  } else if (mode === 'machines') {
    out.write(table(['Computer', 'Days', 'First', 'Last', 'Requests', 'Cost'], data.machines.map((row) => [
      `${row.machine}${row.local ? ' (this one)' : ''}`, row.days, row.first_day ?? '-', row.last_day ?? '-', row.requests, render.money(row.cost_usd),
    ]), 4));
  } else if (mode === 'import') {
    out.write(`Imported ${data.machine}: ${data.days} day(s), ${data.requests} requests, ${render.money(data.cost_usd)}. dev ai --history now includes it.\n`);
  }
}

// `dev ai --check --notify`: a system notification when the month is over budget or today is out
// of the ordinary. It runs once per call; scheduling the call (cron, launchd, Task Scheduler) is
// the user's choice, and nothing runs in the background.
function notifyBudget(context, data) {
  const over = data.budget_usd !== null && data.over;
  if (!over && !data.anomaly?.flagged) return;
  const send = context.notify || require('../runtime/execute').sendNotification;
  send(`AI cost: ${shortLine(data)}${anomalyText(data.anomaly)}`);
}

function anomalyText(anomaly) {
  if (!anomaly?.flagged) return '';
  return ` · ! ${render.money(anomaly.today_usd)} today is ${(anomaly.today_usd / anomaly.usual_usd).toFixed(1)}x your usual day`;
}

async function handleAi(context) {
  const { p, options } = context;
  const out = context.stdout || process.stdout;
  const err = context.stderr || process.stderr;
  const result = await collectAi(context);
  const { mode, data } = result;

  if (mode === 'export') {
    out.write(options.exportSnapshot === '-' ? `${JSON.stringify(data)}\n` : `Exported ${data.days} day(s) from ${data.machine} to ${data.file}. Import it elsewhere with: dev ai --import-snapshot <file>\n`);
    return 0;
  }
  if (['tools', 'prices', 'statusline', 'clients', 'machines', 'import'].includes(mode)) {
    if (options.format === 'json') out.write(`${JSON.stringify(data, null, 2)}\n`);
    else showStatic(out, result);
    return 0;
  }

  if (mode === 'budget') {
    const lines = options.short ? [] : budgetLines(data);
    const stdout = options.short
      ? `${shortLine(data)}${anomalyText(data.anomaly)}\n`
      : `${(lines.length ? lines : [shortLine(data)]).join('\n')}\n`;
    const stderr = result.notes.map((note) => `${note}\n`).join('');
    out.write(stdout);
    if (stderr) err.write(stderr);
    if (options.notify) notifyBudget(context, data);
    if (options.short && context.argv) {
      writeShort({
        argv: context.argv,
        homeDir: context.homeDir,
        now: context.now ? context.now().getTime() : Date.now(),
        version: VERSION,
        stdout,
        stderr,
        exitCode: result.exitCode,
      });
    }
    return result.exitCode;
  }
  if (mode === 'sessions' || mode === 'efficiency') {
    if (options.format === 'json') out.write(`${JSON.stringify(data, null, 2)}\n`);
    else if (mode === 'sessions') out.write(`${render.sessionsTable(data.sessions)}\n`);
    else for (const line of render.efficiencyLines(data)) out.write(`${line}\n`);
    return 0;
  }

  const { report } = result;
  const formats = {
    json: () => JSON.stringify(report, null, 2),
    csv: () => render.csv(report),
    md: () => render.markdown(report),
    html: () => render.html(report),
    openmetrics: () => render.openmetrics(report),
  };
  if (formats[options.format]) {
    out.write(`${formats[options.format]()}\n`);
    return 0;
  }

  if (report.rows.length > 0) out.write(`${render.table(report)}\n`);
  if (options.pr && report.rows.some((row) => row.pr)) {
    out.write(`${report.rows.filter((row) => row.pr).map((row) => `${row.key}: #${row.pr.number} ${row.pr.title}`).join('\n')}\n`);
  }
  const quiet = ['Cost is the API price', 'Daily totals', 'Includes '];
  for (const note of [...result.notes, ...render.notes(report, { verbose: options.verbose })]) {
    if (quiet.some((start) => note.startsWith(start))) p.log.info(note);
    else p.log.warn(note);
  }
  if (result.budget) {
    for (const line of budgetLines(result.budget)) p.log.info(line);
    if (result.budget.anomaly?.flagged) {
      const { today_usd: spent, usual_usd: usual, factor } = result.budget.anomaly;
      p.log.warn(`Today is ${render.money(spent)}, ${(spent / usual).toFixed(1)}x your usual ${render.money(usual)} (alert above ${factor}x).`);
    }
  }
  p.outro(mode === 'history' ? 'History from daily totals.' : 'Done.');
  return 0;
}

module.exports = { collectAi, handleAi, notifyBudget };
