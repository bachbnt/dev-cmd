// Copyright (c) 2026 bachbnt

const os = require('node:os');
const path = require('node:path');
const builtIns = require('./built-ins.json');
const { createFileLoaders } = require('../registry/files');
const { validateOpener } = require('./schema');

function attachSource(opener, source, baseDir) {
  return { target: 'project', ...opener, source, baseDir };
}

function loadBuiltInOpeners() {
  return builtIns.map((opener) => attachSource(validateOpener(opener), 'built-in', __dirname));
}

const { loadDirectory: loadOpenerDirectory, loadFile: loadOpenerFile } = createFileLoaders({
  noun: 'opener',
  validate: validateOpener,
  attach: attachSource,
});

function createOpenerRegistry(openers) {
  const registry = new Map();
  for (const opener of openers) registry.set(opener.name, opener);

  const names = new Map([...registry.keys()].map((name) => [name, name]));
  for (const opener of registry.values()) {
    for (const alias of opener.aliases || []) {
      const owner = names.get(alias);
      if (owner && owner !== opener.name) {
        throw new Error(`Opener alias ${alias} conflicts with opener: ${owner}`);
      }
      names.set(alias, opener.name);
    }
  }
  return registry;
}

function loadOpenerRegistry(options = {}) {
  const home = options.home || os.homedir();
  const userDirectory = options.userDirectory || path.join(home, '.devcmd', 'openers');
  const builtInOpeners = options.builtIns || loadBuiltInOpeners();
  const userOpeners = options.includeUser === false
    ? []
    : loadOpenerDirectory(userDirectory, 'user', options);
  return createOpenerRegistry([...builtInOpeners, ...userOpeners]);
}

function resolveOpener(registry, name) {
  if (!name) return undefined;
  if (registry.has(name)) return registry.get(name);
  return [...registry.values()].find((opener) => (opener.aliases || []).includes(name));
}

module.exports = {
  createOpenerRegistry,
  loadBuiltInOpeners,
  loadOpenerDirectory,
  loadOpenerFile,
  loadOpenerRegistry,
  resolveOpener,
};
