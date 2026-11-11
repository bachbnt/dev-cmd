// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { HISTORY_FILE } = require('../config');
const { formatSequence, isCommandSequence } = require('../runner/command');

function readHistory(options = {}) {
  const file = options.file || HISTORY_FILE;
  const fsImpl = options.fsImpl || fs;
  try {
    const history = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    return Array.isArray(history) ? history : [];
  } catch (error) {
    return [];
  }
}

function saveHistory(entry, options = {}) {
  const file = options.file || HISTORY_FILE;
  const fsImpl = options.fsImpl || fs;
  const history = readHistory({ file, fsImpl });
  history.unshift(entry);
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  fsImpl.writeFileSync(file, `${JSON.stringify(history.slice(0, 50), null, 2)}\n`);
}

function createHistoryEntry(metadata, commands) {
  return {
    ...metadata,
    commands,
    commandLine: formatSequence(commands),
    executedAt: new Date().toISOString(),
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
