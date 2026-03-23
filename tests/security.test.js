import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedRemoteUrl, isAllowedRemoteUrl } from '../src/security.js';

test('isAllowedRemoteUrl: cho phép jsdelivr/staticimgly qua https', () => {
  assert.equal(isAllowedRemoteUrl('https://cdn.jsdelivr.net/npm/a@1.0.0/file.js'), true);
  assert.equal(isAllowedRemoteUrl('https://staticimgly.com/model.bin'), true);
});

test('isAllowedRemoteUrl: chặn http, unpkg, url lỗi', () => {
  assert.equal(isAllowedRemoteUrl('http://cdn.jsdelivr.net/npm/a@1.0.0/file.js'), false);
  assert.equal(isAllowedRemoteUrl('https://unpkg.com/lib.js'), false);
  assert.equal(isAllowedRemoteUrl('not-a-url'), false);
});

test('assertAllowedRemoteUrl: throw khi URL không nằm trong allowlist', () => {
  assert.throws(
    () => assertAllowedRemoteUrl('https://evil.example.com/x.js', 'unit_test'),
    /Blocked non-allowlisted remote URL/,
  );
});
