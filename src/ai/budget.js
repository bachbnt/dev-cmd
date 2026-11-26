// Copyright (c) 2026 bachbnt

const { dayOf, daysInMonth } = require('./query');
const { money } = require('./render');

// This month's spend against the monthly budget (`aiBudget` in the config, in USD). Spend is what
// the same usage would cost at API prices, over every tool and project: filters never apply here.

function monthSpend(usages, prices, { today, offsetMinutes }) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const result = { today_usd: 0, month_usd: 0, unpriced: false };
  for (const usage of usages) {
    const day = dayOf({ offsetMinutes }, usage);
    if (day < monthStart || day > today) continue;
    const cost = prices.costOf(usage);
    if (cost === undefined) {
      result.unpriced = true;
      continue;
    }
    result.month_usd += cost;
    if (day === today) result.today_usd += cost;
  }
  return result;
}

// `budgetUsd` is undefined when no budget is set. The projection is a straight line from the pace
// so far this month: an estimate, not a promise.
function budgetStatus(spend, { today, budgetUsd }) {
  const elapsed = Number(today.slice(8));
  const length = daysInMonth(today);
  const projected = (spend.month_usd / elapsed) * length;
  const hasBudget = budgetUsd !== undefined;
  return {
    month: today.slice(0, 7),
    today_usd: spend.today_usd,
    month_usd: spend.month_usd,
    has_unpriced: spend.unpriced,
    budget_usd: hasBudget ? budgetUsd : null,
    percent: hasBudget && budgetUsd > 0 ? (spend.month_usd / budgetUsd) * 100 : null,
    projected_usd: projected,
    projected_percent: hasBudget && budgetUsd > 0 ? (projected / budgetUsd) * 100 : null,
    over: hasBudget ? spend.month_usd > budgetUsd : null,
    days_elapsed: elapsed,
    days_in_month: length,
  };
}

function percentText(value) {
  return `${Math.round(value)}%`;
}

// One line for a status line or prompt.
function shortLine(status) {
  const mark = status.has_unpriced ? '*' : '';
  const parts = [`${money(status.today_usd)}${mark} today`, `${money(status.month_usd)}${mark} this month`];
  if (status.budget_usd !== null) {
    const percent = status.percent === null ? '' : `${percentText(status.percent)} of `;
    parts[1] += ` (${percent}${money(status.budget_usd)})`;
  }
  return parts.join(' · ');
}

function budgetLines(status) {
  if (status.budget_usd === null) return [];
  const lines = [`Budget ${status.month}: ${money(status.month_usd)} of ${money(status.budget_usd)} used`
    + `${status.percent === null ? '' : ` (${percentText(status.percent)})`}.`];
  lines.push(`At this pace the month ends near ${money(status.projected_usd)}`
    + `${status.projected_percent === null ? '' : ` (${percentText(status.projected_percent)})`} (straight-line estimate).`);
  if (status.over) lines.push('Over budget.');
  return lines;
}

module.exports = { budgetLines, budgetStatus, monthSpend, shortLine };
