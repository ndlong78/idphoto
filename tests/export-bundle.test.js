import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExportBundleFilename,
  createExportBundle,
} from '../src/export-bundle.js';
import {
  clearStagedExportForBundle,
  consumeStagedExportForBundle,
  hasStagedExportForBundle,
  stageExportForBundle,
} from '../src/export-delivery-session.js';
import { crc32, createStoredZipBytes } from '../src/zip.js';

const decoder = new TextDecoder();

function parseLocalEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    const data = bytes.slice(dataStart, dataEnd);
    entries.push({ name, data, flags, method, crc });
    offset = dataEnd;
  }
  return { entries, centralOffset: offset };
}

test('crc32 khớp vector chuẩn', () => {
  assert.equal(crc32('123456789'), 0xcbf43926);
});

test('ZIP store tạo entry UTF-8 với CRC hợp lệ', () => {
  const bytes = createStoredZipBytes([
    { name: 'photo.jpeg', data: new Uint8Array([1, 2, 3, 4]) },
    { name: 'kiem-tra.json', data: '{"ok":true}\n' },
  ]);
  const parsed = parseLocalEntries(bytes);
  assert.deepEqual(parsed.entries.map((entry) => entry.name), [
    'photo.jpeg',
    'kiem-tra.json',
  ]);
  assert.equal(parsed.entries.every((entry) => entry.method === 0), true);
  assert.equal(parsed.entries.every((entry) => (entry.flags & 0x0800) !== 0), true);
  assert.equal(parsed.entries[0].crc, crc32(parsed.entries[0].data));
  assert.equal(decoder.decode(parsed.entries[1].data), '{"ok":true}\n');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(parsed.centralOffset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 2);
});

test('ZIP từ chối path traversal và tên trùng', () => {
  assert.throws(
    () => createStoredZipBytes([{ name: '../photo.jpg', data: 'x' }]),
    /thư mục gốc/,
  );
  assert.throws(
    () => createStoredZipBytes([
      { name: 'photo.jpg', data: 'a' },
      { name: 'photo.jpg', data: 'b' },
    ]),
    /bị trùng/,
  );
});

test('export bundle chứa đúng ảnh và audit JSON', async () => {
  const bundle = createExportBundle({
    imageFilename: 'photovisa_us-visa_1205x1205_600dpi.jpeg',
    imageBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    auditFilename: 'photovisa_us-visa_1205x1205_600dpi.audit.json',
    auditContent: '{"schemaVersion":1}\n',
  });
  assert.equal(
    bundle.filename,
    'photovisa_us-visa_1205x1205_600dpi.bundle.zip',
  );
  assert.equal(bundle.blob.type, 'application/zip');
  assert.equal(bundle.entries.length, 2);

  const parsed = parseLocalEntries(new Uint8Array(await bundle.blob.arrayBuffer()));
  assert.deepEqual(parsed.entries.map((entry) => entry.name), bundle.entries.map((entry) => entry.name));
  assert.deepEqual([...parsed.entries[0].data], [0xff, 0xd8, 0xff, 0xd9]);
  assert.equal(decoder.decode(parsed.entries[1].data), '{"schemaVersion":1}\n');
});

test('bundle filename có fallback ổn định', () => {
  assert.equal(buildExportBundleFilename('photo.png'), 'photo.bundle.zip');
  assert.equal(buildExportBundleFilename(''), 'photovisa-export.bundle.zip');
});

test('delivery session chỉ tiêu thụ staged export một lần', () => {
  clearStagedExportForBundle();
  const staged = {
    filename: 'photo.jpeg',
    bytes: new Uint8Array([1, 2]),
    mimeType: 'image/jpeg',
  };
  stageExportForBundle(staged);
  assert.equal(hasStagedExportForBundle(), true);
  assert.equal(consumeStagedExportForBundle(), staged);
  assert.equal(hasStagedExportForBundle(), false);
  assert.equal(consumeStagedExportForBundle(), null);
});
