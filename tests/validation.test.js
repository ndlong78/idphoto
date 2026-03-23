import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageFile } from '../src/state.js';

// ── Từ chối ───────────────────────────────────────────────────────────────────

test('validateImageFile: từ chối file text', () => {
  const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
  const result = validateImageFile(file);
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0, 'Phải có thông báo lỗi');
});

test('validateImageFile: từ chối file PDF', () => {
  const file = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
  assert.equal(validateImageFile(file).ok, false);
});

test('validateImageFile: từ chối file quá lớn (> 15MB)', () => {
  const bigData = new Uint8Array(15 * 1024 * 1024 + 1);
  const file    = new File([bigData], 'big.jpg', { type: 'image/jpeg' });
  const result  = validateImageFile(file);
  assert.equal(result.ok, false);
  assert.match(result.error, /15MB/i);
});

test('validateImageFile: từ chối khi cả mime lẫn extension đều sai', () => {
  const file = new File(['data'], 'file.xyz', { type: 'application/octet-stream' });
  assert.equal(validateImageFile(file).ok, false);
});

// ── Chấp nhận ─────────────────────────────────────────────────────────────────

test('validateImageFile: chấp nhận PNG (mime + extension)', () => {
  const file = new File([new Uint8Array(1024)], 'photo.png', { type: 'image/png' });
  assert.deepEqual(validateImageFile(file), { ok: true });
});

test('validateImageFile: chấp nhận JPEG', () => {
  const file = new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' });
  assert.deepEqual(validateImageFile(file), { ok: true });
});

test('validateImageFile: chấp nhận WEBP', () => {
  const file = new File([new Uint8Array(1024)], 'photo.webp', { type: 'image/webp' });
  assert.deepEqual(validateImageFile(file), { ok: true });
});

test('validateImageFile: chấp nhận HEIC qua extension khi mime rỗng (iOS upload)', () => {
  const file = new File([new Uint8Array(1024)], 'iphone_upload.heic', { type: '' });
  assert.deepEqual(validateImageFile(file), { ok: true });
});

test('validateImageFile: chấp nhận HEIF qua extension', () => {
  const file = new File([new Uint8Array(1024)], 'photo.heif', { type: '' });
  assert.deepEqual(validateImageFile(file), { ok: true });
});

test('validateImageFile: chấp nhận file đúng 15MB (boundary)', () => {
  const exactData = new Uint8Array(15 * 1024 * 1024);
  const file      = new File([exactData], 'exact.jpg', { type: 'image/jpeg' });
  assert.deepEqual(validateImageFile(file), { ok: true });
});

test('validateImageFile: chấp nhận JPEG extension bất kể capitalisation', () => {
  const file = new File([new Uint8Array(100)], 'PHOTO.JPG', { type: '' });
  assert.deepEqual(validateImageFile(file), { ok: true });
});

test('validateImageFile: chấp nhận khi mime hợp lệ dù extension lạ', () => {
  // Một số browser/OS upload với extension bị stripped
  const file = new File([new Uint8Array(100)], 'image_upload', { type: 'image/jpeg' });
  assert.deepEqual(validateImageFile(file), { ok: true });
});
