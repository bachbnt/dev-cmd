// Copyright (c) 2026 bachbnt

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findExecutable } = require('../runner/check');
const { spawnSyncProcess } = require('../runner/spawn');

// Moves a file or folder to the system trash instead of deleting it. When no trash is available
// the move is refused and nothing is deleted: DevCmd never falls back to a permanent delete.
//
//   macOS    rename into ~/.Trash under a free name (no "Put Back" entry, but fully recoverable)
//   Linux    `gio trash`
//   Windows  Recycle Bin through PowerShell; the path travels in an environment variable, so no
//            quoting rule can turn it into script text

const WINDOWS_SCRIPT = [
  '$Path = $env:DEVCMD_TRASH_PATH',
  'Add-Type -AssemblyName Microsoft.VisualBasic',
  '$item = Get-Item -LiteralPath $Path -Force',
  'if ($item.PSIsContainer) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($Path, "OnlyErrorDialogs", "SendToRecycleBin") }',
  'else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($Path, "OnlyErrorDialogs", "SendToRecycleBin") }',
].join('; ');

function freeName(directory, name, fsImpl) {
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  for (let counter = 0; ; counter += 1) {
    const candidate = counter === 0 ? name : `${stem} ${counter}${extension}`;
    if (!fsImpl.existsSync(path.join(directory, candidate))) return candidate;
  }
}

function moveToTrash(target, options = {}) {
  const {
    homeDir = os.homedir(), platform = process.platform, fsImpl = fs, spawnSync = spawnSyncProcess, env = process.env,
  } = options;
  const absolute = path.resolve(target);
  if (platform === 'darwin') {
    const trash = path.join(homeDir, '.Trash');
    if (!fsImpl.existsSync(trash)) return { ok: false, reason: 'the Trash folder was not found' };
    const destination = path.join(trash, freeName(trash, path.basename(absolute), fsImpl));
    try {
      fsImpl.renameSync(absolute, destination);
      return { ok: true, method: 'moved-to-trash', destination };
    } catch (error) {
      return { ok: false, reason: error.code === 'EXDEV' ? 'it is on another volume than the Trash; move it to the Trash in Finder' : error.message };
    }
  }
  if (platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], {
      encoding: 'utf8', env: { ...env, DEVCMD_TRASH_PATH: absolute },
    });
    return result.status === 0 ? { ok: true, method: 'moved-to-trash' } : { ok: false, reason: String(result.stderr || result.error?.message || 'the Recycle Bin refused it').trim() };
  }
  if (!findExecutable('gio', { env })) return { ok: false, reason: 'gio is not installed, so there is no trash to use' };
  const result = spawnSync('gio', ['trash', '--', absolute], { encoding: 'utf8', env });
  return result.status === 0 ? { ok: true, method: 'moved-to-trash' } : { ok: false, reason: String(result.stderr || 'gio trash failed').trim() };
}

module.exports = { WINDOWS_SCRIPT, moveToTrash };
