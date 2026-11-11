// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

const root = path.join(__dirname, '..');

test('package is published as the public scoped package with both binaries', () => {
  assert.equal(packageJson.name, '@bachbntdev/devcmd');
  assert.deepEqual(packageJson.publishConfig, { access: 'public' });
  assert.deepEqual(packageJson.bin, { dev: './dev', devcmd: './dev' });
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.packages[''].name, packageJson.name);
  assert.deepEqual(packageJson.files, ['dev', 'src']);
});

test('the binary Node.js check matches the declared engine range', () => {
  const binary = fs.readFileSync(path.join(root, 'dev'), 'utf8');
  const minimum = packageJson.engines.node.replace(/^>=/, '');
  assert.match(binary, new RegExp(`MIN_NODE_VERSION = '${minimum.replace(/\./g, '\\.')}'`));
});

test('update and README installation use the scoped package name', () => {
  const system = fs.readFileSync(path.join(root, 'src', 'handlers', 'system.js'), 'utf8');
  assert.match(system, /@bachbntdev\/devcmd@latest/);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /npm install --global @bachbntdev\/devcmd/);
  assert.match(readme, /npx -y @bachbntdev\/devcmd mcp/);
  assert.doesNotMatch(readme, /npm install --global devcmd\b/);
});

test('CI covers supported Node.js majors and publishing verifies the release tag', () => {
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  for (const major of ['20.x', '22.x', '24.x']) assert.match(ci, new RegExp(major.replace('.', '\\.')));
  const publish = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish.yml'), 'utf8');
  assert.match(publish, /RELEASE_TAG: \$\{\{ github\.event\.release\.tag_name \}\}/);
  assert.match(publish, /npm publish --provenance --access public/);
  assert.doesNotMatch(publish, /run: .*\$\{\{ github\.event/);
});
