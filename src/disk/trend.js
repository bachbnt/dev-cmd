// Copyright (c) 2026 bachbnt

const { getPaths } = require('../config/paths');
const { readJson, writeJsonAtomic } = require('../store/json-store');

// Daily totals for `dev disk --trend`: bytes per group, no paths. One entry per day (the last run
// of the day wins), kept for a year.

const KEEP_DAYS = 400;

function loadTrend(homeDir) {
  const data = readJson(getPaths(homeDir).diskDailyFile, { fallback: undefined });
  return data && data.version === 1 && data.days && typeof data.days === 'object' ? data : { version: 1, days: {} };
}

function recordTrend(homeDir, day, totals) {
  const trend = loadTrend(homeDir);
  trend.days[day] = totals;
  const days = Object.keys(trend.days).sort();
  for (const old of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete trend.days[old];
  writeJsonAtomic(getPaths(homeDir).diskDailyFile, trend, { space: 0 });
  return trend;
}

// The recorded days, oldest first, each with the change since the day before it.
function trendRows(trend, limit = 14) {
  const days = Object.keys(trend.days).sort().slice(-limit);
  return days.map((day, index) => {
    const entry = trend.days[day];
    const previous = index > 0 ? trend.days[days[index - 1]] : undefined;
    return { day, ...entry, change: previous ? entry.total - previous.total : null };
  });
}

module.exports = { loadTrend, recordTrend, trendRows };
