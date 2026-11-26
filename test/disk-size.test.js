// Copyright (c) 2026 bachbnt

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  findLargeFiles, formatBytes, measure, measureChildren, parseSize,
} = require('../src/disk/size');
const { tempDir, writeFile } = require('./helpers');

test('sizes parse with units and format back', () => {
  assert.equal(parseSize('500MB'), 500_000_000);
  assert.equal(parseSize('1.5 GB'), 1_500_000_000);
  assert.equal(parseSize('2gib'), 2 * 1024 ** 3);
  assert.equal(parseSize('1000'), 1000);
  assert.throws(() => parseSize('big'), /Cannot read the size/);
  assert.throws(() => parseSize('5XB'), /Unknown size unit/);
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1500), '1.5 KB');
  assert.equal(formatBytes(2_500_000_000), '2.5 GB');
});

test('measure adds up files, does not follow symbolic links, and counts a hard link once', async (t) => {
  const dir = tempDir();
  writeFile(path.join(dir, 'a', 'one.bin'), Buffer.alloc(10_000));
  writeFile(path.join(dir, 'a', 'b', 'two.bin'), Buffer.alloc(20_000));
  const outside = tempDir();
  writeFile(path.join(outside, 'huge.bin'), Buffer.alloc(1_000_000));
  try {
    fs.symlinkSync(outside, path.join(dir, 'link'));
  } catch {
    t.diagnostic('symbolic links not available here');
  }
  const plain = await measure(dir);
  assert.equal(plain.files >= 2, true);
  assert.ok(plain.bytes >= 30_000 && plain.bytes < 200_000, `${plain.bytes}`);
  assert.equal(plain.unreadable, 0);

  fs.linkSync(path.join(dir, 'a', 'one.bin'), path.join(dir, 'a', 'again.bin'));
  const linked = await measure(dir);
  assert.equal(linked.shared, true);
  assert.equal(linked.bytes, plain.bytes + (linked.bytes - plain.bytes)); // sanity
  assert.ok(linked.bytes < plain.bytes + 10_000, 'the second hard link is not counted again');
});

test('measure reports a missing folder as unreadable, not as an error', async () => {
  const result = await measure(path.join(tempDir(), 'nope'));
  assert.equal(result.unreadable, 1);
  assert.equal(result.bytes, 0);
});

test('measureChildren sorts biggest first and findLargeFiles applies the limit', async () => {
  const dir = tempDir();
  writeFile(path.join(dir, 'small.bin'), Buffer.alloc(1_000));
  writeFile(path.join(dir, 'big', 'big.bin'), Buffer.alloc(400_000));
  writeFile(path.join(dir, '.git', 'objects', 'pack.bin'), Buffer.alloc(300_000));
  const { entries } = await measureChildren(dir);
  assert.equal(entries[0].name, 'big');
  assert.equal(entries[0].directory, true);
  const large = await findLargeFiles([dir], { minBytes: 100_000 });
  assert.deepEqual(large.map((file) => path.basename(file.path)), ['big.bin']);
  assert.deepEqual((await measureChildren(path.join(dir, 'none'))).entries, []);
});
