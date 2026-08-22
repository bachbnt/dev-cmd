// Copyright (c) 2026 bachbnt

const { spawn } = require('child_process');
const { SIGNAL_EXIT_CODES } = require('./process');

function runProcessCaptured(command, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const maxOutputBytes = Number.isInteger(options.maxOutputBytes) && options.maxOutputBytes >= 0
    ? options.maxOutputBytes
    : Infinity;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 0;
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let outputTruncated = false;
    let exitResult;
    let timedOut = false;
    let child;
    let timer;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, stdout, stderr, outputTruncated });
    };

    const appendOutput = (stream, data) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
      const remaining = maxOutputBytes - outputBytes;
      if (remaining <= 0) {
        if (buffer.length > 0) outputTruncated = true;
        return;
      }
      const chunkBuffer = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      const chunk = chunkBuffer.toString();
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
      outputBytes += chunkBuffer.length;
      if (chunkBuffer.length < buffer.length) outputTruncated = true;
    };

    try {
      const spawnOptions = { shell: false, stdio: 'pipe' };
      if (command.cwd) spawnOptions.cwd = command.cwd;
      child = spawnImpl(command.executable, command.args, spawnOptions);
    } catch (error) {
      finish({ ok: false, exitCode: error.code === 'ENOENT' ? 127 : 1, error });
      return;
    }

    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          if (child && !child.killed) child.kill('SIGTERM');
        } catch {}
        finish({
          ok: false,
          exitCode: SIGNAL_EXIT_CODES.SIGTERM || 143,
          signal: 'SIGTERM',
          timedOut: true,
        });
      }, timeoutMs);
    }

    child.stdout?.on('data', (data) => appendOutput('stdout', data));
    child.stderr?.on('data', (data) => appendOutput('stderr', data));

    child.once('error', (error) => {
      finish({ ok: false, exitCode: error.code === 'ENOENT' ? 127 : 1, error });
    });
    child.once('exit', (code, signal) => {
      if (signal) {
        exitResult = {
          ok: false,
          exitCode: SIGNAL_EXIT_CODES[signal] || 1,
          signal,
          timedOut,
        };
        if (!child.stdout && !child.stderr) finish(exitResult);
        return;
      }
      exitResult = { ok: code === 0, exitCode: code ?? 1 };
      if (!child.stdout && !child.stderr) finish(exitResult);
    });
    child.once('close', (code, signal) => {
      if (exitResult) {
        finish(exitResult);
        return;
      }
      if (signal) {
        finish({ ok: false, exitCode: SIGNAL_EXIT_CODES[signal] || 1, signal, timedOut });
        return;
      }
      finish({ ok: code === 0, exitCode: code ?? 1 });
    });
  });
}

async function runSequenceCaptured(commands, options = {}) {
  let output = '';
  let outputTruncated = false;
  for (let index = 0; index < commands.length; index += 1) {
    const remaining = Number.isInteger(options.maxOutputBytes) && options.maxOutputBytes >= 0
      ? Math.max(options.maxOutputBytes - output.length, 0)
      : undefined;
    const result = await runProcessCaptured(commands[index], {
      ...options,
      maxOutputBytes: remaining,
    });
    output += result.stdout + result.stderr;
    outputTruncated ||= result.outputTruncated;
    if (!result.ok) {
      return { ...result, output, outputTruncated, failedCommand: commands[index], failedIndex: index };
    }
  }
  return { ok: true, exitCode: 0, output, outputTruncated };
}

module.exports = { runProcessCaptured, runSequenceCaptured };
