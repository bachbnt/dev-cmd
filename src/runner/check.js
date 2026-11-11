// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findExecutable(executable, options = {}) {
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  if (executable.includes(path.sep)) {
    const candidate = path.resolve(options.cwd || process.cwd(), executable);
    return fsImpl.existsSync(candidate) ? candidate : undefined;
  }

  const extensions = process.platform === 'win32'
    ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const directory of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      try {
        fsImpl.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch (error) {
        // Continue searching PATH.
      }
    }
  }
  return undefined;
}

function getVersion(executable, args = ['--version'], options = {}) {
  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const result = spawnSyncImpl(executable, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) return undefined;
  const output = `${result.stdout || result.stderr || ''}`.trim();
  try {
    const data = JSON.parse(output);
    return data.frameworkVersion || data.version || 'available';
  } catch (error) {
    return output
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || 'available';
  }
}

function checkTools(config, options = {}) {
  const tools = [
    { name: 'Node.js', executable: 'node', args: ['--version'], required: true, hint: 'Install from https://nodejs.org or run: nvm install --lts' },
    { name: 'npm', executable: 'npm', args: ['--version'], required: true, hint: 'npm ships with Node.js. Reinstall Node.js.' },
    { name: 'Git', executable: 'git', args: ['--version'], required: true, hint: 'macOS: xcode-select --install | Linux: sudo apt install git' },
    { name: 'pnpm', executable: 'pnpm', args: ['--version'], hint: 'Run: corepack enable pnpm (or npm install --global pnpm)' },
    { name: 'Yarn', executable: 'yarn', args: ['--version'], hint: 'Run: corepack enable yarn' },
    { name: 'Python', executable: config.python, args: ['--version'], hint: 'macOS: brew install python | Linux: sudo apt install python3 python3-venv' },
    { name: 'Docker', executable: 'docker', args: ['--version'], hint: 'Install Docker Desktop from https://docs.docker.com/get-docker/' },
    { name: 'Flutter', executable: 'flutter', args: ['--version', '--machine'], hint: 'See https://docs.flutter.dev/get-started/install' },
    { name: 'Android adb', executable: 'adb', args: ['version'], hint: 'Install Android Studio and add platform-tools to PATH' },
    { name: 'Android emulator', executable: 'emulator', args: ['-version'], hint: 'Install Android Studio and add emulator to PATH' },
  ];
  if (process.platform === 'darwin') {
    tools.push({ name: 'Xcode', executable: 'xcodebuild', args: ['-version'], hint: 'Install Xcode from the App Store, then: xcode-select --install' });
  }

  return tools.map((tool) => {
    const found = findExecutable(tool.executable, options);
    return {
      ...tool,
      found: Boolean(found),
      path: found,
      version: found ? getVersion(tool.executable, tool.args, options) : undefined,
    };
  });
}

function assertExecutables(requirements, options = {}) {
  const missing = [...new Set(requirements)].filter(
    (executable) => !findExecutable(executable, options)
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required executable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Run dev doctor for setup details.`
    );
  }
}

module.exports = {
  assertExecutables,
  checkTools,
  findExecutable,
  getVersion,
};
