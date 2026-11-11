// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildLifecycleCommands, buildTaskCommands, listTasks } = require('../src/commands/lifecycle');
const { inspectProject } = require('../src/commands/inspect');
const { detectProject } = require('../src/projects/detect');
const { loadProfile, trustProfile, validateProfile } = require('../src/projects/profile');

const PROFILE = {
  tasks: {
    seed: {
      description: 'Seed data',
      commands: [{ type: 'run', executable: 'node', args: ['seed.js', '{root}'] }],
    },
  },
  lifecycle: {
    run: [{ type: 'run', executable: 'make', args: ['serve'], cwd: '{root}' }],
  },
};

function createProject(profile = PROFILE, packageJson) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-profile-'));
  fs.writeFileSync(path.join(root, '.devcmd.json'), JSON.stringify(profile));
  if (packageJson) fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJson));
  const trustFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-trust-')), 'trusted.json');
  return { root, trustFile };
}

test('profile-only directories are detected as custom projects', () => {
  const { root } = createProject();
  const project = detectProject(root);
  assert.equal(project.type, 'custom');
  assert.equal(project.root, root);
  assert.ok(project.profile.tasks.seed);
});

test('profile validation rejects unsupported fields, actions, and non-run steps', () => {
  assert.throws(() => validateProfile({ extra: 1 }), /unsupported fields/);
  assert.throws(() => validateProfile({ lifecycle: { deploy: [] } }), /unsupported lifecycle action/);
  assert.throws(
    () => validateProfile({ lifecycle: { run: [{ type: 'write', path: 'a', content: 'b' }] } }),
    /must be "run"/
  );
  assert.throws(() => validateProfile({ tasks: { '-bad': [] } }), /invalid task name/);
  assert.throws(() => validateProfile({ tasks: { ok: [] } }), /non-empty array/);
  assert.doesNotThrow(() => validateProfile(PROFILE));
});

test('invalid profile JSON reports the file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-profile-bad-'));
  fs.writeFileSync(path.join(root, '.devcmd.json'), '{nope');
  assert.throws(() => loadProfile(root), /Invalid JSON in .*\.devcmd\.json/);
});

test('profile commands require trust and re-trust after the file changes', () => {
  const { root, trustFile } = createProject();
  const project = detectProject(root);
  assert.throws(
    () => buildLifecycleCommands('run', project, { config: {}, trustFile }),
    /not trusted/
  );
  trustProfile(project.profile, { trustFile });
  const [command] = buildLifecycleCommands('run', project, { config: {}, trustFile });
  assert.deepEqual(command, { executable: 'make', args: ['serve'], cwd: root });

  fs.writeFileSync(path.join(root, '.devcmd.json'), JSON.stringify({ ...PROFILE, name: 'changed' }));
  assert.throws(
    () => buildLifecycleCommands('run', detectProject(root), { config: {}, trustFile }),
    /not trusted/
  );
});

test('profile commands never run through a shell executable', () => {
  const { root, trustFile } = createProject({
    lifecycle: { run: [{ type: 'run', executable: 'bash', args: ['-c', 'echo hi'] }] },
  });
  const project = detectProject(root);
  trustProfile(project.profile, { trustFile });
  assert.throws(
    () => buildLifecycleCommands('run', project, { config: {}, trustFile }),
    /shell executables are not allowed/
  );
});

test('profile overrides one action and leaves other actions to the adapter', () => {
  const { root, trustFile } = createProject(PROFILE, {
    name: 'app',
    scripts: { test: 'node --test', build: 'tsc' },
  });
  const project = detectProject(root);
  trustProfile(project.profile, { trustFile });
  const [build] = buildLifecycleCommands('build', project, { config: {}, trustFile });
  assert.deepEqual(build.args, ['run', 'build']);
  const [run] = buildLifecycleCommands('run', project, { config: {}, trustFile });
  assert.equal(run.executable, 'make');
});

test('custom projects only support the actions the profile defines', () => {
  const { root, trustFile } = createProject();
  const project = detectProject(root);
  trustProfile(project.profile, { trustFile });
  assert.throws(
    () => buildLifecycleCommands('test', project, { config: {}, trustFile }),
    /not supported for detected project type: custom/
  );
});

test('tasks combine profile tasks and package.json scripts', () => {
  const { root, trustFile } = createProject(PROFILE, { name: 'app', scripts: { seed: 'x', start: 'y' } });
  const project = detectProject(root);
  trustProfile(project.profile, { trustFile });
  assert.deepEqual(
    listTasks(project).map((task) => [task.name, task.source]),
    [['seed', 'profile'], ['start', 'package.json']]
  );
  const [seed] = buildTaskCommands(project, 'seed', { config: {}, trustFile });
  assert.deepEqual(seed.args, ['seed.js', root]);
  const [start] = buildTaskCommands(project, 'start', { config: {}, trustFile });
  assert.deepEqual(start.args, ['run', 'start']);
  assert.throws(() => buildTaskCommands(project, 'missing', { config: {}, trustFile }), /Unknown task/);
});

test('inspect reports profile trust, workspaces, and tasks', () => {
  const { root, trustFile } = createProject();
  const project = detectProject(root);
  const before = inspectProject(project, { python: 'python3' }, undefined, { trustFile });
  assert.equal(before.profile.trusted, false);
  assert.match(before.actions.find((action) => action.action === 'run').reason, /not trusted/);
  trustProfile(project.profile, { trustFile });
  const after = inspectProject(project, { python: 'python3' }, undefined, { trustFile });
  assert.equal(after.profile.trusted, true);
  assert.equal(after.actions.find((action) => action.action === 'run').available, true);
  assert.deepEqual(after.tasks.map((task) => task.name), ['seed']);
});
