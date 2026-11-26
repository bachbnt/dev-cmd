#!/usr/bin/env node
// Copyright (c) 2026 bachbnt

const fs = require('fs');
const path = require('path');
const { resetTarget } = require('../disk/catalog');

const root = path.resolve(process.argv[2] || '.');
const type = process.argv[3] || 'unknown';

const target = path.join(root, resetTarget(type));

fs.rmSync(target, { recursive: true, force: true });
