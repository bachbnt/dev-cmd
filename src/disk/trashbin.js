// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findExecutable } = require('../runner/check');
const { spawnSyncProcess } = require('../runner/spawn');
const { measure } = require('./size');

// The system Trash: how big it is, and emptying it. Emptying is its own action (`dev prune trash`)
// because it deletes for good. DevCmd never lists or removes single items in it.
//
//   macOS    Finder empties it (`osascript`, a fixed script). Reading ~/.Trash needs Full Disk Access
//            for the terminal, so the size can be unknown; Finder asks once for permission to be
//            controlled.
//   Linux    `gio trash --empty`
//   Windows  `Clear-RecycleBin -Force` in PowerShell (a fixed script)

const MAC_SCRIPT = 'tell application "Finder" to empty trash';
const WINDOWS_SCRIPT = 'Clear-RecycleBin -Force -ErrorAction Stop';

function trashFolders({ homeDir, platform, env }) {
  if (platform === 'darwin') return [path.join(homeDir, '.Trash')];
  if (platform === 'linux') return [path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), 'Trash')];
  return [];
}

// { bytes, known, note }: `known` is false when the system will not let us look inside.
async function trashSize({ homeDir = os.homedir(), platform = process.platform, env = process.env } = {}) {
  const folders = trashFolders({ homeDir, platform, env });
  if (folders.length === 0) return { bytes: 0, known: false, note: 'Windows does not let DevCmd measure the Recycle Bin.' };
  let bytes = 0;
  for (const folder of folders) {
    try {
      fs.readdirSync(folder);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      return {
        bytes: 0, known: false, note: platform === 'darwin'
          ? 'macOS blocks reading the Trash. Give your terminal Full Disk Access to see its size; emptying through Finder still works.'
          : `cannot read the Trash: ${error.message}`,
      };
    }
    bytes += (await measure(folder)).bytes;
  }
  return { bytes, known: true, note: undefined };
}

// The command that empties the Trash on this system, or undefined when there is none.
function emptyCommand({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'darwin') return { executable: 'osascript', args: ['-e', MAC_SCRIPT] };
  if (platform === 'win32') return { executable: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT] };
  if (findExecutable('gio', { env })) return { executable: 'gio', args: ['trash', '--empty'] };
  return undefined;
}

function emptyTrash(options = {}) {
  const { spawnSync = spawnSyncProcess } = options;
  const command = emptyCommand(options);
  if (!command) return { ok: false, reason: 'there is no tool to empty the Trash on this system (gio is not installed)' };
  const result = spawnSync(command.executable, command.args, { encoding: 'utf8', env: options.env });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || '').trim().split('\n')[0];
    return {
      ok: false,
      command,
      reason: /not allowed|-1743|-10004|-1728/.test(detail)
        ? 'macOS did not let DevCmd control Finder. Allow it in System Settings > Privacy & Security > Automation, or empty the Trash in Finder.'
        : (detail || `${command.executable} exited ${result.status}`),
    };
  }
  return { ok: true, command };
}

module.exports = {
  MAC_SCRIPT, WINDOWS_SCRIPT, emptyCommand, emptyTrash, trashSize,
};
