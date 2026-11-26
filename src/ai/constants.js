// Copyright (c) 2026 bachbnt

// Names the command line needs without loading the log readers. `sources/index.js` checks that
// AI_TOOLS matches the registered sources, so the two cannot drift.

const AI_PERIODS = ['today', 'week', 'month', 'report', 'clients'];
const AI_GROUPS = ['day', 'week', 'month', 'project', 'model', 'tool', 'session', 'branch', 'client'];
const AI_TOOLS = ['claude', 'codex', 'gemini', 'copilot', 'opencode'];
const AI_FORMATS = ['table', 'json', 'csv', 'md', 'html', 'openmetrics'];

module.exports = { AI_FORMATS, AI_GROUPS, AI_PERIODS, AI_TOOLS };
