// Copyright (c) 2026 bachbnt

const os = require('os');
const path = require('path');
const { dayOfInstant, currentOffsetMinutes } = require('../ai/query');
const { itemTable, sizeText } = require('../disk/render');
const { scanAll } = require('../disk/scan');
const {
  findLargeFiles, formatBytes, measureChildren, parseSize,
} = require('../disk/size');
const { scanToolVersions } = require('../disk/tools');
const { loadTrend, recordTrend, trendRows } = require('../disk/trend');
const { protectedReason } = require('../disk/safety');

// `dev disk`: read-only. It measures and reports; it never deletes (that is `dev prune`).
// `collectDisk` gathers data for every mode so `--json` and the text view share one path.

const STALE_DAYS = 90;
const DAY_MS = 86_400_000;

function settings(context) {
  const { options } = context;
  const homeDir = context.homeDir || os.homedir();
  const now = context.now ? context.now() : new Date();
  return {
    homeDir,
    now,
    today: dayOfInstant(now.getTime(), currentOffsetMinutes(now)),
    roots: (options.roots || []).map((root) => path.resolve(root)),
    olderThanDays: options.olderThan ? Number(options.olderThan) : 30,
  };
}

function totalsByGroup(items) {
  const sum = (predicate) => items.filter(predicate).reduce((total, item) => total + item.bytes, 0);
  const project = sum((item) => item.kind === 'project-artifact');
  const cache = sum((item) => ['global-cache', 'simulator-runtime', 'browser-cache'].includes(item.kind));
  const info = sum((item) => item.kind === 'info');
  return {
    project, cache, info, total: project + cache + info, reclaimable: sum((item) => item.tier === 'safe'),
  };
}

function staleProjects(items, olderThanDays) {
  const limit = Math.max(olderThanDays, STALE_DAYS);
  const byProject = new Map();
  for (const item of items.filter((entry) => entry.kind === 'project-artifact' && entry.ageDays !== null && entry.ageDays >= limit)) {
    const entry = byProject.get(item.projectRoot) || { project: item.project, path: item.projectRoot, ageDays: item.ageDays, bytes: 0 };
    entry.bytes += item.bytes;
    byProject.set(item.projectRoot, entry);
  }
  return [...byProject.values()].sort((left, right) => right.bytes - left.bytes);
}

async function collectDisk(context) {
  const { options } = context;
  const config = settings(context);

  if (options.large) {
    const minBytes = parseSize(options.minSize || '500MB');
    const roots = config.roots.length > 0 ? config.roots : [process.cwd()];
    const files = await findLargeFiles(roots, { minBytes });
    return { mode: 'large', data: { minBytes, roots, files }, exitCode: 0 };
  }

  if (options.trend) {
    return { mode: 'trend', data: { days: trendRows(loadTrend(config.homeDir)) }, exitCode: 0 };
  }

  if (options.top) {
    if (options.json) throw new Error('--top is interactive and cannot be combined with --json.');
    return { mode: 'top', data: undefined, exitCode: 0 };
  }

  const result = await scanAll({
    homeDir: config.homeDir, roots: config.roots, olderThanDays: config.olderThanDays, now: config.now.getTime(),
  });
  const projectRoots = [...new Set(result.items.filter((item) => item.kind === 'project-artifact').map((item) => item.projectRoot))];
  const data = {
    ...result,
    stale: staleProjects(result.items, config.olderThanDays),
    toolVersions: await scanToolVersions({ homeDir: config.homeDir, projectRoots }),
  };
  const totals = totalsByGroup(result.items);
  if (!options.dryRun && !options.json) {
    try {
      recordTrend(config.homeDir, config.today, totals);
    } catch {}
  }
  let exitCode = 0;
  if (options.check) {
    if (!options.threshold) throw new Error('--check needs --threshold <size>, for example --threshold 50GB.');
    const limit = parseSize(options.threshold);
    data.threshold = { bytes: limit, exceeded: result.totals.bytes > limit };
    exitCode = data.threshold.exceeded ? 1 : 0;
  }
  return { mode: 'report', data, exitCode };
}

function showReport(p, data) {
  const groups = [
    ['Project folders', data.items.filter((item) => item.kind === 'project-artifact')],
    ['Tool caches and browsers', data.items.filter((item) => ['global-cache', 'simulator-runtime', 'browser-cache'].includes(item.kind) && item.bytes > 0)],
    ['Other (shown only)', data.items.filter((item) => item.kind === 'info' && item.bytes > 0)],
  ];
  for (const [title, items] of groups) {
    if (items.length > 0) p.note(itemTable(items.slice(0, 25)), `${title}: ${formatBytes(items.reduce((sum, item) => sum + item.bytes, 0))}`);
  }
  if (data.stale.length > 0) {
    p.note(data.stale.slice(0, 10).map((project) => `${formatBytes(project.bytes).padStart(9)}  ${project.project}  (${project.ageDays} days)  ${project.path}`).join('\n'), `Projects not touched for ${STALE_DAYS}+ days (never deleted)`);
  }
  const unused = data.toolVersions.filter((version) => !version.inUse);
  if (unused.length > 0) {
    p.note(unused.map((version) => `${formatBytes(version.bytes).padStart(9)}  ${version.tool} ${version.version} (${version.manager})`).join('\n'), 'Node versions no known project asks for (shown only)');
  }
  p.log.info(`${data.projectCount} project(s) scanned. Can be freed safely: ${formatBytes(data.totals.reclaimableBytes)} of ${formatBytes(data.totals.bytes)}. Sizes with ~ may free less (shared files).`);
  if (data.recentLimited) p.log.warn('Only the 50 most recent projects were scanned. Use --root <folder> to search a folder.');
}

async function browse(context) {
  const { p } = context;
  const config = settings(context);
  let current = config.roots[0] || config.homeDir;
  const visited = [];
  for (;;) {
    const spin = p.spinner();
    spin.start(`Measuring ${current}`);
    const { entries, error } = await measureChildren(current);
    spin.stop(error ? `Cannot read ${current} (${error})` : `${current}: ${formatBytes(entries.reduce((sum, entry) => sum + entry.bytes, 0))}`);
    const choices = [
      ...(visited.length > 0 ? [{ value: '..', label: 'Back' }] : []),
      ...entries.slice(0, 30).map((entry) => ({
        value: entry.path,
        label: `${formatBytes(entry.bytes).padStart(9)}  ${entry.name}${entry.directory ? '/' : ''}${entry.unreadable ? '  (some parts unreadable)' : ''}`,
      })),
      { value: '.quit', label: 'Quit' },
    ];
    const choice = await p.select({ message: 'Open a folder (read only)', options: choices });
    if (p.isCancel(choice) || choice === '.quit') return;
    if (choice === '..') {
      current = visited.pop();
      continue;
    }
    const entry = entries.find((candidate) => candidate.path === choice);
    if (entry?.directory && !entry.symlink) {
      visited.push(current);
      current = entry.path;
    } else {
      const action = await p.select({
        message: entry.path,
        options: [
          { value: 'path', label: 'Show the full path' },
          { value: 'trash', label: 'Move to the Trash (asks again)' },
          { value: 'back', label: 'Back' },
        ],
      });
      if (action === 'path') p.log.info(entry.path);
      if (action === 'trash') await trashEntry(context, entry);
    }
  }
}

async function trashEntry(context, entry) {
  const { p } = context;
  const denied = protectedReason(entry.path, { homeDir: context.homeDir || os.homedir() });
  if (denied) {
    p.log.error(`Refused: ${denied}.`);
    return;
  }
  const sure = await p.confirm({ message: `Move ${entry.path} (${formatBytes(entry.bytes)}) to the Trash?`, initialValue: false });
  if (p.isCancel(sure) || !sure) return;
  const { pruneItems } = require('../disk/prune');
  const [result] = await pruneItems([{
    id: entry.path, kind: 'app-cache', path: entry.path, bytes: entry.bytes, tier: 'review', reasons: [],
  }], {
    homeDir: context.homeDir || os.homedir(), allowReview: true,
  });
  if (result.status === 'removed') p.log.success(`Moved to the Trash: ${entry.path}`);
  else p.log.error(`Not removed: ${result.reason}`);
}

function showLarge(p, data) {
  if (data.files.length === 0) {
    p.log.info(`No file of ${formatBytes(data.minBytes)} or more under ${data.roots.join(', ')}.`);
    return;
  }
  p.note(data.files.map((file) => `${formatBytes(file.bytes).padStart(9)}  ${file.path}`).join('\n'), `Files of ${formatBytes(data.minBytes)} or more`);
}

function showTrend(p, data) {
  if (data.days.length === 0) {
    p.log.info('No history yet. Run dev disk on a few days, then --trend shows what grew.');
    return;
  }
  p.note(data.days.map((day) => {
    const change = day.change === null ? '' : `${day.change >= 0 ? '+' : '-'}${formatBytes(Math.abs(day.change))}`;
    return `${day.day}  ${formatBytes(day.total).padStart(9)}  ${change.padStart(10)}   projects ${formatBytes(day.project)}, caches ${formatBytes(day.cache)}`;
  }).join('\n'), 'Disk use by day (what dev disk measured)');
}

async function handleDisk(context) {
  const { p, options } = context;
  if (options.top) {
    if (!process.stdout.isTTY) throw new Error('--top needs an interactive terminal.');
    await browse(context);
    p.outro('Done.');
    return 0;
  }
  const spin = options.large || options.trend ? undefined : p.spinner();
  spin?.start('Measuring project folders and caches');
  const result = await collectDisk(context);
  spin?.stop('Done measuring');
  if (result.mode === 'large') showLarge(p, result.data);
  else if (result.mode === 'trend') showTrend(p, result.data);
  else {
    showReport(p, result.data);
    if (result.data.threshold) {
      p.log[result.data.threshold.exceeded ? 'error' : 'info'](`Total ${sizeText({ bytes: result.data.totals.bytes })} is ${result.data.threshold.exceeded ? 'over' : 'within'} the ${formatBytes(result.data.threshold.bytes)} threshold.`);
    }
  }
  p.outro(result.mode === 'report' ? 'Nothing was deleted. Clean with: dev prune' : 'Done.');
  return result.exitCode;
}

module.exports = { collectDisk, handleDisk };
