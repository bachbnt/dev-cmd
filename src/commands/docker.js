// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { createCommand } = require('../runner/command');

const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
const DOCKER_ACTIONS = {
  up: ['up', '-d'],
  down: ['down'],
  build: ['build'],
  ps: ['ps'],
  logs: ['logs', '--follow', '--tail', '100'],
  restart: ['restart'],
};

function findComposeFile(root, fsImpl = fs) {
  return COMPOSE_FILES.find((name) => fsImpl.existsSync(path.join(root, name)));
}

function buildDockerCommands(action, root, fsImpl = fs) {
  if (!Object.hasOwn(DOCKER_ACTIONS, action)) {
    throw new Error(`Usage: dev docker <${Object.keys(DOCKER_ACTIONS).join('|')}> [path]`);
  }
  const file = findComposeFile(root, fsImpl);
  if (!file) throw new Error(`No Compose file was found in ${root}. Expected: ${COMPOSE_FILES.join(', ')}.`);
  return [createCommand('docker', ['compose', '--file', file, ...DOCKER_ACTIONS[action]], { cwd: root })];
}

module.exports = {
  COMPOSE_FILES,
  DOCKER_ACTIONS,
  buildDockerCommands,
  findComposeFile,
};
