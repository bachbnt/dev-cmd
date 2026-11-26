// Copyright (c) 2026 bachbnt

// Helpers shared by the log readers. A reader throws BROKEN from `readOptional*` when a field has
// the wrong type; the caller counts that line as skipped, like a line that is not JSON at all.

const BROKEN = Symbol('broken line');

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(\.\d+)?(z|[+-]\d{2}:\d{2})$/i;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw BROKEN;
  return value;
}

function optionalCount(value) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw BROKEN;
  return value;
}

function optionalObject(value) {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw BROKEN;
  return value;
}

// RFC 3339 timestamp to milliseconds since the epoch, or undefined.
function parseTime(text) {
  if (typeof text !== 'string' || !TIMESTAMP.test(text)) return undefined;
  const ms = Date.parse(text.toUpperCase());
  return Number.isNaN(ms) ? undefined : ms;
}

// The last folder name of a path, for the project column. Handles / and \ separators.
function projectName(cwd) {
  const name = String(cwd ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return name || '(unknown)';
}

module.exports = {
  BROKEN,
  isObject,
  optionalCount,
  optionalObject,
  optionalString,
  parseTime,
  projectName,
};
