// Copyright (c) 2026 bachbnt

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parse } = require('smol-toml');

// Prices per model and the arithmetic from tokens to dollars. The price file format and the
// matching rules are the same as aicost's, so one file works for both.

const BUILT_IN_FILE = path.join(__dirname, 'data', 'pricing.toml');
const PER_TOKENS = 1_000_000;
const ENTRY_FIELDS = new Set(['match', 'input', 'output', 'cache_read', 'cache_write_5m', 'cache_write_1h', 'source', 'note']);
const OPTIONAL_PRICES = ['cache_read', 'cache_write_5m', 'cache_write_1h'];

function normalize(model) {
  const lower = String(model).trim().toLowerCase();
  const bracket = lower.indexOf('[');
  return bracket === -1 ? lower : lower.slice(0, bracket).trimEnd();
}

// A name matches exactly, or followed by an 8 digit date stamp. Never a longer version number.
function matchesModel(name, model) {
  if (!model.startsWith(name)) return false;
  const rest = model.slice(name.length);
  if (rest === '') return true;
  return /^[-@]\d{8}$/.test(rest);
}

function isPrice(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toEntry(raw, label) {
  for (const field of Object.keys(raw)) {
    if (!ENTRY_FIELDS.has(field)) throw new Error(`${label}: unknown field "${field}" in [[model]]`);
  }
  if (typeof raw.match !== 'string' || !raw.match.trim()) throw new Error(`${label}: every [[model]] needs a "match" name`);
  if (!isPrice(raw.input) || !isPrice(raw.output)) throw new Error(`${label}: ${raw.match}: input and output must be numbers`);
  for (const field of OPTIONAL_PRICES) {
    if (raw[field] !== undefined && !isPrice(raw[field])) throw new Error(`${label}: ${raw.match}: ${field} must be a number`);
  }
  return {
    name: normalize(raw.match),
    label: raw.match,
    source: typeof raw.source === 'string' ? raw.source : undefined,
    price: {
      input: raw.input,
      output: raw.output,
      cache_read: raw.cache_read ?? raw.input,
      cache_write_5m: raw.cache_write_5m ?? raw.input,
      cache_write_1h: raw.cache_write_1h ?? raw.input,
    },
  };
}

class PriceTable {
  constructor() {
    this.entries = [];
    this.lookups = new Map();
    this.updated = undefined;
  }

  static fromToml(text, label = 'pricing') {
    let parsed;
    try {
      parsed = parse(text);
    } catch (error) {
      throw new Error(`${label}: ${error.message}`);
    }
    const table = new PriceTable();
    const models = parsed.model ?? [];
    if (!Array.isArray(models)) throw new Error(`${label}: "model" must be a list of [[model]] tables`);
    for (const raw of models) table.set(toEntry(raw, label));
    return table;
  }

  static builtIn() {
    const text = fs.readFileSync(BUILT_IN_FILE, 'utf8');
    const table = PriceTable.fromToml(text, 'built-in pricing');
    table.updated = /^# PRICES-UPDATED: (\d{4}-\d{2}-\d{2})$/m.exec(text)?.[1];
    return table;
  }

  mergeFile(file) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read pricing file ${file}: ${error.message}`);
    }
    for (const entry of PriceTable.fromToml(text, file).entries) this.set(entry);
  }

  set(entry) {
    this.lookups.clear();
    const index = this.entries.findIndex((existing) => existing.name === entry.name);
    if (index === -1) this.entries.push(entry);
    else this.entries[index] = entry;
  }

  price(model) {
    if (this.lookups.has(model)) return this.lookups.get(model);
    const wanted = normalize(model);
    const price = this.entries.find((entry) => matchesModel(entry.name, wanted))?.price;
    this.lookups.set(model, price);
    return price;
  }

  // Dollars for the tokens, or undefined when the model has no price (never zero).
  cost(model, tokens) {
    const price = this.price(model);
    if (!price) return undefined;
    return (
      tokens.input * price.input
      + tokens.output * price.output
      + tokens.cache_read * price.cache_read
      + tokens.cache_write_5m * price.cache_write_5m
      + tokens.cache_write_1h * price.cache_write_1h
    ) / PER_TOKENS;
  }

  // The cost of one request: what the tool reported when it reports one (Copilot, OpenCode),
  // otherwise tokens times the price table. undefined means no price.
  costOf(usage) {
    return usage.reportedCost !== undefined ? usage.reportedCost : this.cost(usage.model, usage.tokens);
  }

  get size() {
    return this.entries.length;
  }

  // Short fingerprint of the effective prices, stored with snapshots so a price change is visible.
  get version() {
    return crypto.createHash('sha1').update(JSON.stringify(this.entries)).digest('hex').slice(0, 10);
  }
}

// Built-in prices, then the user's file (~/.config/aicost/pricing.toml), then an explicit file.
function loadPriceTable({ homeDir, extraFile } = {}) {
  const table = PriceTable.builtIn();
  if (homeDir) {
    const user = path.join(homeDir, '.config', 'aicost', 'pricing.toml');
    if (fs.existsSync(user)) table.mergeFile(user);
  }
  if (extraFile) table.mergeFile(extraFile);
  return table;
}

module.exports = { PriceTable, loadPriceTable, matchesModel, normalize };
