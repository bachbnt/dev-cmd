// Copyright (c) 2026 bachbnt

const { addTokens, cacheWrite, emptyTokens, totalTokens } = require('./model');
const { dayOf, matches } = require('./query');

// Extra views over the same requests: efficiency numbers, the most expensive sessions, and a
// warning when today costs far more than usual. All of it comes from data already read.

function filtered(usages, query) {
  return usages.filter((usage) => matches(query, usage));
}

// Share of the input side served from the cache, spend per model, and how much ran in sub-agents.
function efficiency(usages, prices, query, { planUsd, monthUsd } = {}) {
  const tokens = emptyTokens();
  const byModel = new Map();
  let cost = 0;
  let sidechainCost = 0;
  let unpriced = false;
  for (const usage of filtered(usages, query)) {
    addTokens(tokens, usage.tokens);
    const value = prices.costOf(usage);
    if (value === undefined) {
      unpriced = true;
      continue;
    }
    cost += value;
    byModel.set(usage.model, (byModel.get(usage.model) ?? 0) + value);
    if (usage.sidechain) sidechainCost += value;
  }
  const inputSide = tokens.input + tokens.cache_read + cacheWrite(tokens);
  const models = [...byModel.entries()]
    .map(([model, value]) => ({ model, cost_usd: value, percent: cost > 0 ? (value / cost) * 100 : 0 }))
    .sort((left, right) => right.cost_usd - left.cost_usd || (left.model < right.model ? -1 : 1));
  return {
    cache_hit_ratio: inputSide > 0 ? tokens.cache_read / inputSide : null,
    cost_usd: cost,
    has_unpriced: unpriced,
    models,
    sub_agent_share: cost > 0 ? sidechainCost / cost : null,
    plan: planUsd === undefined ? null : {
      plan_usd: planUsd,
      api_usd_this_month: monthUsd ?? null,
      ratio: monthUsd !== undefined && planUsd > 0 ? monthUsd / planUsd : null,
    },
    note: 'Costs are API prices for this usage. Sub-agent share is known only for tools that log it (Claude Code).',
  };
}

// The `limit` sessions that cost the most.
function topSessions(usages, prices, query, limit) {
  const sessions = new Map();
  for (const usage of filtered(usages, query)) {
    const key = `${usage.tool}\u0000${usage.session}`;
    if (!sessions.has(key)) {
      sessions.set(key, {
        session: usage.session, tool: usage.tool, project: usage.project, branch: usage.branch || '', requests: 0, tokens: emptyTokens(), cost_usd: 0, has_unpriced: false, first: usage.at, last: usage.at,
      });
    }
    const row = sessions.get(key);
    row.requests += 1;
    addTokens(row.tokens, usage.tokens);
    const cost = prices.costOf(usage);
    if (cost === undefined) row.has_unpriced = true;
    else row.cost_usd += cost;
    row.first = Math.min(row.first, usage.at);
    row.last = Math.max(row.last, usage.at);
  }
  return [...sessions.values()]
    .sort((left, right) => right.cost_usd - left.cost_usd || totalTokens(right.tokens) - totalTokens(left.tokens) || (left.session < right.session ? -1 : 1))
    .slice(0, limit)
    .map((row) => ({
      ...row, session: row.session.slice(0, 8), first: new Date(row.first).toISOString(), last: new Date(row.last).toISOString(),
    }));
}

// Is today much more expensive than the days before? `usual` is the average of the last
// `lookbackDays` days that had any spend; fewer than 3 such days means there is no baseline yet.
function detectAnomaly(usages, prices, { today, offsetMinutes, factor, minUsd, lookbackDays = 14 }) {
  const days = new Map();
  for (const usage of usages) {
    const cost = prices.costOf(usage);
    if (cost === undefined) continue;
    const day = dayOf({ offsetMinutes }, usage);
    days.set(day, (days.get(day) ?? 0) + cost);
  }
  const todayUsd = days.get(today) ?? 0;
  const earlier = [...days.entries()]
    .filter(([day]) => day < today && day >= shiftDay(today, -lookbackDays))
    .map(([, value]) => value)
    .filter((value) => value > 0);
  if (earlier.length < 3) return { flagged: false, today_usd: todayUsd, usual_usd: null, factor, min_usd: minUsd };
  const usual = earlier.reduce((sum, value) => sum + value, 0) / earlier.length;
  return {
    flagged: todayUsd >= minUsd && todayUsd > factor * usual, today_usd: todayUsd, usual_usd: usual, factor, min_usd: minUsd,
  };
}

function shiftDay(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

module.exports = { detectAnomaly, efficiency, topSessions };
