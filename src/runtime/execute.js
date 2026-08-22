// Copyright (c) 2026 bachbnt

const { spawn } = require('child_process');
const { createHistoryEntry, saveHistory } = require('../commands/history');
const { recordProject } = require('../projects/recent');
const { assertExecutables } = require('../runner/check');
const { formatSequence } = require('../runner/command');
const { runSequence } = require('../runner/process');

function buildNotificationCommand(message, platform = process.platform) {
  if (platform === 'darwin') {
    return {
      executable: 'osascript',
      args: [
        '-e',
        'on run argv',
        '-e',
        'display notification (item 1 of argv) with title "DevCmd"',
        '-e',
        'end run',
        message,
      ],
    };
  }
  if (platform === 'linux') {
    return { executable: 'notify-send', args: ['DevCmd', message] };
  }
  return undefined;
}

function sendNotification(message) {
  try {
    const command = buildNotificationCommand(message);
    if (command) spawn(command.executable, command.args, { stdio: 'ignore' });
  } catch {}
}

function describeFailure(result) {
  if (result.signal === 'SIGINT') return 'Command cancelled by user.';
  if (result.signal) return `Command stopped by ${result.signal}.`;
  if (result.error?.code === 'ENOENT') {
    return `Executable "${result.failedCommand.executable}" was not found in PATH.`;
  }
  if (result.error) return `Unable to start command: ${result.error.message}`;
  return `Command exited with code ${result.exitCode}.`;
}

async function executeCommands(p, pc, commands, metadata, options = {}) {
  const commandLine = formatSequence(commands);
  p.log.step(`${options.dryRun ? 'Dry run' : 'Executing'}: ${pc.yellow(commandLine)}`);

  if (options.dryRun) {
    p.outro('No command was executed.');
    return 0;
  }

  try {
    if (options.requirements) assertExecutables(options.requirements);
  } catch (error) {
    p.outro(`${pc.red('✖')} ${error.message}`);
    return 127;
  }

  const startTime = Date.now();
  const result = await runSequence(commands);
  const elapsed = Date.now() - startTime;
  const notifyThreshold = (options.config ?? metadata.config)?.notify;
  if (notifyThreshold > 0 && elapsed >= notifyThreshold * 1000) {
    const status = result.ok ? '✔' : '✖';
    const project = metadata.projectName ? ` — ${metadata.projectName}` : '';
    sendNotification(`dev ${metadata.command}${project} ${status}`);
  }

  if (!result.ok) {
    p.outro(`${pc.red('✖')} ${describeFailure(result)}`);
    return result.exitCode;
  }

  try {
    saveHistory(createHistoryEntry(metadata, commands));
  } catch (error) {
    p.log.warn(`Command succeeded, but history could not be saved: ${error.message}`);
  }
  if (metadata.projectPath) {
    recordProject({
      name: metadata.projectName,
      type: metadata.projectType || metadata.command,
      path: metadata.projectPath,
    });
  }
  p.outro(`${pc.green('✔')} Command completed successfully.`);
  return 0;
}

module.exports = {
  buildNotificationCommand,
  describeFailure,
  executeCommands,
};
