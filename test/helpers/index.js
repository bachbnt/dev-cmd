// Copyright (c) 2026 bachbnt

// Shared test helpers. `node --test` also loads this file as a test file; it defines no tests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tempDir(prefix = 'devcmd-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Writes a file (creating parent directories). Objects are stored as JSON.
function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

// A throwaway home directory. HOME and USERPROFILE are both set because Windows uses USERPROFILE.
function tempHome(prefix = 'devcmd-home-') {
  const home = tempDir(prefix);
  return { home, env: { ...process.env, HOME: home, USERPROFILE: home } };
}

function isolatedEnv(overrides = {}) {
  return { ...tempHome().env, ...overrides };
}

// A fixed clock: `now()` returns the same Date every time unless advanced.
function fakeClock(start = '2026-01-15T12:00:00.000Z') {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance(milliseconds) {
      current += milliseconds;
    },
  };
}

module.exports = { fakeClock, isolatedEnv, tempDir, tempHome, writeFile };
