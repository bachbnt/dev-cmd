// Copyright (c) 2026 bachbnt

const path = require('path');
const { loadConfig } = require('../config/user');
const { detectProject } = require('../projects/detect');
const { loadRecipeRegistry } = require('../recipes');
const { formatSequence } = require('../runner/command');
const { runSequenceCaptured } = require('../runner/captured');
const { ProcessManager } = require('./processes');

// Pieces shared by every tool domain: result shapes, common schema properties, and the helpers
// that load a project and run a command sequence with a timeout and an output limit.

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

const defaultProcesses = new ProcessManager();

const PATH_PROPERTY = { type: 'string', description: 'Project path (defaults to the server working directory).' };
const FILTER_PROPERTY = { type: 'string', description: 'Monorepo workspace name or directory (Node.js workspaces only).' };
const DRY_RUN_PROPERTY = { type: 'boolean', description: 'Return the resolved commands without executing them.' };
const TIMEOUT_PROPERTY = { type: 'integer', description: 'Maximum time to wait before terminating the process.' };
const OUTPUT_PROPERTY = { type: 'integer', description: 'Maximum captured output bytes to return.' };

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function jsonResult(value, isError = false) {
  return textResult(JSON.stringify(value, null, 2), isError);
}

function errorResult(message) {
  return textResult(`Error: ${message}`, true);
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function loadContext(args, environment) {
  const root = args.path ? path.resolve(args.path) : process.cwd();
  const registry = loadRecipeRegistry({ includeUser: true });
  const config = environment.config || loadConfig();
  const project = detectProject(root, { registry });
  return { project, config, registry, trustFile: environment.trustFile };
}

async function runCaptured(commands, args, defaultTimeout, extra = {}) {
  const preview = formatSequence(commands);
  if (args.dryRun) return jsonResult({ dryRun: true, command: preview, ...extra });
  const timeoutMs = positiveInteger(args.timeoutMs, defaultTimeout);
  const maxOutputBytes = Number.isInteger(args.maxOutputBytes) && args.maxOutputBytes >= 0
    ? args.maxOutputBytes
    : MAX_OUTPUT_BYTES;
  const result = await runSequenceCaptured(commands, { timeoutMs, maxOutputBytes });
  return jsonResult({
    ok: result.ok,
    exitCode: result.exitCode,
    command: preview,
    ...(result.failedCommand ? { failedCommand: formatSequence([result.failedCommand]) } : {}),
    timedOut: Boolean(result.timedOut),
    outputTruncated: Boolean(result.outputTruncated),
    output: result.output || '',
    ...extra,
  }, !result.ok);
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DRY_RUN_PROPERTY,
  FILTER_PROPERTY,
  MAX_OUTPUT_BYTES,
  OUTPUT_PROPERTY,
  PATH_PROPERTY,
  TIMEOUT_PROPERTY,
  defaultProcesses,
  errorResult,
  jsonResult,
  loadContext,
  positiveInteger,
  runCaptured,
  textResult,
};
