// Copyright (c) 2026 bachbnt

const LIFECYCLE_COMMANDS = [
  'install', 'run', 'test', 'build', 'check', 'lint', 'format',
  'outdated', 'upgrade', 'audit', 'clean', 'reset', 'open',
];
const SYSTEM_COMMANDS = [
  'config', 'doctor', 'projects', 'recipes', 'openers', 'inspect', 'info', 'history', 'again',
  'init', 'update', 'clone', 'mcp', 'completion', 'task', 'parallel', 'env', 'docker', 'trust',
];
const DEVICE_COMMANDS = ['devices', 'android', 'ios'];
const FILTER_COMMANDS = ['run', 'test', 'build', 'check', 'lint', 'format', 'task'];
const JSON_COMMANDS = [
  'inspect', 'doctor', 'projects', 'history', 'recipes', 'openers', 'devices', 'config',
];

module.exports = {
  DEVICE_COMMANDS,
  FILTER_COMMANDS,
  JSON_COMMANDS,
  LIFECYCLE_COMMANDS,
  SYSTEM_COMMANDS,
};
