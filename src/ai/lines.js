// Copyright (c) 2026 bachbnt

const fs = require('fs');

// Reads a log file in large blocks of raw bytes and calls `onLine` only for lines that contain one
// of the `needles`. Most lines of an AI log (user messages, tool output) hold no usage, so they are
// never turned into strings. Measured on 2.1 GB of real logs this is about five times faster than
// `readline` with `includes`.
//
// Only lines that end with a newline are committed. Bytes after the last newline (a line still
// being written) are returned as `tail` so the caller can use them now without counting them twice
// when the file grows.

const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 128 * 1024 * 1024;
const NEWLINE = 0x0a;

function scanRegion(buffer, end, needles, onLine) {
  const next = needles.map(() => -2);
  let cursor = 0;
  for (;;) {
    let found = -1;
    for (let index = 0; index < needles.length; index += 1) {
      if (next[index] !== -1 && next[index] < cursor) {
        const at = buffer.indexOf(needles[index], cursor);
        next[index] = at === -1 || at >= end ? -1 : at;
      }
      if (next[index] !== -1 && (found === -1 || next[index] < found)) found = next[index];
    }
    if (found === -1) return;
    const start = buffer.lastIndexOf(NEWLINE, found) + 1;
    const stop = buffer.indexOf(NEWLINE, found);
    onLine(buffer.toString('utf8', start, stop).trimEnd());
    cursor = stop + 1;
  }
}

// Reads bytes [start, size) of the file. Returns `{ offset, tail }`: the byte position after the
// last committed line, and the unterminated rest as a string ('' when there is none).
async function scanFile(file, {
  start = 0, size, needles, onLine, chunkBytes = CHUNK_BYTES,
}) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const wanted = needles.map((needle) => Buffer.from(needle));
    const chunk = Buffer.allocUnsafe(chunkBytes);
    let position = start;
    let carry = Buffer.alloc(0);
    let carryStart = start;
    let skipping = false;

    while (position < size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunkBytes, size - position), position);
      if (bytesRead === 0) break;
      position += bytesRead;
      let data = carry.length > 0 ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : Buffer.from(chunk.subarray(0, bytesRead));
      let dataStart = carryStart;

      if (skipping) {
        const firstNewline = data.indexOf(NEWLINE);
        if (firstNewline === -1) {
          carry = Buffer.alloc(0);
          carryStart = position;
          continue;
        }
        data = data.subarray(firstNewline + 1);
        dataStart += firstNewline + 1;
        skipping = false;
      }

      const lastNewline = data.lastIndexOf(NEWLINE);
      if (lastNewline === -1) {
        if (data.length > MAX_LINE_BYTES) {
          // A single line this large is not a usage record; drop it instead of growing memory.
          skipping = true;
          carry = Buffer.alloc(0);
          carryStart = position;
        } else {
          carry = data;
          carryStart = dataStart;
        }
        continue;
      }
      scanRegion(data, lastNewline + 1, wanted, onLine);
      carry = Buffer.from(data.subarray(lastNewline + 1));
      carryStart = dataStart + lastNewline + 1;
    }

    const tail = skipping ? '' : carry.toString('utf8').trimEnd();
    return { offset: carryStart, tail };
  } finally {
    await handle.close();
  }
}

module.exports = { scanFile };
