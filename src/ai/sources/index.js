// Copyright (c) 2026 bachbnt

const fs = require('fs');
const { AI_TOOLS } = require('../constants');
const claude = require('./claude');
const codex = require('./codex');
const copilot = require('./copilot');
const gemini = require('./gemini');
const opencode = require('./opencode');

// Every log reader behind one list. A source supplies `tool`, `defaultDir`, `isLog`, `needles`,
// `initState`, `onLine` and a `version` (see claude.js). To support a new tool add a file here,
// list it below, and add its id to AI_TOOLS in `../constants.js`; nothing else changes.
const SOURCES = [claude, codex, gemini, copilot, opencode];

// Tools surveyed and found to keep no usable numbers locally (see docs/AI-SOURCES.md).
const UNSUPPORTED = [{
  tool: 'antigravity',
  label: 'Antigravity',
  reason: 'keeps only conversation titles and step counts locally: no tokens, model or cost',
}];

function getSources(tools = []) {
  return tools.length === 0 ? SOURCES : SOURCES.filter((source) => tools.includes(source.tool));
}

function sourceDir(source, { homeDir, dirs = {} }) {
  return dirs[source.tool] || source.defaultDir(homeDir);
}

// What `dev ai --tools` shows: which sources exist, where they read, whether the folder is there.
function describeSources(options) {
  return SOURCES.map((source) => {
    const dir = sourceDir(source, options);
    let found = false;
    try {
      found = fs.statSync(dir).isDirectory();
    } catch {}
    return {
      tool: source.tool, label: source.label, dir, found, billing: source.billing, maturity: source.maturity,
    };
  }).concat(UNSUPPORTED.map((entry) => ({
    tool: entry.tool, label: entry.label, dir: '', found: false, billing: 'none', maturity: 'not supported', reason: entry.reason,
  })));
}

if (SOURCES.map((source) => source.tool).join() !== AI_TOOLS.join()) {
  throw new Error('AI_TOOLS in src/ai/constants.js must list the registered sources in order.');
}

module.exports = {
  SOURCES, UNSUPPORTED, describeSources, getSources, sourceDir,
};
