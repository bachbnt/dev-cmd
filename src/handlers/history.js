// Copyright (c) 2026 bachbnt

const fs = require('fs');
const { HISTORY_FILE, frameworkDefinitions } = require('../config');
const { buildAndroidCommands, buildIOSBootCommands, buildIOSShutdownCommands } = require('../commands/devices');
const { buildFrameworkCommands, builtInRegistry } = require('../commands/frameworks');
const { filterHistory, getHistoryDisplay, readHistory } = require('../commands/history');
const { isCommandSequence } = require('../runner/command');
const { executeCommands } = require('../runtime/execute');

function rebuildHistoryCommands(entry, registry = builtInRegistry, definitions = frameworkDefinitions) {
  if (isCommandSequence(entry.commands)) return entry.commands;
  if (definitions[entry.command] && entry.target) {
    return buildFrameworkCommands(entry.command, entry.target, entry.options || {}, registry);
  }
  if (entry.command === 'android' && entry.target) return buildAndroidCommands(entry.target, entry.options || {});
  if (entry.command === 'ios' && entry.action === 'shutdown-all') return buildIOSShutdownCommands();
  if (entry.command === 'ios' && entry.target) return buildIOSBootCommands(entry.target);
  throw new Error('This legacy history entry cannot be replayed safely. Run the command again directly.');
}

function handleHistory(context) {
  const { p, options } = context;

  if (options.clear) {
    try { fs.unlinkSync(HISTORY_FILE); } catch {}
    p.outro('History cleared.');
    return 0;
  }

  const history = filterHistory(readHistory(), options).slice(0, 10);

  if (history.length === 0) {
    p.outro(options.project || options.search
      ? 'No history entries match the filter.'
      : 'No successful commands in history yet.');
    return 0;
  }
  p.note(
    history.map((entry, index) => `${index + 1}. ${getHistoryDisplay(entry)}\n   ${entry.executedAt}`).join('\n'),
    'Recent commands'
  );
  p.outro(`History file: ${HISTORY_FILE}`);
  return 0;
}

function handleAgain(context) {
  const { p, pc, positionals, options } = context;
  const index = positionals[0] !== undefined ? parseInt(positionals[0], 10) : 1;
  if (isNaN(index) || index < 1) {
    throw new Error('Usage: dev again [n] — n must be a positive integer.');
  }
  const history = readHistory();
  const entry = history[index - 1];
  if (!entry) {
    throw new Error(`No command at position ${index}. History has ${history.length} entries.`);
  }
  return executeCommands(
    p,
    pc,
    rebuildHistoryCommands(
      entry,
      context.recipeRegistry || builtInRegistry,
      context.frameworkDefinitions || frameworkDefinitions
    ),
    { command: 'again', source: entry.command },
    options
  );
}

module.exports = {
  handleAgain,
  handleHistory,
  rebuildHistoryCommands,
};
