// Copyright (c) 2026 bachbnt

const { LIFECYCLE_COMMANDS, SYSTEM_COMMANDS, DEVICE_COMMANDS } = require('../constants');

const RECIPE_NAME = /^[a-z][a-z0-9_]*$/;
const INPUT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const ACTION_TYPES = new Set(['run', 'mkdir', 'write', 'copy']);
const CAPABILITIES = new Set(['language', 'packageManager', 'git', 'eslint', 'noInstall', 'python']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn']);
const RESERVED_RECIPES = new Set([...LIFECYCLE_COMMANDS, ...SYSTEM_COMMANDS, ...DEVICE_COMMANDS, 'help']);
const RESERVED_INPUTS = new Set([
  'target', 'packageManager', 'typescript', 'git', 'eslint', 'vueDefault', 'noInstall',
  'python', 'venvDirectory', 'projectPython', 'pythonGenerator',
]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function validateCondition(condition, label) {
  assertPlainObject(condition, label);
  if (!INPUT_NAME.test(condition.option || '')) {
    throw new Error(`${label}.option must be a valid option name.`);
  }
  const keys = Object.keys(condition);
  if (!keys.includes('equals') || keys.some((key) => !['option', 'equals'].includes(key))) {
    throw new Error(`${label} must contain only option and equals.`);
  }
}

function validateValueSpec(spec, label) {
  if (typeof spec === 'string') return;
  if (Array.isArray(spec)) {
    spec.forEach((item, index) => validateValueSpec(item, `${label}[${index}]`));
    return;
  }
  assertPlainObject(spec, label);
  if (Object.hasOwn(spec, 'value')) {
    const keys = Object.keys(spec);
    if (!spec.when || keys.some((key) => !['value', 'when'].includes(key))) {
      throw new Error(`${label} conditional value must contain only value and when.`);
    }
    validateCondition(spec.when, `${label}.when`);
    validateValueSpec(spec.value, `${label}.value`);
    return;
  }
  if (Object.hasOwn(spec, 'option')) {
    const keys = Object.keys(spec);
    if (!INPUT_NAME.test(spec.option || '') || !spec.map || keys.some((key) => !['option', 'map'].includes(key))) {
      throw new Error(`${label} option mapping must contain only a valid option and map.`);
    }
    assertPlainObject(spec.map, `${label}.map`);
    for (const [key, value] of Object.entries(spec.map)) {
      validateValueSpec(value, `${label}.map.${key}`);
    }
    return;
  }
  throw new Error(`${label} must be a string, array, conditional value, or option mapping.`);
}

function validateAction(action, index, prefix = 'actions') {
  const label = `${prefix}[${index}]`;
  assertPlainObject(action, label);
  if (!ACTION_TYPES.has(action.type)) throw new Error(`${label}.type is unsupported: ${action.type}`);
  if (action.when) validateCondition(action.when, `${label}.when`);

  if (action.type === 'run') {
    const allowed = ['type', 'executable', 'args', 'cwd', 'when'];
    if (Object.keys(action).some((key) => !allowed.includes(key))) {
      throw new Error(`${label} contains unsupported run fields.`);
    }
    validateValueSpec(action.executable, `${label}.executable`);
    if (!Array.isArray(action.args)) throw new Error(`${label}.args must be an array.`);
    action.args.forEach((arg, argIndex) => validateValueSpec(arg, `${label}.args[${argIndex}]`));
    if (action.cwd !== undefined) validateValueSpec(action.cwd, `${label}.cwd`);
    return;
  }

  const allowedByType = {
    mkdir: ['type', 'path', 'when'],
    write: ['type', 'path', 'content', 'when'],
    copy: ['type', 'source', 'destination', 'when'],
  };
  if (Object.keys(action).some((key) => !allowedByType[action.type].includes(key))) {
    throw new Error(`${label} contains unsupported ${action.type} fields.`);
  }
  if (action.type === 'mkdir') validateValueSpec(action.path, `${label}.path`);
  if (action.type === 'write') {
    validateValueSpec(action.path, `${label}.path`);
    validateValueSpec(action.content, `${label}.content`);
  }
  if (action.type === 'copy') {
    validateValueSpec(action.source, `${label}.source`);
    validateValueSpec(action.destination, `${label}.destination`);
  }
}

function validateDetect(detect, recipeName) {
  assertPlainObject(detect, `Recipe ${recipeName} detect`);
  if (Object.keys(detect).some((key) => !['priority', 'rules'].includes(key))) {
    throw new Error(`Recipe ${recipeName} detect contains unsupported fields.`);
  }
  if (detect.priority !== undefined && !Number.isInteger(detect.priority)) {
    throw new Error(`Recipe ${recipeName} detect priority must be an integer.`);
  }
  if (!Array.isArray(detect.rules) || detect.rules.length === 0) {
    throw new Error(`Recipe ${recipeName} detect rules must be a non-empty array.`);
  }
  detect.rules.forEach((rule, index) => {
    const label = `Recipe ${recipeName} detect.rules[${index}]`;
    assertPlainObject(rule, label);
    if (Object.keys(rule).some((key) => !['files', 'dependencies', 'contains'].includes(key))) {
      throw new Error(`${label} contains unsupported fields.`);
    }
    if (!rule.files && !rule.dependencies && !rule.contains) {
      throw new Error(`${label} must define files, dependencies, or contains.`);
    }
    for (const key of ['files', 'dependencies']) {
      if (rule[key] !== undefined && (
        !Array.isArray(rule[key]) ||
        rule[key].length === 0 ||
        rule[key].some((item) => typeof item !== 'string' || !item || pathIsUnsafe(item))
      )) {
        throw new Error(`${label}.${key} must contain safe relative names.`);
      }
    }
    if (rule.contains !== undefined) {
      assertPlainObject(rule.contains, `${label}.contains`);
      if (Object.entries(rule.contains).some(([file, text]) => pathIsUnsafe(file) || typeof text !== 'string' || !text)) {
        throw new Error(`${label}.contains must map safe relative files to non-empty text.`);
      }
    }
  });
}

function pathIsUnsafe(value) {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.split(/[\\/]/).includes('..');
}

function validateLifecycle(lifecycle, recipeName) {
  assertPlainObject(lifecycle, `Recipe ${recipeName} lifecycle`);
  const actionNames = new Set(LIFECYCLE_COMMANDS);
  if (lifecycle.adapter !== undefined) {
    if (Object.keys(lifecycle).length !== 1 || !RECIPE_NAME.test(lifecycle.adapter)) {
      throw new Error(`Recipe ${recipeName} lifecycle adapter must be a valid adapter name.`);
    }
    return;
  }
  if (Object.keys(lifecycle).length === 0) {
    throw new Error(`Recipe ${recipeName} lifecycle must define an adapter or actions.`);
  }
  for (const [action, actions] of Object.entries(lifecycle)) {
    if (!actionNames.has(action) || !Array.isArray(actions) || actions.length === 0) {
      throw new Error(`Recipe ${recipeName} lifecycle action is unsupported: ${action}`);
    }
    actions.forEach((item, index) => validateAction(item, index, `lifecycle.${action}`));
  }
}

function validateRecipe(recipe) {
  assertPlainObject(recipe, 'Recipe');
  const allowed = [
    'name', 'description', 'capabilities', 'inputs', 'requirements', 'actions', 'detect', 'lifecycle',
  ];
  const unknown = Object.keys(recipe).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`Recipe contains unsupported fields: ${unknown.join(', ')}`);
  if (!RECIPE_NAME.test(recipe.name || '')) {
    throw new Error('Recipe name must use lowercase letters, numbers, and underscores.');
  }
  if (RESERVED_RECIPES.has(recipe.name)) {
    throw new Error(`Recipe name is reserved by DevCmd: ${recipe.name}`);
  }
  if (typeof recipe.description !== 'string' || !recipe.description.trim()) {
    throw new Error(`Recipe ${recipe.name} requires a description.`);
  }

  assertPlainObject(recipe.capabilities || {}, `Recipe ${recipe.name} capabilities`);
  for (const [key, value] of Object.entries(recipe.capabilities || {})) {
    if (!CAPABILITIES.has(key)) throw new Error(`Recipe ${recipe.name} has unsupported capability: ${key}`);
    if (key === 'packageManager' && Array.isArray(value)) {
      if (value.length === 0 || value.some((item) => !PACKAGE_MANAGERS.has(item))) {
        throw new Error(`Recipe ${recipe.name} packageManager capability must list supported managers.`);
      }
    } else if (value !== true && value !== false) {
      throw new Error(`Recipe ${recipe.name} capability ${key} must be true or false.`);
    }
  }

  assertPlainObject(recipe.inputs || {}, `Recipe ${recipe.name} inputs`);
  for (const [name, input] of Object.entries(recipe.inputs || {})) {
    if (!INPUT_NAME.test(name)) throw new Error(`Recipe ${recipe.name} has invalid input name: ${name}`);
    if (RESERVED_INPUTS.has(name)) throw new Error(`Recipe ${recipe.name} input is reserved: ${name}`);
    assertPlainObject(input, `Recipe ${recipe.name} input ${name}`);
    if (Object.keys(input).some((key) => !['description', 'required', 'default'].includes(key))) {
      throw new Error(`Recipe ${recipe.name} input ${name} contains unsupported fields.`);
    }
    if (input.description !== undefined && typeof input.description !== 'string') {
      throw new Error(`Recipe ${recipe.name} input ${name} description must be a string.`);
    }
    if (input.required !== undefined && typeof input.required !== 'boolean') {
      throw new Error(`Recipe ${recipe.name} input ${name} required must be true or false.`);
    }
    if (input.default !== undefined && typeof input.default !== 'string') {
      throw new Error(`Recipe ${recipe.name} input ${name} default must be a string.`);
    }
  }

  if (!Array.isArray(recipe.requirements)) throw new Error(`Recipe ${recipe.name} requirements must be an array.`);
  recipe.requirements.forEach((item, index) => validateValueSpec(item, `requirements[${index}]`));
  if (!Array.isArray(recipe.actions) || recipe.actions.length === 0) {
    throw new Error(`Recipe ${recipe.name} must define at least one action.`);
  }
  recipe.actions.forEach((action, index) => validateAction(action, index));
  if (recipe.detect !== undefined) validateDetect(recipe.detect, recipe.name);
  if (recipe.lifecycle !== undefined) validateLifecycle(recipe.lifecycle, recipe.name);
  return recipe;
}

module.exports = {
  validateAction,
  validateRecipe,
  validateValueSpec,
};
