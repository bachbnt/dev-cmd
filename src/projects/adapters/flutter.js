// Copyright (c) 2026 bachbnt

const { createCommand } = require('../../runner/command');
const { unsupported } = require('./common');

function command(project, args) {
  return createCommand('flutter', args, { cwd: project.root });
}

function build(action, project) {
  if (action === 'install') return [command(project, ['pub', 'get'])];
  if (action === 'run') return [command(project, ['run'])];
  if (action === 'test') return [command(project, ['test'])];
  if (action === 'build') return [command(project, ['build', 'apk'])];
  if (action === 'reset') return [command(project, ['clean']), command(project, ['pub', 'get'])];
  if (action === 'clean') return [command(project, ['clean'])];
  if (action === 'lint') return [command(project, ['analyze'])];
  if (action === 'format') return [createCommand('dart', ['format', '.'], { cwd: project.root })];
  if (action === 'outdated') return [command(project, ['pub', 'outdated'])];
  if (action === 'upgrade') return [command(project, ['pub', 'upgrade'])];
  if (action === 'check') return [command(project, ['analyze']), command(project, ['test'])];
  return unsupported(action, project);
}

module.exports = {
  build,
  id: 'flutter',
  matches: (project) => project.type === 'flutter',
};
