#!/usr/bin/env node
import { openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { parseFixture, analyzeFixture, serializeFixture, LIMITS } from './dist/assets/core.mjs';
const [command, path, ...extra] = process.argv.slice(2);
try {
  if (!['analyze', 'normalize'].includes(command) || !path || extra.length) throw new Error('Usage: node cli.mjs analyze|normalize FILE.json');
  const fd = openSync(path, 'r');
  let bytes;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > LIMITS.bytes) throw new Error('Input must be a regular file of at most 64 KiB.');
    const buffer = Buffer.alloc(LIMITS.bytes + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, count);
      if (read === 0) break;
      count += read;
    }
    if (count > LIMITS.bytes) throw new Error('Input exceeds 64 KiB.');
    bytes = buffer.subarray(0, count);
  } finally { closeSync(fd); }
  const fixture = parseFixture(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  process.stdout.write(command === 'normalize' ? serializeFixture(fixture) : JSON.stringify(analyzeFixture(fixture), null, 2) + '\n');
} catch (error) {
  console.error(`Overlap Lab: ${error.message}`);
  process.exitCode = 2;
}
