// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TOOLS, callTool } = require('../src/mcp/server');
const { tempDir } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures', 'ai');

function homeWithLogs() {
  const home = tempDir();
  fs.cpSync(path.join(FIXTURES, 'claude'), path.join(home, '.claude', 'projects'), { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'codex'), path.join(home, '.codex', 'sessions'), { recursive: true });
  return home;
}

test('MCP exposes ai_cost, read only, and no tool that deletes, cleans or elevates', () => {
  const names = TOOLS.map((tool) => tool.name);
  assert.ok(names.includes('ai_cost'));
  assert.deepEqual(names.filter((name) => /prune|disk|delete|remove|clean|elevate|sudo|uninstall/i.test(name)), []);
  const tool = TOOLS.find((candidate) => candidate.name === 'ai_cost');
  assert.deepEqual(tool.inputSchema.properties.group_by.enum, ['day', 'week', 'month', 'model', 'tool']);
});

test('ai_cost returns totals without project, session, branch, client names or file paths', async () => {
  const home = homeWithLogs();
  const result = await callTool('ai_cost', { period: 'month', group_by: 'model' }, { homeDir: home, config: {} });
  assert.equal(result.isError, undefined);
  const data = JSON.parse(result.content[0].text);
  assert.deepEqual(Object.keys(data), ['group_by', 'since', 'until', 'rows', 'total', 'unpriced']);
  assert.equal(data.group_by, 'model');
  const text = result.content[0].text;
  assert.doesNotMatch(text, /demo-app|sess-a|other|\.jsonl|unreadable|\/home\/u/);
});

test('ai_cost refuses groupings that would reveal names, and unknown input', async () => {
  const home = homeWithLogs();
  for (const group of ['project', 'session', 'branch', 'client']) {
    const result = await callTool('ai_cost', { group_by: group }, { homeDir: home, config: {} });
    assert.equal(result.isError, true, group);
    assert.match(result.content[0].text, /group_by must be one of/);
  }
  assert.equal((await callTool('ai_cost', { period: 'year' }, { homeDir: home, config: {} })).isError, true);
  assert.equal((await callTool('ai_cost', { tool: 'vim' }, { homeDir: home, config: {} })).isError, true);
});

test('ai_cost writes nothing: no daily history, no scan cache', async () => {
  const home = homeWithLogs();
  await callTool('ai_cost', { period: 'month' }, { homeDir: home, config: {} });
  assert.equal(fs.existsSync(path.join(home, '.devcmd')), false);
});
