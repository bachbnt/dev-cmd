// Copyright (c) 2026 bachbnt

// Derived from the command registry in `cli/commands.js`; do not list commands here.
const { COMMANDS } = require('./cli/commands');

const names = (predicate) => COMMANDS.filter(predicate).map((command) => command.name);

const LIFECYCLE_COMMANDS = names((command) => command.kind === 'lifecycle');
const DEVICE_COMMANDS = names((command) => command.kind === 'device');
const SYSTEM_COMMANDS = names((command) => command.kind === 'system');
const FILTER_COMMANDS = names((command) => command.filter);
const JSON_COMMANDS = names((command) => command.json);

module.exports = {
  DEVICE_COMMANDS,
  FILTER_COMMANDS,
  JSON_COMMANDS,
  LIFECYCLE_COMMANDS,
  SYSTEM_COMMANDS,
};
