// Copyright (c) 2026 bachbnt

const childProcess = require('child_process');
const path = require('path');

// Windows cannot start .cmd/.bat shims (npm, npx, pnpm, yarn, code, gradlew.bat) without cmd.exe,
// and Node.js refuses to run them with shell: false. On Windows only, cross-spawn escapes each
// argument for cmd.exe. Everywhere else the process is started directly with shell: false.
const CMD_SCRIPT = /\.(cmd|bat)$/i;
// cmd.exe expands %VARIABLES% even inside quotes, and line breaks end the command.
const UNSAFE_CMD_ARGUMENT = /[%\r\n\0]/;

function isCmdScript(executable, options) {
  if (CMD_SCRIPT.test(executable)) return true;
  // Loaded lazily because check.js uses this module for its own version probes.
  const { findExecutable } = require('./check');
  const resolved = findExecutable(executable, { env: options.env, cwd: options.cwd });
  return Boolean(resolved && CMD_SCRIPT.test(resolved));
}

function assertSafeWindowsCommand(executable, args, options) {
  if (!isCmdScript(executable, options)) return;
  const unsafe = args.find((argument) => UNSAFE_CMD_ARGUMENT.test(String(argument)));
  if (unsafe !== undefined) {
    throw new Error(
      `${path.basename(executable)} runs through cmd.exe on Windows and cannot receive an argument ` +
      'containing %, a line break, or a null character.'
    );
  }
}

function prepare(executable, args, options, deps) {
  const platform = deps.platform || process.platform;
  if (platform !== 'win32') return { windows: false, options };
  const windowsOptions = { ...options, shell: false };
  assertSafeWindowsCommand(executable, args, windowsOptions);
  return { windows: true, options: windowsOptions };
}

function spawnProcess(executable, args, options = {}, deps = {}) {
  const prepared = prepare(executable, args, options, deps);
  if (!prepared.windows) return (deps.spawn || childProcess.spawn)(executable, args, prepared.options);
  const crossSpawn = deps.crossSpawn || require('cross-spawn');
  return crossSpawn(executable, args, prepared.options);
}

function spawnSyncProcess(executable, args, options = {}, deps = {}) {
  const prepared = prepare(executable, args, options, deps);
  if (!prepared.windows) {
    return (deps.spawnSync || childProcess.spawnSync)(executable, args, prepared.options);
  }
  const crossSpawn = deps.crossSpawn || require('cross-spawn');
  return crossSpawn.sync(executable, args, prepared.options);
}

module.exports = {
  CMD_SCRIPT,
  UNSAFE_CMD_ARGUMENT,
  spawnProcess,
  spawnSyncProcess,
};
