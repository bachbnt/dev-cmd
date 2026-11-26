// Copyright (c) 2026 bachbnt

const os = require('os');
const path = require('path');
const { platformSupport } = require('../apps');
const macos = require('../apps/macos');
const { readPruneLog, logPrune } = require('../disk/audit');
const { scanAppCaches } = require('../disk/appcaches');
const { pruneItems } = require('../disk/prune');
const { describe, itemTable, sizeText } = require('../disk/render');
const { scanAll } = require('../disk/scan');
const { formatBytes } = require('../disk/size');
const { listTasks, runTask } = require('../maintenance');
const { spawnSyncProcess } = require('../runner/spawn');

// `dev prune`: removes what can be rebuilt, in a way that can be checked and undone.
//   caches        global tool caches (npm, pip, Xcode DerivedData, ...), cleaned by the tool's own command
//   projects      rebuildable folders of your projects (node_modules, build output) that pass every safety gate
//   app-caches    caches and logs of apps, moved to the Trash (you choose each one)
//   apps [name]   uninstall a macOS app and its leftover files, moved to the Trash
//   maintenance   a short list of tasks; administrator tasks ask for your password in sudo itself
// Without --yes and a selection (--only or --all-safe) nothing is removed: the command lists what it would do.
// Nothing here is written to `dev history`, so `dev again` can never repeat a deletion.

const SUBCOMMANDS = ['caches', 'projects', 'app-caches', 'apps', 'maintenance'];

function settings(context) {
  const { options } = context;
  return {
    homeDir: context.homeDir || os.homedir(),
    now: context.now ? context.now() : new Date(),
    roots: (options.roots || []).map((root) => path.resolve(root)),
    olderThanDays: options.olderThan ? Number(options.olderThan) : 30,
  };
}

function matchesRef(item, ref) {
  return item.id === ref
    || item.path === path.resolve(ref)
    || item.name === ref
    || (item.kind === 'project-artifact' && `${item.project}/${item.artifact}` === ref);
}

function selectItems(items, options) {
  if (options.allSafe) return items.filter((item) => item.tier === 'safe');
  if (options.only?.length) {
    const missing = options.only.filter((ref) => !items.some((item) => matchesRef(item, ref)));
    if (missing.length > 0) throw new Error(`Nothing matches --only ${missing.join(', ')}. Run dev prune to see item ids and paths.`);
    return items.filter((item) => options.only.some((ref) => matchesRef(item, ref)));
  }
  return [];
}

async function gather(sub, config) {
  if (sub === 'app-caches') {
    return { items: await scanAppCaches({ homeDir: config.homeDir, now: config.now.getTime() }), allowReview: true };
  }
  const scan = await scanAll({
    homeDir: config.homeDir, roots: config.roots, olderThanDays: config.olderThanDays, now: config.now.getTime(),
  });
  const wanted = { caches: ['global-cache'], projects: ['project-artifact'] }[sub] || ['global-cache', 'project-artifact'];
  return { items: scan.items.filter((item) => wanted.includes(item.kind)), allowReview: false, scan };
}

function summarize(results) {
  return {
    removed: results.filter((result) => result.status === 'removed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
    freedBytes: results.reduce((sum, result) => sum + (result.freedBytes || 0), 0),
  };
}

function assertSelectionRules(options) {
  if (options.allSafe && !options.yes) {
    throw new Error('--all-safe removes things, so it needs --yes. Without --yes, run dev prune to see what would be removed.');
  }
}

async function planApp(config, name) {
  const support = platformSupport();
  if (!support.automatic) return { mode: 'unsupported', hints: support.hints };
  const apps = macos.listApps({ homeDir: config.homeDir });
  if (!name) return { mode: 'apps', apps: apps.map((app) => ({ name: app.name, path: app.path, bundleId: app.bundleId ?? null })) };
  const app = apps.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  if (!app) throw new Error(`No app named "${name}" in /Applications or ~/Applications.`);
  return { mode: 'app-plan', plan: await macos.planUninstall(app, { homeDir: config.homeDir }) };
}

function appItems(plan, { includeUserData = false } = {}) {
  const items = [{
    id: plan.app.path, kind: 'app', path: plan.app.path, bytes: plan.app.bytes, tier: 'review', reasons: [],
  }];
  const wanted = plan.leftovers.filter((entry) => entry.selected || (includeUserData && entry.confidence === 'exact'));
  for (const leftover of wanted) {
    items.push({
      id: leftover.path, kind: 'app-cache', path: leftover.path, bytes: leftover.bytes, tier: 'review', reasons: [],
    });
  }
  return items;
}

function uninstallCask(cask, { homeDir, spawnSync = spawnSyncProcess } = {}) {
  const args = ['uninstall', '--cask', '--zap', cask];
  const result = spawnSync('brew', args, { stdio: 'inherit' });
  const ok = result.status === 0;
  const command = `brew ${args.join(' ')}`;
  try {
    logPrune({
      id: `cask:${cask}`, path: null, tier: 'review', result: ok ? 'removed' : 'failed', method: 'tool-command', command,
    }, { homeDir });
  } catch {}
  return {
    id: `cask:${cask}`, kind: 'app', path: null, bytes: 0, tier: 'review', status: ok ? 'removed' : 'failed', method: 'tool-command', command, reason: ok ? undefined : `brew exited ${result.status}`,
  };
}

function failed(results) {
  return results.some((result) => result.status === 'failed') ? 1 : 0;
}

async function collectMaintenance(context, config, execute) {
  const { options } = context;
  const tasks = listTasks();
  if (!options.only?.length || !execute) {
    return { mode: 'maintenance', data: { tasks, dryRun: Boolean(options.only?.length) }, exitCode: 0 };
  }
  const results = [];
  for (const id of options.only) {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error(`No maintenance task "${id}".`);
    if (task.needsAdmin) {
      results.push({ id, status: 'skipped', reason: 'needs administrator rights: run dev prune maintenance in a terminal and type your password there' });
    } else {
      const result = await runTask(task, { homeDir: config.homeDir });
      results.push({ id, status: result.ok ? 'removed' : 'failed' });
    }
  }
  return { mode: 'maintenance', data: { results }, exitCode: failed(results) };
}

async function collectApps(context, config, execute) {
  const planned = await planApp(config, context.positionals[1]);
  if (planned.mode !== 'app-plan') return { mode: planned.mode, data: planned, exitCode: 0 };
  const { plan } = planned;
  if (plan.refused) return { mode: 'app-plan', data: { ...plan, dryRun: true }, exitCode: 1 };
  if (!execute) return { mode: 'app-plan', data: { ...plan, dryRun: true }, exitCode: 0 };
  const results = plan.cask
    ? [uninstallCask(plan.cask, { homeDir: config.homeDir })]
    : await pruneItems(appItems(plan), { homeDir: config.homeDir, allowReview: true });
  return { mode: 'app-result', data: { results, ...summarize(results) }, exitCode: failed(results) };
}

// Non-interactive core, also behind --json.
async function collectPrune(context) {
  const { options, positionals } = context;
  const config = settings(context);
  const sub = positionals[0];
  if (sub && !SUBCOMMANDS.includes(sub)) throw new Error(`Unknown prune target "${sub}". Use one of: ${SUBCOMMANDS.join(', ')}.`);
  if (options.log) return { mode: 'log', data: { entries: readPruneLog({ homeDir: config.homeDir }) }, exitCode: 0 };
  assertSelectionRules(options);
  const execute = Boolean(options.yes) && !options.dryRun;

  if (sub === 'maintenance') return collectMaintenance(context, config, execute);
  if (sub === 'apps') return collectApps(context, config, execute);

  const { items, allowReview, scan } = await gather(sub, config);
  const selected = selectItems(items, options);
  const pruneOptions = { homeDir: config.homeDir, allowReview, olderThanDays: config.olderThanDays };
  if (!execute || selected.length === 0) {
    const plan = selected.length > 0 ? await pruneItems(selected, { ...pruneOptions, dryRun: true }) : [];
    return { mode: 'plan', data: { scannedAt: config.now.toISOString(), items, plan, totals: scan?.totals }, exitCode: 0 };
  }
  const results = await pruneItems(selected, pruneOptions);
  return { mode: 'result', data: { results, ...summarize(results) }, exitCode: failed(results) };
}

function showResults(p, results) {
  const lines = results.map((result) => {
    const name = result.path ?? result.id;
    const how = result.method ? ` (${result.method})` : '';
    const size = sizeText({ bytes: result.freedBytes ?? result.bytes ?? 0 }).padStart(9);
    return `${result.status.padEnd(12)} ${size}  ${name}${how}${result.reason ? `  - ${result.reason}` : ''}`;
  });
  p.note(lines.join('\n'), 'Result');
  const summary = summarize(results);
  p.log.info(`Freed ${formatBytes(summary.freedBytes)}: ${summary.removed} removed, ${summary.skipped} skipped, ${summary.failed} failed. Details: dev prune --log`);
}

async function chooseAndRun(context, items, { allowReview, title, preselectSafe = true }) {
  const { p } = context;
  const config = settings(context);
  const choices = items.filter((item) => item.tier === 'safe' || (allowReview && item.tier === 'review'));
  const shown = items.filter((item) => !choices.includes(item));
  if (shown.length > 0) p.note(itemTable(shown.slice(0, 15)), 'Not offered (shown with the reason)');
  if (choices.length === 0) {
    p.log.info('Nothing to clean here.');
    return;
  }
  const picked = await p.multiselect({
    message: title,
    required: false,
    initialValues: preselectSafe ? choices.filter((item) => item.tier === 'safe').map((item) => item.id) : [],
    options: choices.map((item) => ({
      value: item.id,
      label: `${sizeText(item).padStart(9)}  ${describe(item)}`,
      hint: item.tier === 'review' ? `review: ${item.reasons[0] || ''}` : item.recreate,
    })),
  });
  if (p.isCancel(picked) || picked.length === 0) return;
  const chosen = choices.filter((item) => picked.includes(item.id));
  const total = chosen.reduce((sum, item) => sum + item.bytes, 0);
  const sure = await p.confirm({ message: `Remove ${chosen.length} item(s), about ${formatBytes(total)}? Review items go to the Trash.`, initialValue: false });
  if (p.isCancel(sure) || !sure) {
    p.log.info('Cancelled. Nothing was removed.');
    return;
  }
  const spin = p.spinner();
  spin.start('Cleaning');
  const results = await pruneItems(chosen, { homeDir: config.homeDir, allowReview, olderThanDays: config.olderThanDays });
  spin.stop('Done');
  showResults(p, results);
}

async function interactiveApps(context) {
  const { p } = context;
  const config = settings(context);
  const planned = await planApp(config, context.positionals[1]);
  if (planned.mode === 'unsupported') {
    p.note(planned.hints.join('\n'), 'DevCmd does not uninstall apps on this system. Use the official command');
    return;
  }
  let { plan } = planned;
  if (!plan) {
    const name = await p.select({ message: 'Which app?', options: planned.apps.map((app) => ({ value: app.name, label: app.name, hint: app.bundleId || '' })) });
    if (p.isCancel(name)) return;
    ({ plan } = await planApp(config, name));
  }
  if (plan.refused) {
    p.log.error(`Cannot uninstall ${plan.app.name}: ${plan.refused}.`);
    return;
  }
  p.note([
    `${plan.app.name}  ${formatBytes(plan.app.bytes)}  ${plan.app.path}`,
    ...plan.leftovers.map((entry) => `  ${entry.selected ? '[x]' : '[ ]'} ${formatBytes(entry.bytes).padStart(9)}  ${entry.path}  (${entry.confidence === 'exact' ? 'bundle id match' : 'name match only'}${entry.userData ? ', your app data' : ''})`),
    plan.cask ? `Installed with Homebrew: DevCmd runs brew uninstall --cask --zap ${plan.cask}.` : '',
  ].filter(Boolean).join('\n'), 'Uninstall plan');
  const extra = plan.leftovers.filter((entry) => !entry.selected && entry.confidence === 'exact');
  let includeUserData = false;
  if (extra.length > 0) {
    const answer = await p.confirm({ message: 'Also remove your data for this app (Application Support, Containers)? That deletes its saved data.', initialValue: false });
    includeUserData = answer === true;
  }
  const sure = await p.confirm({ message: `Uninstall ${plan.app.name}? Files go to the Trash.`, initialValue: false });
  if (p.isCancel(sure) || !sure) {
    p.log.info('Cancelled. Nothing was removed.');
    return;
  }
  const results = plan.cask
    ? [uninstallCask(plan.cask, { homeDir: config.homeDir })]
    : await pruneItems(appItems(plan, { includeUserData }), { homeDir: config.homeDir, allowReview: true });
  showResults(p, results);
}

async function interactiveMaintenance(context) {
  const { p } = context;
  const config = settings(context);
  const tasks = listTasks().filter((task) => task.available);
  const id = await p.select({
    message: 'Maintenance task',
    options: tasks.map((task) => ({
      value: task.id,
      label: task.name,
      hint: `${task.needsAdmin ? 'asks for your password; ' : ''}${task.reversible ? 'can be undone' : 'cannot be undone'}`,
    })),
  });
  if (p.isCancel(id)) return;
  const task = tasks.find((candidate) => candidate.id === id);
  p.note(`${task.does}\n${task.needsAdmin ? 'Needs administrator rights: sudo asks for your password; DevCmd never sees it.' : 'Runs as you.'}`, task.name);
  const sure = await p.confirm({ message: `Run "${task.name}"?`, initialValue: false });
  if (p.isCancel(sure) || !sure) return;
  const result = await runTask(task, {
    homeDir: config.homeDir,
    confirm: async (text) => {
      const answer = await p.confirm({ message: `Allow these commands to run with administrator rights?\n${text}`, initialValue: false });
      return answer === true;
    },
  });
  if (result.ok) p.log.success(result.results.length === 0 ? 'Nothing to do.' : 'Done.');
  else p.log.error(result.reason || 'The task failed.');
}

async function runInteractive(context) {
  const { p, positionals } = context;
  let target = positionals[0];
  if (!target) {
    target = await p.select({
      message: 'What do you want to do?',
      options: [
        { value: 'analyze', label: 'Analyze', hint: 'see what takes space (read only)' },
        { value: 'caches', label: 'Clean tool caches', hint: 'npm, pip, Xcode DerivedData, ...' },
        { value: 'projects', label: 'Clean project folders', hint: 'node_modules, build output' },
        { value: 'app-caches', label: 'Clean app caches and logs', hint: 'you choose each one; Trash' },
        { value: 'apps', label: 'Uninstall an app', hint: 'macOS; Trash' },
        { value: 'maintenance', label: 'Maintenance', hint: 'a few tasks' },
      ],
    });
    if (p.isCancel(target)) return;
  }
  if (target === 'analyze') {
    await require('./disk').handleDisk({ ...context, options: { ...context.options, top: false }, positionals: [] });
  } else if (target === 'apps') {
    await interactiveApps({ ...context, positionals: ['apps', ...positionals.slice(1)] });
  } else if (target === 'maintenance') {
    await interactiveMaintenance(context);
  } else {
    const spin = p.spinner();
    spin.start('Looking for things to clean');
    const { items, allowReview } = await gather(target, settings(context));
    spin.stop(`Found ${items.length} item(s)`);
    await chooseAndRun(context, items, {
      allowReview,
      title: target === 'app-caches' ? 'Choose app caches to move to the Trash' : 'Choose what to clean (safe items are ticked)',
      preselectSafe: target !== 'app-caches',
    });
  }
}

function showCollected(p, { mode, data }) {
  if (mode === 'log') {
    p.note(data.entries.length ? data.entries.map((entry) => `${entry.at}  ${String(entry.result).padEnd(8)} ${entry.path ?? entry.id}  ${entry.method ?? ''}`).join('\n') : 'The deletion log is empty.', 'Deletion log');
  } else if (mode === 'plan') {
    if (data.items.length > 0) p.note(itemTable(data.items.slice(0, 40)), 'What dev prune found');
    if (data.plan.length > 0) showResults(p, data.plan);
    p.log.info('Nothing was removed. To remove: dev prune --only <id|path> --yes, or --all-safe --yes. Interactive: run dev prune in a terminal.');
  } else if (mode === 'result' || mode === 'app-result') {
    showResults(p, data.results);
  } else if (mode === 'maintenance') {
    const text = data.tasks
      ? data.tasks.map((task) => `${task.id.padEnd(26)} ${task.name}${task.needsAdmin ? '  [needs administrator rights]' : ''}`).join('\n')
      : data.results.map((entry) => `${entry.status}  ${entry.id}${entry.reason ? `  - ${entry.reason}` : ''}`).join('\n');
    p.note(text, 'Maintenance');
  } else if (mode === 'apps') {
    p.note(data.apps.map((app) => `${app.name}  ${app.bundleId ?? ''}`).join('\n'), 'Installed apps. Plan one with: dev prune apps <name>');
  } else if (mode === 'app-plan') {
    p.note([
      `${data.app.name}  ${formatBytes(data.app.bytes)}`,
      data.refused ? `Cannot uninstall: ${data.refused}.` : '',
      ...data.leftovers.map((entry) => `${entry.selected ? '[x]' : '[ ]'} ${entry.path}`),
      data.cask ? `Homebrew cask: ${data.cask}` : '',
    ].filter(Boolean).join('\n'), 'Uninstall plan (nothing removed)');
    if (!data.refused) p.log.info(`To uninstall: dev prune apps "${data.app.name}" --yes`);
  } else if (mode === 'unsupported') {
    p.note(data.hints.join('\n'), 'DevCmd does not uninstall apps on this system. Use the official command');
  }
}

async function handlePrune(context) {
  const { p, options, positionals } = context;
  const sub = positionals[0];
  if (sub && !SUBCOMMANDS.includes(sub)) throw new Error(`Unknown prune target "${sub}". Use one of: ${SUBCOMMANDS.join(', ')}.`);
  const selecting = options.dryRun || options.yes || options.only?.length || options.allSafe || options.log;
  if (process.stdout.isTTY && process.stdin.isTTY && !selecting) {
    await runInteractive(context);
    p.outro('Done.');
    return 0;
  }
  const result = await collectPrune(context);
  showCollected(p, result);
  p.outro('Done.');
  return result.exitCode;
}

module.exports = { collectPrune, handlePrune };
