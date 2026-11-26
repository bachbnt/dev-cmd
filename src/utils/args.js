// Copyright (c) 2026 bachbnt

const { PACKAGE_MANAGERS, frameworkDefinitions } = require('../config');
const { parseArgs, validateCommandFlags: validateFlags } = require('../cli/options');

// Parsing and per-command flag rules are generated from the option definitions in `cli/options.js`.
function validateCommandFlags(command, options, definitions = frameworkDefinitions) {
  validateFlags(command, options, definitions);
}

function validateFrameworkOptions(command, options, definitions = frameworkDefinitions) {
  const definition = definitions[command];
  if (!definition) throw new Error(`Unsupported framework: ${command}`);

  const capabilities = definition.capabilities;
  if (options.typescript !== undefined && !capabilities.language) {
    throw new Error(`${command} does not support selecting TypeScript or JavaScript.`);
  }
  if (options.packageManager && !capabilities.packageManager) {
    throw new Error(`${command} does not support selecting a package manager.`);
  }
  if (options.git !== undefined && !capabilities.git) {
    throw new Error(`${command} does not support configuring Git initialization.`);
  }
  if (options.eslint !== undefined && !capabilities.eslint) {
    throw new Error(`${command} does not support configuring ESLint.`);
  }
  if (options.noInstall && !capabilities.noInstall) {
    throw new Error(`${command} does not support --no-install.`);
  }
  if (options.python && !capabilities.python) {
    throw new Error(`${command} does not support selecting a Python executable.`);
  }
  if (
    Array.isArray(capabilities.packageManager) &&
    options.packageManager &&
    !capabilities.packageManager.includes(options.packageManager)
  ) {
    throw new Error(
      `${command} supports package managers: ${capabilities.packageManager.join(', ')}`
    );
  }
}

function validateProjectName(target) {
  if (!target) throw new Error('Project name is required.');
  if (!/^[A-Za-z0-9._-]+$/.test(target)) {
    throw new Error('Invalid project name. Use only letters, numbers, dots, underscores, and hyphens.');
  }
}

module.exports = {
  parseArgs,
  validateCommandFlags,
  validateFrameworkOptions,
  validateProjectName,
};
