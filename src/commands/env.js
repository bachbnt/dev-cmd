// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');

const TEMPLATE_FILES = ['.env.example', '.env.sample', '.env.template'];
const ENV_FILE = '.env';

function parseEnvKeys(content) {
  const keys = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

function findTemplate(root, fsImpl = fs) {
  return TEMPLATE_FILES.find((name) => fsImpl.existsSync(path.join(root, name)));
}

function initEnv(root, fsImpl = fs) {
  const template = findTemplate(root, fsImpl);
  if (!template) throw new Error(`No ${TEMPLATE_FILES.join(', ')} file was found in ${root}.`);
  const target = path.join(root, ENV_FILE);
  if (fsImpl.existsSync(target)) return { created: false, template, file: target };
  fsImpl.copyFileSync(path.join(root, template), target, fs.constants.COPYFILE_EXCL);
  return { created: true, template, file: target };
}

function checkEnv(root, fsImpl = fs) {
  const template = findTemplate(root, fsImpl);
  if (!template) throw new Error(`No ${TEMPLATE_FILES.join(', ')} file was found in ${root}.`);
  const target = path.join(root, ENV_FILE);
  if (!fsImpl.existsSync(target)) {
    throw new Error(`${ENV_FILE} does not exist. Run: dev env`);
  }
  const expected = parseEnvKeys(fsImpl.readFileSync(path.join(root, template), 'utf8'));
  const actual = new Set(parseEnvKeys(fsImpl.readFileSync(target, 'utf8')));
  const missing = expected.filter((key) => !actual.has(key));
  const known = new Set(expected);
  const extra = [...actual].filter((key) => !known.has(key));
  return { template, missing, extra, ok: missing.length === 0 };
}

module.exports = {
  TEMPLATE_FILES,
  checkEnv,
  findTemplate,
  initEnv,
  parseEnvKeys,
};
