// Copyright (c) 2026 bachbnt

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { TRUST_FILE } = require('../config');
const { LIFECYCLE_COMMANDS } = require('../constants');
const { buildRecipeActions } = require('../recipes');
const { validateAction } = require('../recipes/schema');

const PROFILE_FILE = '.devcmd.json';
const TASK_NAME = /^[A-Za-z][A-Za-z0-9:_.-]*$/;

function validateRunActions(actions, label) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error(`${label} must be a non-empty array of run actions.`);
  }
  actions.forEach((action, index) => {
    validateAction(action, index, label);
    if (action.type !== 'run') throw new Error(`${label}[${index}].type must be "run".`);
  });
}

function validateProfile(data, file = PROFILE_FILE) {
  const fail = (message) => {
    throw new Error(`Invalid ${file}: ${message}`);
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('root must be an object.');
  const unknown = Object.keys(data).filter((key) => !['name', 'lifecycle', 'tasks'].includes(key));
  if (unknown.length > 0) fail(`unsupported fields: ${unknown.join(', ')}.`);
  if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim())) {
    fail('name must be a non-empty string.');
  }
  try {
    for (const [action, actions] of Object.entries(data.lifecycle || {})) {
      if (!LIFECYCLE_COMMANDS.includes(action)) fail(`unsupported lifecycle action: ${action}.`);
      validateRunActions(actions, `lifecycle.${action}`);
    }
    for (const [name, task] of Object.entries(data.tasks || {})) {
      if (!TASK_NAME.test(name)) fail(`invalid task name: ${name}.`);
      const normalized = Array.isArray(task) ? { commands: task } : task;
      if (!normalized || typeof normalized !== 'object' || Object.keys(normalized).some(
        (key) => !['description', 'commands'].includes(key)
      )) {
        fail(`task ${name} must be an array or an object with description and commands.`);
      }
      if (normalized.description !== undefined && typeof normalized.description !== 'string') {
        fail(`task ${name} description must be a string.`);
      }
      validateRunActions(normalized.commands, `tasks.${name}.commands`);
    }
  } catch (error) {
    if (error.message.startsWith('Invalid ')) throw error;
    fail(error.message);
  }
  return data;
}

function loadProfile(root, fsImpl = fs) {
  const file = path.join(root, PROFILE_FILE);
  let content;
  try {
    content = fsImpl.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`Unable to read ${file}: ${error.message}`);
  }
  let data;
  try {
    data = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}: ${error.message}`);
  }
  validateProfile(data, file);
  return {
    file,
    hash: crypto.createHash('sha256').update(content).digest('hex'),
    name: data.name,
    lifecycle: data.lifecycle || {},
    tasks: Object.fromEntries(Object.entries(data.tasks || {}).map(([name, task]) => [
      name,
      Array.isArray(task) ? { commands: task } : task,
    ])),
  };
}

function readTrusted(trustFile, fsImpl = fs) {
  try {
    const data = JSON.parse(fsImpl.readFileSync(trustFile, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function isTrusted(profile, options = {}) {
  const trusted = readTrusted(options.trustFile || TRUST_FILE, options.fsImpl);
  return trusted[profile.file] === profile.hash;
}

function trustProfile(profile, options = {}) {
  const trustFile = options.trustFile || TRUST_FILE;
  const fsImpl = options.fsImpl || fs;
  const trusted = readTrusted(trustFile, fsImpl);
  trusted[profile.file] = profile.hash;
  fsImpl.mkdirSync(path.dirname(trustFile), { recursive: true });
  fsImpl.writeFileSync(trustFile, `${JSON.stringify(trusted, null, 2)}\n`);
}

function assertTrusted(profile, options = {}) {
  if (!isTrusted(profile, options)) {
    throw new Error(
      `${profile.file} is not trusted or has changed since it was approved. ` +
      'Review it, then run: dev trust'
    );
  }
}

function buildProfileCommands(profile, actions, project, options = {}) {
  if (!options.previewUntrusted) assertTrusted(profile, options);
  return buildRecipeActions(
    { name: 'profile', inputs: {}, baseDir: project.root },
    actions,
    project.root,
    {
      packageManager: project.packageManager,
      python: options.config?.python,
      values: {},
      skipRequiredInputs: true,
    },
    { root: project.root }
  );
}

function buildProfileLifecycle(project, action, options = {}) {
  const actions = project.profile?.lifecycle?.[action];
  if (!actions) return undefined;
  return buildProfileCommands(project.profile, actions, project, options);
}

function buildProfileTask(project, name, options = {}) {
  const task = project.profile?.tasks?.[name];
  if (!task) return undefined;
  return buildProfileCommands(project.profile, task.commands, project, options);
}

function describeProfile(project, options = {}) {
  const preview = { ...options, previewUntrusted: true };
  const entries = [];
  for (const [action, actions] of Object.entries(project.profile.lifecycle)) {
    entries.push({
      label: `lifecycle ${action}`,
      commands: buildProfileCommands(project.profile, actions, project, preview),
    });
  }
  for (const [name, task] of Object.entries(project.profile.tasks)) {
    entries.push({
      label: `task ${name}`,
      commands: buildProfileCommands(project.profile, task.commands, project, preview),
    });
  }
  return entries;
}

module.exports = {
  PROFILE_FILE,
  describeProfile,
  assertTrusted,
  buildProfileLifecycle,
  buildProfileTask,
  isTrusted,
  loadProfile,
  trustProfile,
  validateProfile,
};
