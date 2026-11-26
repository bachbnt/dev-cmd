// Copyright (c) 2026 bachbnt

const os = require('os');
const path = require('path');
const builtInRecipes = require('./built-ins.json');
const { createFileLoaders } = require('../registry/files');
const { validateRecipe } = require('./schema');

function attachSource(recipe, source, baseDir) {
  return { ...recipe, source, baseDir };
}

function loadBuiltInRecipes() {
  return builtInRecipes.map((recipe) => attachSource(validateRecipe(recipe), 'built-in', __dirname));
}

const { loadDirectory: loadRecipeDirectory, loadFile: loadRecipeFile } = createFileLoaders({
  noun: 'recipe',
  validate: validateRecipe,
  attach: attachSource,
});

function createRegistry(recipes) {
  const registry = new Map();
  for (const recipe of recipes) registry.set(recipe.name, recipe);
  return registry;
}

function loadRecipeRegistry(options = {}) {
  const home = options.home || os.homedir();
  const userDirectory = options.userDirectory || path.join(home, '.devcmd', 'recipes');
  const builtIns = options.builtIns || loadBuiltInRecipes();
  const userRecipes = options.includeUser === false
    ? []
    : loadRecipeDirectory(userDirectory, 'user', options);
  return createRegistry([...builtIns, ...userRecipes]);
}

function getRecipeDefinitions(registry) {
  return Object.fromEntries(
    [...registry.entries()].map(([name, recipe]) => [name, {
      description: recipe.description,
      capabilities: recipe.capabilities || {},
      source: recipe.source,
    }])
  );
}

module.exports = {
  createRegistry,
  getRecipeDefinitions,
  loadBuiltInRecipes,
  loadRecipeDirectory,
  loadRecipeFile,
  loadRecipeRegistry,
};
