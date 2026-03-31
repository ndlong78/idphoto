import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedRemoteUrl, isAllowedRemoteUrl, isAllowedTelemetryEndpoint } from '../src/security.js';

// FIX: esm.sh đã được thêm vào allowlist (xem src/security.js) vì
// @imgly/background-removal@1.5.5 trên jsdelivr có internal dynamic import
// trỏ đến esm.sh. Test này được cập nhật để phản ánh thực tế mới.

test('isAllowedRemoteUrl: cho phép jsdelivr, staticimgly, esm.sh qua https', () => {
  assert.equal(isAllowedRemoteUrl('https://cdn.jsdelivr.net/npm/a@1.0.0/file.js'), true);
  assert.equal(isAllowedRemoteUrl('https://staticimgly.com/model.bin'), true);
  // esm.sh được thêm vào allowlist vì là dependency nội bộ của @imgly package
  assert.equal(isAllowedRemoteUrl('https://esm.sh/@imgly/background-removal@1.5.5?bundle'), true);
  assert.equal(isAllowedRemoteUrl('https://esm.sh/pkg@1.0.0'), true);
});

test('isAllowedRemoteUrl: chặn http (không phải https)', () => {
  assert.equal(isAllowedRemoteUrl('http://cdn.jsdelivr.net/npm/a@1.0.0/file.js'), false);
  assert.equal(isAllowedRemoteUrl('http://esm.sh/pkg@1.0.0'), false);
});

test('isAllowedRemoteUrl: chặn unpkg và các CDN không nằm trong allowlist', () => {
  assert.equal(isAllowedRemoteUrl('https://unpkg.com/lib.js'), false);
  assert.equal(isAllowedRemoteUrl('https://skypack.dev/pkg'), false);
  assert.equal(isAllowedRemoteUrl('https://evil.example.com/x.js'), false);
});

test('isAllowedRemoteUrl: chặn URL không hợp lệ', () => {
  assert.equal(isAllowedRemoteUrl('not-a-url'), false);
  assert.equal(isAllowedRemoteUrl(''), false);
});

test('assertAllowedRemoteUrl: throw khi URL không nằm trong allowlist', () => {
  assert.throws(
    () => assertAllowedRemoteUrl('https://evil.example.com/x.js', 'unit_test'),
    /Blocked non-allowlisted remote URL/,
  );
});

test('assertAllowedRemoteUrl: throw khi dùng http thay vì https', () => {
  assert.throws(
    () => assertAllowedRemoteUrl('http://cdn.jsdelivr.net/npm/a@1.0.0/file.js', 'unit_test'),
    /Blocked non-allowlisted remote URL/,
  );
});

test('assertAllowedRemoteUrl: không throw với URL hợp lệ trong allowlist', () => {
  assert.doesNotThrow(() => assertAllowedRemoteUrl('https://cdn.jsdelivr.net/npm/a@1.0.0/file.js', 'unit_test'));
  assert.doesNotThrow(() => assertAllowedRemoteUrl('https://staticimgly.com/model.bin', 'unit_test'));
  assert.doesNotThrow(() => assertAllowedRemoteUrl('https://esm.sh/@imgly/background-removal@1.5.5?bundle', 'unit_test'));
});

test('isAllowedTelemetryEndpoint: chỉ cho https hoặc localhost http', () => {
  assert.equal(isAllowedTelemetryEndpoint('https://telemetry.example.com/events'), true);
  assert.equal(isAllowedTelemetryEndpoint('http://localhost:4318/events'), true);
  assert.equal(isAllowedTelemetryEndpoint('http://127.0.0.1:4318/events'), true);
  assert.equal(isAllowedTelemetryEndpoint('http://evil.example.com/events'), false);
  assert.equal(isAllowedTelemetryEndpoint('javascript:alert(1)'), false);
});
