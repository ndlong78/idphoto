import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageFile } from '../src/state.js';

test('reject non-image file', () => {
  const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
  const result = validateImageFile(file);
  assert.equal(result.ok, false);
});

test('accept image file <= 15MB', () => {
  const file = new File([new Uint8Array(1024)], 'a.png', { type: 'image/png' });
  const result = validateImageFile(file);
  assert.deepEqual(result, { ok: true });
});

test('accept image extension even when mime type is empty', () => {
  const file = new File([new Uint8Array(1024)], 'iphone_upload.heic', { type: '' });
  const result = validateImageFile(file);
  assert.deepEqual(result, { ok: true });
});
