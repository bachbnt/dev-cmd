// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildLifecycleCommands } = require('../src/commands/lifecycle');
const { detectProject } = require('../src/projects/detect');
const {
  buildRecipeCommands,
  getRecipeDefinitions,
  getRecipeRequirements,
  loadBuiltInRecipes,
  loadRecipeRegistry,
  validateRecipe,
} = require('../src/recipes');

const builtInNames = [
  'flutter',
  'react',
  'react_native',
  'react_native_cli',
  'next',
  'vue',
  'angular',
  'express',
  'nest',
  'django',
  'fastapi',
  'flask',
];

function customRecipe(overrides = {}) {
  return {
    name: 'custom_api',
    description: 'Custom API recipe',
    capabilities: { git: false },
    inputs: {
      module: { description: 'Module name', required: true },
    },
    requirements: ['node'],
    actions: [
      { type: 'mkdir', path: '.' },
      { type: 'write', path: 'module.txt', content: '{module}\n' },
      { type: 'run', executable: 'node', args: ['--version'], cwd: '{target}' },
    ],
    ...overrides,
  };
}

test('built-in frameworks are loaded from validated recipes', () => {
  const recipes = loadBuiltInRecipes();
  assert.deepEqual(recipes.map((recipe) => recipe.name), builtInNames);
  assert.ok(recipes.every((recipe) => recipe.source === 'built-in'));
  assert.deepEqual(Object.keys(getRecipeDefinitions(new Map(recipes.map((item) => [item.name, item])))), builtInNames);
});

test('user recipes override built-ins without adding built-in frameworks', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-recipes-'));
  const directory = path.join(home, '.devcmd', 'recipes');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'react.json'), JSON.stringify(customRecipe({
    name: 'react',
    inputs: {},
    actions: [{ type: 'run', executable: 'node', args: ['--version'] }],
  })));

  const registry = loadRecipeRegistry({ home });
  assert.equal(registry.size, builtInNames.length);
  assert.equal(registry.get('react').source, 'user');
  assert.equal(registry.get('next').source, 'built-in');
});

test('custom recipes resolve inputs and safe file actions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-recipe-actions-'));
  const target = path.join(root, 'app');
  const recipe = { ...validateRecipe(customRecipe()), source: 'user', baseDir: root };
  const commands = buildRecipeCommands(recipe, target, {
    values: { module: 'example.com/app' },
  });

  assert.equal(commands.length, 3);
  assert.equal(commands[0].executable, process.execPath);
  assert.deepEqual(commands[2], {
    executable: 'node',
    args: ['--version'],
    cwd: target,
  });
  assert.deepEqual(getRecipeRequirements(recipe, target, {
    values: { module: 'example.com/app' },
  }), ['node']);

  for (const command of commands.slice(0, 2)) {
    const result = spawnSync(command.executable, command.args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(fs.readFileSync(path.join(target, 'module.txt'), 'utf8'), 'example.com/app\n');
});

test('recipe validation rejects shell fields, reserved names, and unsafe paths', () => {
  assert.throws(
    () => validateRecipe(customRecipe({
      actions: [{ type: 'run', executable: 'node', args: [], shell: true }],
    })),
    /unsupported run fields/
  );
  assert.throws(() => validateRecipe(customRecipe({ name: 'build' })), /reserved/);
  assert.throws(() => validateRecipe(customRecipe({ name: 'openers' })), /reserved/);
  assert.throws(
    () => validateRecipe(customRecipe({ capabilities: { packageManager: ['invalid'] } })),
    /supported managers/
  );
  assert.throws(
    () => validateRecipe(customRecipe({ inputs: { target: { required: true } } })),
    /input is reserved/
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-recipe-escape-'));
  const recipe = {
    ...validateRecipe(customRecipe({
      inputs: {},
      actions: [{ type: 'write', path: '../escape.txt', content: 'unsafe' }],
    })),
    source: 'user',
    baseDir: root,
  };
  assert.throws(() => buildRecipeCommands(recipe, path.join(root, 'app')), /inside the target/);

  const shellRecipe = {
    ...validateRecipe(customRecipe({
      inputs: {},
      actions: [{ type: 'run', executable: 'sh', args: ['-c', 'echo unsafe'] }],
    })),
    source: 'user',
    baseDir: root,
  };
  assert.throws(() => buildRecipeCommands(shellRecipe, path.join(root, 'app')), /shell executables/);
});

test('custom recipe appears as a CLI command without modifying source', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-recipe-home-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-recipe-cli-'));
  const directory = path.join(home, '.devcmd', 'recipes');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'custom-api.json'), JSON.stringify(customRecipe({
    actions: [{ type: 'run', executable: 'node', args: ['--version', '{module}'] }],
  })));

  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'dev'),
    'custom_api',
    'demo',
    '--set',
    'module=example.com/demo',
    '--dry-run',
  ], {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node --version example\.com\/demo/);
  assert.equal(fs.existsSync(path.join(workspace, 'demo')), false);
});

test('custom recipe can detect projects and provide lifecycle commands', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-recipe-lifecycle-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-recipe-lifecycle-project-'));
  const directory = path.join(home, '.devcmd', 'recipes');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'custom-api.json'), JSON.stringify(customRecipe({
    inputs: {},
    detect: { priority: 10, rules: [{ files: ['custom.recipe'] }] },
    lifecycle: {
      run: [{ type: 'run', executable: 'node', args: ['server.js'], cwd: '{root}' }],
      test: [{ type: 'run', executable: 'node', args: ['--test'], cwd: '{root}' }],
    },
  })));
  fs.writeFileSync(path.join(project, 'custom.recipe'), 'custom-api\n');

  const registry = loadRecipeRegistry({ home });
  const detected = detectProject(project, { registry });
  assert.equal(detected.type, 'custom_api');
  assert.equal(detected.recipe.source, 'user');
  assert.deepEqual(buildLifecycleCommands('run', detected, { config: { python: 'python3' } }), [
    { executable: 'node', args: ['server.js'], cwd: project },
  ]);
  assert.throws(
    () => buildLifecycleCommands('build', detected, { config: { python: 'python3' } }),
    /not supported/
  );
});

test('recipes command lists built-ins and validates an external file', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-recipes-command-home-'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd-recipes-command-'));
  const file = path.join(directory, 'custom.json');
  fs.writeFileSync(file, JSON.stringify(customRecipe()));
  const binary = path.join(__dirname, '..', 'dev');

  const list = spawnSync(process.execPath, [binary, 'recipes'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /react\s+\[built-in\]/);

  const installedDirectory = path.join(home, '.devcmd', 'recipes');
  fs.mkdirSync(installedDirectory, { recursive: true });
  fs.writeFileSync(path.join(installedDirectory, 'broken.json'), '{ broken json');

  const validate = spawnSync(process.execPath, [binary, 'recipes', 'validate', file], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
  assert.equal(validate.status, 0, validate.stderr);
  assert.match(validate.stdout, /custom_api: Custom API recipe/);
});
