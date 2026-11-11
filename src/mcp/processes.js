// Copyright (c) 2026 bachbnt

const { spawn } = require('child_process');
const { formatSequence } = require('../runner/command');
const { SIGNAL_EXIT_CODES } = require('../runner/process');

const DEFAULT_MAX_LOG_BYTES = 256 * 1024;
const DEFAULT_KILL_GRACE_MS = 3000;

class ProcessManager {
  constructor(options = {}) {
    this.spawnImpl = options.spawnImpl || spawn;
    this.maxLogBytes = options.maxLogBytes || DEFAULT_MAX_LOG_BYTES;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.entries = new Map();
    this.counter = 0;
  }

  start({ label, commands }) {
    this.counter += 1;
    const entry = {
      id: `p${this.counter}`,
      label,
      commandLine: formatSequence(commands),
      status: 'running',
      exitCode: undefined,
      startedAt: new Date().toISOString(),
      log: '',
      droppedChars: 0,
      child: undefined,
      stopRequested: false,
    };
    entry.done = new Promise((resolve) => {
      entry.resolveDone = resolve;
    });
    this.entries.set(entry.id, entry);
    this.runNext(entry, commands, 0);
    return this.summary(entry);
  }

  runNext(entry, commands, index) {
    if (entry.stopRequested) return this.finish(entry, 'stopped', undefined);
    if (index >= commands.length) return this.finish(entry, 'exited', 0);
    const command = commands[index];
    let child;
    try {
      const spawnOptions = { shell: false, stdio: ['ignore', 'pipe', 'pipe'] };
      if (command.cwd) spawnOptions.cwd = command.cwd;
      child = this.spawnImpl(command.executable, command.args, spawnOptions);
    } catch (error) {
      this.append(entry, `${error.message}\n`);
      return this.finish(entry, 'failed', error.code === 'ENOENT' ? 127 : 1);
    }
    entry.child = child;
    child.stdout?.on('data', (data) => this.append(entry, data));
    child.stderr?.on('data', (data) => this.append(entry, data));
    let settled = false;
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      entry.child = undefined;
      callback();
    };
    child.once('error', (error) => settle(() => {
      this.append(entry, `${error.message}\n`);
      this.finish(entry, 'failed', error.code === 'ENOENT' ? 127 : 1);
    }));
    child.once('close', (code, signal) => settle(() => {
      if (entry.stopRequested) this.finish(entry, 'stopped', code ?? SIGNAL_EXIT_CODES[signal]);
      else if (signal) this.finish(entry, 'failed', SIGNAL_EXIT_CODES[signal] || 1);
      else if (code === 0) this.runNext(entry, commands, index + 1);
      else this.finish(entry, 'failed', code ?? 1);
    }));
  }

  append(entry, data) {
    entry.log += data.toString();
    if (entry.log.length > this.maxLogBytes) {
      const excess = entry.log.length - this.maxLogBytes;
      entry.log = entry.log.slice(excess);
      entry.droppedChars += excess;
    }
  }

  finish(entry, status, exitCode) {
    entry.status = status;
    entry.exitCode = exitCode;
    entry.endedAt = new Date().toISOString();
    entry.resolveDone();
  }

  get(id) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown process id: ${id}. Use list_processes to see running processes.`);
    return entry;
  }

  summary(entry) {
    return {
      id: entry.id,
      label: entry.label,
      command: entry.commandLine,
      status: entry.status,
      exitCode: entry.exitCode,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    };
  }

  list() {
    return [...this.entries.values()].map((entry) => this.summary(entry));
  }

  logs(id, options = {}) {
    const entry = this.get(id);
    const tail = Number.isInteger(options.tail) && options.tail > 0 ? options.tail : 100;
    const lines = entry.log.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return {
      ...this.summary(entry),
      truncated: entry.droppedChars > 0 || lines.length > tail,
      output: lines.slice(-tail).join('\n'),
    };
  }

  async stop(id) {
    const entry = this.get(id);
    if (entry.status !== 'running') return this.summary(entry);
    entry.stopRequested = true;
    const child = entry.child;
    if (child) {
      try {
        child.kill('SIGTERM');
      } catch {}
      const timer = setTimeout(() => {
        try {
          if (entry.status === 'running') child.kill('SIGKILL');
        } catch {}
      }, this.killGraceMs);
      timer.unref?.();
      await Promise.race([
        entry.done,
        new Promise((resolve) => {
          const wait = setTimeout(resolve, this.killGraceMs + 1000);
          wait.unref?.();
        }),
      ]);
      clearTimeout(timer);
    }
    return this.summary(entry);
  }

  stopAll() {
    for (const entry of this.entries.values()) {
      if (entry.status !== 'running') continue;
      entry.stopRequested = true;
      try {
        entry.child?.kill('SIGTERM');
      } catch {}
    }
  }
}

module.exports = { ProcessManager };
