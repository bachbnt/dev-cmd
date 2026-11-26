// Copyright (c) 2026 bachbnt

// Shared test helpers. `node --test` also loads this file as a test file; it defines no tests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

// Runs git in `cwd` (a throwaway test repository) and returns trimmed stdout.
function git(cwd, args, env = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// A Git repository with one commit made at `commitDate`, with `.gitignore` listing `ignore`.
function gitRepo(dir, { files = {}, ignore = [], commitDate = '2020-01-01T00:00:00Z' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFile(path.join(dir, '.gitignore'), `${ignore.join('\n')}\n`);
  for (const [name, content] of Object.entries(files)) writeFile(path.join(dir, name), content);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init'], { GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate });
  return dir;
}

module.exports = {
  fakeClock, git, gitRepo, isolatedEnv, tempDir, tempHome, writeFile,
};
