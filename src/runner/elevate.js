// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { protectedReason } = require('../disk/safety');
const { spawnSyncProcess } = require('./spawn');

// The only way DevCmd asks for administrator rights. Rules, each enforced here and tested:
//   - DevCmd never reads, stores or forwards a password. `sudo` runs with stdio inherited, so the
//     password goes from the keyboard straight to `sudo`. There is no -S, no askpass.
//   - `sudo -k` forgets any earlier authentication, so every elevation asks for the password again.
//   - Only commands from a reviewed catalog run (`needsAdmin: true`), with fixed arguments.
//   - The person sees the exact commands and confirms separately. `--yes` never replaces this.
//   - No terminal, no elevation. Windows is not supported: commands are only printed.
//   - Removing files as root goes through /bin/rm with a real path whose every parent folder is
//     owned by root and writable by nobody else (so nothing can swap a link while the person types
//     the password). The deny list applies to root as well.

const ELEVATED_DENY_EXTRA = ['/Library/Apple', '/private/var/db'];

function buildElevatedCommand({ executable, args = [] }) {
  if (!path.isAbsolute(executable)) throw new Error(`An elevated command must use an absolute executable path, not "${executable}".`);
  return { executable: 'sudo', args: ['-k', '--', executable, ...args] };
}

// Every folder above `target` must be owned by root and not writable by group or others.
function parentsAreTrusted(target, fsImpl = fs) {
  let current = path.dirname(target);
  for (;;) {
    let stat;
    try {
      stat = fsImpl.lstatSync(current);
    } catch {
      return { ok: false, reason: `cannot inspect ${current}` };
    }
    if (stat.uid !== 0) return { ok: false, reason: `${current} is not owned by root` };
    if ((stat.mode & 0o022) !== 0) return { ok: false, reason: `${current} can be changed by someone other than root` };
    const parent = path.dirname(current);
    if (parent === current) return { ok: true };
    current = parent;
  }
}

// The command that removes `target` as root, or a reason it was refused.
function planElevatedRemoval(target, { fsImpl = fs, homeDir, platform = process.platform } = {}) {
  if (platform === 'win32') return { ok: false, reason: 'administrator removal is not supported on Windows' };
  let real;
  try {
    real = fsImpl.realpathSync(target);
  } catch {
    return { ok: false, reason: `${target} does not exist` };
  }
  const denied = protectedReason(real, { homeDir, platform, fsImpl });
  if (denied) return { ok: false, reason: denied };
  const extra = ELEVATED_DENY_EXTRA.find((entry) => real === entry || real.startsWith(`${entry}/`));
  if (extra) return { ok: false, reason: `${real} is inside ${extra}, which is never removed` };
  const parents = parentsAreTrusted(real, fsImpl);
  if (!parents.ok) return { ok: false, reason: parents.reason };
  return { ok: true, command: { executable: '/bin/rm', args: ['-rf', '--', real] }, path: real };
}

// Runs reviewed commands with administrator rights. `confirm(text)` must return true; it is shown
// the exact commands (it may be async). Returns one result per command.
async function runElevated(commands, {
  isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY), confirm, spawnSync = spawnSyncProcess, platform = process.platform,
} = {}) {
  if (platform === 'win32') return { ok: false, reason: 'administrator commands are not run on Windows; run them yourself in an elevated terminal', results: [] };
  if (!isTTY) return { ok: false, reason: 'administrator rights need an interactive terminal to type the password in', results: [] };
  const built = commands.map(buildElevatedCommand);
  const text = built.map((command) => `  ${command.executable} ${command.args.join(' ')}`).join('\n');
  if (!confirm || (await confirm(text)) !== true) return { ok: false, reason: 'not confirmed', results: [] };
  const results = built.map((command) => {
    const result = spawnSync(command.executable, command.args, { stdio: 'inherit' });
    return { command: `${command.executable} ${command.args.join(' ')}`, status: result.status, ok: result.status === 0 };
  });
  return { ok: results.every((result) => result.ok), results };
}

module.exports = { buildElevatedCommand, parentsAreTrusted, planElevatedRemoval, runElevated };
