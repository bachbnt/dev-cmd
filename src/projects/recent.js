// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { PROJECTS_FILE } = require('../config');
const { readJson, writeJsonAtomic } = require('../store/json-store');

function readProjects(options = {}) {
  const file = options.file || PROJECTS_FILE;
  const fsImpl = options.fsImpl || fs;
  const projects = readJson(file, { fsImpl, fallback: [] });
  return Array.isArray(projects) ? projects : [];
}

function saveProjects(projects, options = {}) {
  const file = options.file || PROJECTS_FILE;
  const fsImpl = options.fsImpl || fs;
  writeJsonAtomic(file, projects.slice(0, 50), { fsImpl });
}

function recordProject(project, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const now = options.now || (() => new Date());
  const absolutePath = path.resolve(project.path);
  if (!fsImpl.existsSync(absolutePath)) return;

  const projects = readProjects(options).filter((entry) => entry.path !== absolutePath);
  projects.unshift({
    name: project.name || path.basename(absolutePath),
    type: project.type || 'unknown',
    path: absolutePath,
    lastUsedAt: now().toISOString(),
  });
  saveProjects(projects, options);
}

function getExistingProjects(options = {}) {
  const fsImpl = options.fsImpl || fs;
  return readProjects(options).filter((project) => fsImpl.existsSync(project.path));
}

module.exports = {
  getExistingProjects,
  readProjects,
  recordProject,
  saveProjects,
};
