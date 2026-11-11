// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs,
  validateCommandFlags,
  validateFrameworkOptions,
  validateProjectName,
} = require('../src/utils/args');

test('parseArgs reads target and project presets', () => {
  const result = parseArgs(['next', 'my-app', '--typescript', '--pnpm', '--no-git', '--eslint']);
  assert.equal(result.command, 'next');
  assert.deepEqual(result.options, {
    dryRun: false,
    coldBoot: false,
    shutdownAll: false,
    clear: false,
    project: undefined,
    target: 'my-app',
    typescript: true,
    packageManager: 'pnpm',
    git: false,
    eslint: true,
    noInstall: false,
    python: undefined,
    editor: undefined,
    opener: undefined,
    list: false,
    json: false,
    fix: false,
    yes: false,
    filter: undefined,
    search: undefined,
    values: {},
  });
  assert.deepEqual(result.positionals, ['my-app']);
});

test('parseArgs reads workspace, JSON, fix, search, and trust options', () => {
  const lint = parseArgs(['lint', '--filter', '@acme/web', '--fix']);
  assert.equal(lint.options.filter, '@acme/web');
  assert.equal(lint.options.fix, true);
  assert.equal(parseArgs(['inspect', '--json']).options.json, true);
  assert.equal(parseArgs(['history', '--search', 'next']).options.search, 'next');
  assert.equal(parseArgs(['trust', '-y']).options.yes, true);
  assert.throws(() => parseArgs(['test', '--filter']), /--filter requires/);
  assert.throws(() => parseArgs(['test', '--filter', '../outside']), /--filter requires/);
  assert.throws(() => parseArgs(['test', '--filter', '-rf']), /--filter requires/);
  assert.throws(() => parseArgs(['history', '--search']), /--search requires/);
});

test('command flag validation limits new options to their commands', () => {
  const check = (argv) => {
    const { command, options } = parseArgs(argv);
    validateCommandFlags(command, options);
  };
  assert.doesNotThrow(() => check(['test', '--filter', 'web']));
  assert.doesNotThrow(() => check(['lint', '--fix']));
  assert.doesNotThrow(() => check(['doctor', '--json']));
  assert.throws(() => check(['install', '--filter', 'web']), /--filter is only supported/);
  assert.throws(() => check(['test', '--fix']), /--fix is only supported/);
  assert.throws(() => check(['build', '--json']), /--json is only supported/);
  assert.throws(() => check(['run', '--search', 'x']), /--search is only supported/);
  assert.throws(() => check(['run', '--yes']), /--yes is only supported/);
});

test('parseArgs supports long package manager option', () => {
  const result = parseArgs(['react', 'app', '--package-manager', 'yarn', '--dry-run']);
  assert.equal(result.options.packageManager, 'yarn');
  assert.equal(result.options.dryRun, true);
});

test('parseArgs rejects unsupported and incomplete options', () => {
  assert.throws(() => parseArgs(['react', 'app', '--unknown']), /Unsupported option/);
  assert.throws(() => parseArgs(['react', 'app', '--package-manager', 'invalid']), /must be one of/);
  assert.throws(() => parseArgs(['react', 'app', '--pm']), /Package manager must be one of/);
  assert.deepEqual(parseArgs(['config', 'set', 'editor', 'code']).positionals, ['set', 'editor', 'code']);
});

test('parseArgs reads install, Python, and editor options', () => {
  assert.equal(parseArgs(['fastapi', 'api', '--no-install']).options.noInstall, true);
  assert.equal(parseArgs(['django', 'app', '--python', 'python3.13']).options.python, 'python3.13');
  assert.equal(parseArgs(['open', '--editor', 'cursor']).options.editor, 'cursor');
  assert.equal(parseArgs(['open', './app', '--with', 'pycharm']).options.opener, 'pycharm');
  assert.equal(parseArgs(['open', '--list']).options.list, true);
  assert.throws(() => parseArgs(['django', 'app', '--python']), /requires/);
  assert.deepEqual(
    parseArgs(['react', 'app', '--set', 'module=example.com/app']).options.values,
    { module: 'example.com/app' }
  );
  assert.throws(() => parseArgs(['react', 'app', '--set', 'invalid']), /name=value/);
  assert.throws(() => parseArgs(['open', '--with']), /requires an opener/);
});

test('command flag validation limits device flags', () => {
  const base = parseArgs(['react', 'app']).options;
  assert.throws(
    () => validateCommandFlags('react', { ...base, coldBoot: true }),
    /only supported by the android command/
  );
  assert.throws(() => validateCommandFlags('react', { ...base, list: true }), /open command/);
  assert.throws(
    () => validateCommandFlags('open', { ...base, editor: 'code', opener: 'cursor' }),
    /cannot be used together/
  );
  assert.throws(
    () => validateCommandFlags('android', { ...base, shutdownAll: true }),
    /only supported by the ios command/
  );
});

test('framework validation enforces capabilities', () => {
  assert.throws(
    () => validateFrameworkOptions('flutter', { typescript: true }),
    /does not support selecting TypeScript/
  );
  assert.throws(
    () => validateFrameworkOptions('react_native_cli', { packageManager: 'pnpm' }),
    /supports package managers: npm, yarn/
  );
  assert.doesNotThrow(() =>
    validateFrameworkOptions('next', {
      typescript: true,
      packageManager: 'npm',
      git: true,
      eslint: true,
    })
  );
  assert.throws(() => validateFrameworkOptions('django', { noInstall: true }), /does not support/);
  assert.throws(() => validateFrameworkOptions('react', { python: 'python3' }), /does not support/);
});

test('project name validation rejects shell metacharacters', () => {
  assert.doesNotThrow(() => validateProjectName('safe-app_1.0'));
  assert.throws(() => validateProjectName('app;rm -rf'), /Invalid project name/);
  assert.throws(() => validateProjectName(''), /required/);
});
