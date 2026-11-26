// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { HISTORY_FILE } = require('../config');
const { readJson, writeJsonAtomic } = require('../store/json-store');
const { formatSequence, isCommandSequence } = require('../runner/command');

function readHistory(options = {}) {
  const file = options.file || HISTORY_FILE;
  const fsImpl = options.fsImpl || fs;
  const history = readJson(file, { fsImpl, fallback: [] });
  return Array.isArray(history) ? history : [];
}

function saveHistory(entry, options = {}) {
  const file = options.file || HISTORY_FILE;
  const fsImpl = options.fsImpl || fs;
  const history = readHistory({ file, fsImpl });
  history.unshift(entry);
  writeJsonAtomic(file, history.slice(0, 50), { fsImpl });
}

function createHistoryEntry(metadata, commands, options = {}) {
  const now = options.now || (() => new Date());
  return {
    ...metadata,
    commands,
    commandLine: formatSequence(commands),
    executedAt: now().toISOString(),
  };
}

function filterHistory(history, filters = {}) {
  const project = filters.project ? path.resolve(filters.project) : undefined;
  const search = filters.search?.toLowerCase();
  return history.filter((entry) => {
    if (project && entry.projectPath !== project) return false;
    if (!search) return true;
    return [entry.command, entry.projectName, entry.commandLine, entry.projectType]
      .some((value) => typeof value === 'string' && value.toLowerCase().includes(search));
  });
}

function getHistoryDisplay(entry) {
  if (isCommandSequence(entry.commands)) return formatSequence(entry.commands);
  return entry.commandLine || 'Unknown command';
}

module.exports = {
  createHistoryEntry,
  filterHistory,
  getHistoryDisplay,
  readHistory,
  saveHistory,
};
