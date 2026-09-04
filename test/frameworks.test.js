// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFrameworkCommands } = require('../src/commands/frameworks');
const {
  buildAndroidCommands,
  buildIOSBootCommands,
  buildIOSShutdownCommands,
} = require('../src/commands/devices');

test('React Vite command uses executable and separate arguments', () => {
  assert.deepEqual(
    buildFrameworkCommands('react', 'web-app', {
      packageManager: 'npm',
      typescript: true,
      git: false,
    }),
    [
      {
        executable: 'npm',
        args: [
          'create',
          'vite@latest',
          'web-app',
          '--',
          '--template',
          'react-ts',
          '--no-interactive',
        ],
      },
    ]
  );
});

test('framework Git initialization is a separate process', () => {
  assert.deepEqual(buildFrameworkCommands('express', 'api', { git: true }), [
    { executable: 'npx', args: ['express-generator@latest', 'api', '--no-view'] },
    { executable: 'git', args: ['-C', 'api', 'init'] },
  ]);
});

test('React Native defaults to Expo and Community CLI stays explicit', () => {
  assert.deepEqual(
    buildFrameworkCommands('react_native', 'mobile', {
      packageManager: 'pnpm',
      typescript: false,
      git: false,
    }),
    [
      {
        executable: 'pnpm',
        args: ['create', 'expo-app', 'mobile', '--template', 'blank', '--yes'],
      },
    ]
  );
  assert.deepEqual(
    buildFrameworkCommands('react_native_cli', 'NativeApp', {
      packageManager: 'yarn',
      git: false,
    }),
    [
      {
        executable: 'npx',
        args: [
          '@react-native-community/cli@latest',
          'init',
          'NativeApp',
          '--pm',
          'yarn',
          '--skip-git-init',
        ],
      },
    ]
  );
});

test('Next and Nest arguments remain discrete', () => {
  assert.deepEqual(
    buildFrameworkCommands('next', 'site', {
      packageManager: 'yarn',
      typescript: false,
      eslint: false,
      git: false,
    }),
    [
      {
        executable: 'yarn',
        args: [
          'create',
          'next-app',
          'site',
          '--js',
          '--no-linter',
          '--use-yarn',
          '--disable-git',
          '--yes',
        ],
      },
    ]
  );
  assert.deepEqual(
    buildFrameworkCommands('nest', 'api', {
      packageManager: 'npm',
      typescript: true,
      git: false,
    }),
    [
      {
        executable: 'npx',
        args: [
          '@nestjs/cli@latest',
          'new',
          'api',
          '--package-manager',
          'npm',
          '--language',
          'TypeScript',
          '--skip-git',
        ],
      },
    ]
  );
});

test('Angular CLI uses npx and forwards package-manager and git flags', () => {
  assert.deepEqual(
    buildFrameworkCommands('angular', 'ng-app', {
      packageManager: 'npm',
      git: true,
    }),
    [
      {
        executable: 'npx',
        args: [
          '@angular/cli@latest',
          'new',
          'ng-app',
          '--package-manager',
          'npm',
        ],
      },
    ]
  );
  assert.deepEqual(
    buildFrameworkCommands('angular', 'ng-app', {
      packageManager: 'pnpm',
      git: false,
      noInstall: true,
    }),
    [
      {
        executable: 'npx',
        args: [
          '@angular/cli@latest',
          'new',
          'ng-app',
          '--package-manager',
          'pnpm',
          '--skip-git',
          '--skip-install',
        ],
      },
    ]
  );
});

test('Python frameworks create a virtual environment and install the project', () => {
  const commands = buildFrameworkCommands('fastapi', 'my-api', { git: false });
  assert.equal(commands[0].executable, 'node');
  assert.match(commands[0].args[0], /python-project\.js$/);
  assert.deepEqual(commands[0].args.slice(1), ['fastapi', 'my-api']);
  assert.deepEqual(commands[1], {
    executable: process.platform === 'win32' ? 'python' : 'python3',
    args: ['-m', 'venv', 'my-api/.venv'],
  });
  assert.deepEqual(commands[2].args, ['-m', 'pip', 'install', '-e', 'my-api[dev]']);
});

test('Django uses the official startproject command after setup', () => {
  const commands = buildFrameworkCommands('django', 'my-app', { git: true });
  assert.deepEqual(commands.at(-2).args, ['-m', 'django', 'startproject', 'config', 'my-app']);
  assert.deepEqual(commands.at(-1), { executable: 'git', args: ['-C', 'my-app', 'init'] });
});

test('no-install is forwarded to supported scaffolders', () => {
  assert.ok(
    buildFrameworkCommands('next', 'site', { noInstall: true, git: false })[0].args.includes('--skip-install')
  );
  assert.ok(
    buildFrameworkCommands('react_native', 'mobile', { noInstall: true, git: false })[0].args.includes('--no-install')
  );
  assert.deepEqual(buildFrameworkCommands('fastapi', 'api', { noInstall: true, git: false }).length, 1);
});

test('device builders do not require shell chaining', () => {
  assert.deepEqual(buildAndroidCommands('Pixel_10', { coldBoot: true }), [
    { executable: 'emulator', args: ['-avd', 'Pixel_10', '-no-snapshot-load'] },
  ]);
  assert.deepEqual(buildIOSBootCommands('DEVICE-ID'), [
    { executable: 'open', args: ['-a', 'Simulator'] },
    { executable: 'xcrun', args: ['simctl', 'boot', 'DEVICE-ID'] },
  ]);
  assert.deepEqual(buildIOSShutdownCommands(), [
    { executable: 'xcrun', args: ['simctl', 'shutdown', 'all'] },
  ]);
});
