// Copyright (c) 2026 bachbnt

const { buildAndroidCommands, buildIOSBootCommands } = require('../commands/devices');
const { loadConfig } = require('../config/user');
const { getAndroidDevices, getIOSDevices } = require('../devices');
const { checkTools } = require('../runner/check');
const { DEFAULT_TIMEOUT_MS, defaultProcesses, jsonResult, runCaptured } = require('./shared');

// Tools about the machine: installed development tools, emulators and simulators.

const definitions = [
  {
    name: 'doctor',
    description: 'Check which development tools are installed and how to install missing ones.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_devices',
    description: 'List Android emulators and iOS simulators with runtime and boot status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'boot_device',
    description: 'Boot an Android emulator (runs in the background; returns a process id) or an iOS simulator.',
    inputSchema: {
      type: 'object',
      required: ['platform', 'name'],
      properties: {
        platform: { type: 'string', enum: ['android', 'ios'] },
        name: { type: 'string', description: 'Device name or identifier from list_devices.' },
        coldBoot: { type: 'boolean', description: 'Android only: skip the saved snapshot.' },
      },
    },
  },
];

function bootDevice(args, environment) {
  const processes = environment.processes || defaultProcesses;
  const { platform, name } = args;
  if (!['android', 'ios'].includes(platform)) throw new Error('platform must be android or ios.');
  if (typeof name !== 'string' || !name || name.startsWith('-')) {
    throw new Error('name must be a device name or identifier.');
  }
  if (platform === 'android') {
    const commands = buildAndroidCommands(name, { coldBoot: Boolean(args.coldBoot) });
    return jsonResult({ ...processes.start({ label: `android:${name}`, commands }) });
  }
  return runCaptured(buildIOSBootCommands(name), {}, DEFAULT_TIMEOUT_MS, { platform, name });
}

const handlers = {
  doctor(args, environment) {
    const config = environment.config || loadConfig();
    const tools = checkTools(config).map(({ name, executable, required, found, path: toolPath, version, hint }) => ({
      name, executable, required: Boolean(required), found, path: toolPath, version, hint,
    }));
    return jsonResult({ ready: tools.every((tool) => !tool.required || tool.found), tools });
  },
  list_devices() {
    return jsonResult({ android: getAndroidDevices(), ios: getIOSDevices() });
  },
  boot_device: bootDevice,
};

module.exports = { definitions, handlers };
