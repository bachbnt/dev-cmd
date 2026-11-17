// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnProcess, spawnSyncProcess } = require('../src/runner/spawn');

const windowsOnly = { skip: process.platform === 'win32' ? false : 'Requires Windows.' };

test('non-Windows platforms start processes directly without a shell', () => {
  const calls = [];
  const spawn = (...call) => {
    calls.push(call);
    return 'child';
  };
  const crossSpawn = () => assert.fail('cross-spawn must not be used outside Windows');
  for (const platform of ['darwin', 'linux']) {
    assert.equal(spawnProcess('npm', ['run', 'test'], { cwd: '/x' }, { platform, spawn, crossSpawn }), 'child');
  }
  assert.deepEqual(calls[0], ['npm', ['run', 'test'], { cwd: '/x' }]);
});

test('Windows starts processes through cross-spawn with shell disabled', () => {
  const calls = [];
  const crossSpawn = (...call) => {
    calls.push(call);
    return 'child';
  };
  crossSpawn.sync = (...call) => {
    calls.push(call);
    return { status: 0 };
  };
  const deps = { platform: 'win32', crossSpawn, spawn: () => assert.fail('direct spawn on Windows') };
  assert.equal(spawnProcess('node.exe', ['a.js'], { shell: true, cwd: 'C:\\x' }, deps), 'child');
  assert.deepEqual(spawnSyncProcess('node.exe', ['-v'], { encoding: 'utf8' }, deps), { status: 0 });
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].cwd, 'C:\\x');
  assert.equal(calls[1][2].shell, false);
});

test('Windows refuses arguments that cmd.exe would expand or split for .cmd and .bat scripts', () => {
  const deps = { platform: 'win32', crossSpawn: () => 'child' };
  for (const executable of ['npm.cmd', 'gradlew.bat', 'C:\\tools\\Code.CMD']) {
    for (const argument of ['%PATH%', 'a%b', 'line\nbreak', 'line\rbreak', 'nul\0byte']) {
      assert.throws(
        () => spawnProcess(executable, ['run', argument], {}, deps),
        /cannot receive an argument containing %/,
        `${executable} ${JSON.stringify(argument)}`
      );
    }
  }
  assert.equal(spawnProcess('npm.cmd', ['run', 'test', 'two words', 'a&b'], {}, deps), 'child');
  assert.equal(spawnProcess('node.exe', ['--print', '100%'], {}, deps), 'child');
});

test('only the spawn wrapper starts child processes', () => {
  const allowed = new Set([
    path.join('src', 'runner', 'spawn.js'),
    path.join('src', 'devices', 'android.js'),
    path.join('src', 'devices', 'ios.js'),
  ]);
  const root = path.join(__dirname, '..');
  const offenders = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.js')) {
        const relative = path.relative(root, file);
        if (!allowed.has(relative) && /require\((['"])(?:node:)?child_process\1\)/.test(fs.readFileSync(file, 'utf8'))) {
          offenders.push(relative);
        }
      }
    }
  };
  visit(path.join(root, 'src'));
  assert.deepEqual(offenders, []);
});

function createCmdFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devcmd spawn (win) '));
  fs.writeFileSync(path.join(directory, 'print-args.js'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  // Forwards the raw argument list the way npm.cmd, pnpm.cmd, and yarn.cmd do.
  fs.writeFileSync(path.join(directory, 'echo-args.cmd'), '@echo off\r\nnode "%~dp0print-args.js" %*\r\n');
  return { directory, env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` } };
}

test('Windows resolves a .cmd script from PATH and forwards ordinary arguments intact', windowsOnly, () => {
  const { env } = createCmdFixture();
  const args = ['plain', 'two words', "it's", '--set=module=example.com/app', 'C:\\Users\\Name With Space\\app'];
  const result = spawnSyncProcess('echo-args', args, { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test('Windows does not execute commands smuggled in through cmd.exe metacharacters', windowsOnly, () => {
  const { directory, env } = createCmdFixture();
  const canary = path.join(directory, 'canary.txt');
  const attacks = [
    `x&echo pwned>"${canary}"`,
    `x|echo pwned>"${canary}"`,
    `x"&echo pwned>"${canary}"&"`,
    `x^&echo pwned>"${canary}"`,
    `x)&echo pwned>"${canary}"`,
    `x\\"&echo pwned>"${canary}"`,
  ];
  for (const attack of attacks) {
    spawnSyncProcess('echo-args', [attack], { encoding: 'utf8', env, cwd: directory });
    assert.equal(fs.existsSync(canary), false, `command injection through: ${attack}`);
  }
});

test('Windows reports missing executables as ENOENT through the child error event', windowsOnly, async () => {
  const child = spawnProcess('definitely-not-installed-devcmd', [], { stdio: 'ignore' });
  const error = await new Promise((resolve) => child.once('error', resolve));
  assert.equal(error.code, 'ENOENT');
});
