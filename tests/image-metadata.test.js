import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dpiToPixelsPerMeter,
  embedJpegDpi,
  embedPngDpi,
  readJpegDpi,
  readPngDpi,
} from '../src/image-metadata.js';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function pngChunk(type, data = new Uint8Array()) {
  const typeBytes = Uint8Array.from(type, (char) => char.charCodeAt(0));
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function concatBytes(...parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function minimalPng(extraChunks = []) {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, 1);
  writeUint32(ihdr, 4, 1);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concatBytes(signature, pngChunk('IHDR', ihdr), ...extraChunks, pngChunk('IEND'));
}

function countPngChunks(bytes, wantedType) {
  let count = 0;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = (
      bytes[offset] * 0x1000000
      + bytes[offset + 1] * 0x10000
      + bytes[offset + 2] * 0x100
      + bytes[offset + 3]
    ) >>> 0;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === wantedType) count++;
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return count;
}

test('dpiToPixelsPerMeter: converts 300 and 600 DPI for PNG pHYs', () => {
  assert.equal(dpiToPixelsPerMeter(300), 11811);
  assert.equal(dpiToPixelsPerMeter(600), 23622);
});

test('embedJpegDpi: inserts real 300 DPI JFIF metadata', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const output = embedJpegDpi(jpeg, 300);
  assert.deepEqual(readJpegDpi(output), { x: 300, y: 300, unit: 'dpi' });
  assert.equal(output[0], 0xff);
  assert.equal(output[1], 0xd8);
});

test('embedJpegDpi: updates existing JFIF density without duplicating the segment', () => {
  const jpeg = embedJpegDpi(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), 300);
  const output = embedJpegDpi(jpeg, 600);
  assert.equal(output.length, jpeg.length);
  assert.deepEqual(readJpegDpi(output), { x: 600, y: 600, unit: 'dpi' });
});

test('embedPngDpi: inserts 300 DPI pHYs immediately after IHDR', () => {
  const output = embedPngDpi(minimalPng(), 300);
  const metadata = readPngDpi(output);
  assert.ok(metadata);
  assert.ok(Math.abs(metadata.x - 300) < 0.02);
  assert.ok(Math.abs(metadata.y - 300) < 0.02);
  assert.equal(countPngChunks(output, 'pHYs'), 1);
  assert.equal(String.fromCharCode(...output.subarray(37, 41)), 'pHYs');
});

test('embedPngDpi: replaces an existing pHYs chunk and keeps only one', () => {
  const oldPhys = new Uint8Array(9);
  writeUint32(oldPhys, 0, 3780);
  writeUint32(oldPhys, 4, 3780);
  oldPhys[8] = 1;
  const source = minimalPng([pngChunk('pHYs', oldPhys)]);
  const output = embedPngDpi(source, 600);
  const metadata = readPngDpi(output);
  assert.ok(metadata);
  assert.ok(Math.abs(metadata.x - 600) < 0.02);
  assert.equal(countPngChunks(output, 'pHYs'), 1);
});

test('metadata writers reject invalid image signatures', () => {
  assert.throws(() => embedJpegDpi(new Uint8Array([1, 2, 3]), 300), /JPEG/i);
  assert.throws(() => embedPngDpi(new Uint8Array([1, 2, 3]), 300), /PNG/i);
});

test('metadata writers reject invalid DPI', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  assert.throws(() => embedJpegDpi(jpeg, 0), /DPI/i);
  assert.throws(() => embedJpegDpi(jpeg, 70_000), /65535/i);
  assert.throws(() => embedPngDpi(minimalPng(), Number.NaN), /DPI/i);
});
