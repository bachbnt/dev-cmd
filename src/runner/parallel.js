// Copyright (c) 2026 bachbnt

const { spawn } = require('child_process');
const { SIGNAL_EXIT_CODES } = require('./process');

function createLinePrefixer(label, write) {
  let pending = '';
  return {
    push(data) {
      pending += data.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) write(`[${label}] ${line}\n`);
    },
    flush() {
      if (pending) write(`[${label}] ${pending}\n`);
      pending = '';
    },
  };
}

function runJob(job, context) {
  const prefixer = createLinePrefixer(job.label, context.write);
  return new Promise((resolve) => {
    let index = 0;
    const next = () => {
      if (context.stopped) {
        prefixer.flush();
        resolve({ label: job.label, ok: false, exitCode: context.signalCode || 1 });
        return;
      }
      if (index >= job.commands.length) {
        prefixer.flush();
        resolve({ label: job.label, ok: true, exitCode: 0 });
        return;
      }
      const command = job.commands[index];
      let child;
      try {
        const spawnOptions = { shell: false, stdio: ['ignore', 'pipe', 'pipe'] };
        if (command.cwd) spawnOptions.cwd = command.cwd;
        child = context.spawnImpl(command.executable, command.args, spawnOptions);
      } catch (error) {
        prefixer.push(`${error.message}\n`);
        prefixer.flush();
        resolve({ label: job.label, ok: false, exitCode: error.code === 'ENOENT' ? 127 : 1 });
        return;
      }
      context.children.add(child);
      child.stdout?.on('data', (data) => prefixer.push(data));
      child.stderr?.on('data', (data) => prefixer.push(data));
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        context.children.delete(child);
        if (!result.ok) {
          prefixer.flush();
          resolve({ label: job.label, ...result });
          return;
        }
        index += 1;
        next();
      };
      child.once('error', (error) => {
        prefixer.push(`${error.message}\n`);
        done({ ok: false, exitCode: error.code === 'ENOENT' ? 127 : 1 });
      });
      child.once('close', (code, signal) => {
        if (signal) done({ ok: false, exitCode: SIGNAL_EXIT_CODES[signal] || 1, signal });
        else done({ ok: code === 0, exitCode: code ?? 1 });
      });
    };
    next();
  });
}

async function runParallel(jobs, options = {}) {
  const signalSource = options.signalSource || process;
  const context = {
    spawnImpl: options.spawnImpl || spawn,
    write: options.write || ((text) => process.stdout.write(text)),
    children: new Set(),
    stopped: false,
    signalCode: undefined,
  };
  const stop = (signal) => {
    context.stopped = true;
    context.signalCode = SIGNAL_EXIT_CODES[signal];
    for (const child of context.children) {
      try {
        child.kill(signal);
      } catch {}
    }
  };
  const onSigint = () => stop('SIGINT');
  const onSigterm = () => stop('SIGTERM');
  signalSource.once('SIGINT', onSigint);
  signalSource.once('SIGTERM', onSigterm);
  try {
    const results = await Promise.all(jobs.map((job) => runJob(job, context)));
    const failed = results.find((result) => !result.ok);
    return { ok: !failed, exitCode: failed ? failed.exitCode : 0, results };
  } finally {
    signalSource.removeListener('SIGINT', onSigint);
    signalSource.removeListener('SIGTERM', onSigterm);
  }
}

module.exports = { createLinePrefixer, runParallel };
