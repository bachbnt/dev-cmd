// Copyright (c) 2026 bachbnt

// What a report is asked for: a period, filters, and how to group. A day is a 'YYYY-MM-DD' string
// in the query's fixed UTC offset (the offset in effect now, like aicost), so ordering days is
// plain string comparison.

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;
const TIME_GROUPS = new Set(['day', 'week', 'month']);

function parseDay(text) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return ms;
}

function formatDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(day, count) {
  return formatDay(parseDay(day) + count * MS_PER_DAY);
}

// Subtract whole months; a day that does not exist in the target month moves to its last day.
function subtractMonths(day, count) {
  const date = new Date(parseDay(day));
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return formatDay(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay)));
}

function daysInMonth(day) {
  const date = new Date(parseDay(day));
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

// The offset (in minutes east of UTC) a report uses for "which day is this request on".
function currentOffsetMinutes(now = new Date()) {
  return -now.getTimezoneOffset();
}

// Day names are memoized per day number: a scan asks for the day of tens of thousands of requests
// that fall on a few dozen distinct days.
const DAY_NAMES = new Map();

function dayOfInstant(ms, offsetMinutes) {
  const dayNumber = Math.floor((ms + offsetMinutes * MS_PER_MINUTE) / MS_PER_DAY);
  let name = DAY_NAMES.get(dayNumber);
  if (name === undefined) {
    name = formatDay(dayNumber * MS_PER_DAY);
    DAY_NAMES.set(dayNumber, name);
  }
  return name;
}

function parseDate(input, today) {
  const text = String(input).trim().toLowerCase();
  const bad = () => new Error(`cannot read the date "${input}": use 2026-11-01, today, yesterday, 7d, 2w or 3m`);
  if (text === 'today') return today;
  if (text === 'yesterday') return addDays(today, -1);
  const absolute = parseDay(text);
  if (absolute !== undefined) return formatDay(absolute);
  const countText = text.slice(0, -1);
  const unit = text.slice(-1);
  if (!/^\d+$/.test(countText)) throw bad();
  const count = Number(countText);
  if (count === 0) throw bad();
  if (unit === 'd') return addDays(today, -(count - 1));
  if (unit === 'w') return addDays(today, -(count * 7 - 1));
  if (unit === 'm') return subtractMonths(today, count);
  throw bad();
}

function weekStart(day) {
  const weekday = (new Date(parseDay(day)).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

function containsAny(text, needles) {
  if (needles.length === 0) return true;
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

// The client a working directory belongs to: the longest configured path that contains it.
function clientOf(cwd, clients) {
  const normalized = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  let best;
  for (const { prefix, name } of clients) {
    const base = String(prefix).replace(/\\/g, '/').replace(/\/+$/, '');
    if ((normalized === base || normalized.startsWith(`${base}/`)) && (!best || base.length > best.length)) best = { length: base.length, name };
  }
  return best ? best.name : '(unassigned)';
}

function createQuery(overrides = {}) {
  return {
    since: undefined,
    until: undefined,
    groupBy: 'day',
    tools: [],
    projects: [],
    models: [],
    clients: [],
    offsetMinutes: 0,
    ...overrides,
  };
}

function dayOf(query, usage) {
  return dayOfInstant(usage.at, query.offsetMinutes);
}

function matches(query, usage, day = dayOf(query, usage)) {
  return (!query.since || day >= query.since)
    && (!query.until || day <= query.until)
    && (query.tools.length === 0 || query.tools.includes(usage.tool))
    && containsAny(usage.project, query.projects)
    && containsAny(usage.model, query.models);
}

function groupKey(query, usage, day = dayOf(query, usage)) {
  switch (query.groupBy) {
    case 'day': return day;
    case 'week': return weekStart(day);
    case 'month': return day.slice(0, 7);
    case 'project': return usage.project;
    case 'model': return usage.model;
    case 'tool': return usage.tool;
    case 'session': return [...usage.session].slice(0, 8).join('');
    case 'branch': return usage.branch || '(unknown)';
    case 'client': return clientOf(usage.cwd, query.clients);
    default: throw new Error(`Unsupported grouping: ${query.groupBy}`);
  }
}

// Log files last written before this instant cannot hold requests from `since` on.
function modifiedSince(query) {
  if (!query.since) return undefined;
  const start = parseDay(addDays(query.since, -1));
  return start - query.offsetMinutes * MS_PER_MINUTE;
}

module.exports = {
  addDays,
  clientOf,
  createQuery,
  currentOffsetMinutes,
  dayOf,
  dayOfInstant,
  daysInMonth,
  groupKey,
  isTimeGroup: (group) => TIME_GROUPS.has(group),
  matches,
  modifiedSince,
  parseDate,
  subtractMonths,
  weekStart,
};
