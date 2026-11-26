// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');

// The file loading that recipes, openers and cleaners share: read one JSON file (an object, a list,
// or whatever `expand` turns into a list), validate each entry, and read every .json file of a
// folder in name order. Each registry supplies only what differs: its noun for error messages, its
// validator, and how an entry records where it came from.

function createFileLoaders({ noun, validate, attach, expand = (parsed) => (Array.isArray(parsed) ? parsed : [parsed]) }) {
  function loadFile(file, source, fsImpl = fs) {
    let parsed;
    try {
      parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`Unable to read ${noun} ${file}: ${error.message}`);
    }
    return expand(parsed).map((entry) => {
      try {
        return attach(validate(entry), source, path.dirname(file));
      } catch (error) {
        throw new Error(`Invalid ${noun} ${file}: ${error.message}`);
      }
    });
  }

  function loadDirectory(directory, source, options = {}) {
    const fsImpl = options.fsImpl || fs;
    let entries;
    try {
      entries = fsImpl.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error(`Unable to read ${noun} directory ${directory}: ${error.message}`);
    }
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((entry) => loadFile(path.join(directory, entry.name), source, fsImpl));
  }

  return { loadDirectory, loadFile };
}

module.exports = { createFileLoaders };
