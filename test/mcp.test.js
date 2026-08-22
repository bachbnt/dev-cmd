// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { callTool } = require('../src/mcp/server');

function text(result) {
  return result.content[0].text;
}

test('MCP lifecycle dry run uses configured Python for Python projects', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-mcp-python-'));
  fs.writeFileSync(path.join(root, 'pyproject.toml'), 'dependencies = ["fastapi>=0.115"]');

  const result = await callTool(
    'run_lifecycle',
    { action: 'run', path: root, dryRun: true },
    { config: { python: 'python3.13' } }
  );

  assert.match(text(result), /python3\.13 -m fastapi dev app\/main\.py/);
});
