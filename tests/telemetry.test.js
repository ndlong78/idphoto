import test from 'node:test';
import assert from 'node:assert/strict';

import { clearTelemetryEvents, logEvent, serializeErrorForTelemetry } from '../src/telemetry.js';

test('telemetry: mặc định chỉ log console với level error', () => {
  clearTelemetryEvents();

  const calls = { error: 0, warn: 0, info: 0 };
  const prevError = console.error;
  const prevWarn = console.warn;
  const prevInfo = console.info;

  console.error = () => { calls.error += 1; };
  console.warn = () => { calls.warn += 1; };
  console.info = () => { calls.info += 1; };

  try {
    delete globalThis.__IDPHOTO_CONFIG__;
    logEvent('test.warn', {}, 'warn');
    logEvent('test.info', {}, 'info');
    logEvent('test.error', {}, 'error');
  } finally {
    console.error = prevError;
    console.warn = prevWarn;
    console.info = prevInfo;
    delete globalThis.__IDPHOTO_CONFIG__;
  }

  assert.equal(calls.error, 1);
  assert.equal(calls.warn, 0);
  assert.equal(calls.info, 0);
});

test('telemetry: cho phép bật console info bằng telemetryConsoleLevel', () => {
  clearTelemetryEvents();

  const calls = { error: 0, warn: 0, info: 0 };
  const prevError = console.error;
  const prevWarn = console.warn;
  const prevInfo = console.info;

  console.error = () => { calls.error += 1; };
  console.warn = () => { calls.warn += 1; };
  console.info = () => { calls.info += 1; };

  try {
    globalThis.__IDPHOTO_CONFIG__ = { telemetryConsoleLevel: 'info' };
    logEvent('test.warn', {}, 'warn');
    logEvent('test.info', {}, 'info');
    logEvent('test.error', {}, 'error');
  } finally {
    console.error = prevError;
    console.warn = prevWarn;
    console.info = prevInfo;
    delete globalThis.__IDPHOTO_CONFIG__;
  }

  assert.equal(calls.error, 1);
  assert.equal(calls.warn, 1);
  assert.equal(calls.info, 1);
});

test('telemetry: serializeErrorForTelemetry chỉ lấy field an toàn', () => {
  const err = new Error('Token abc123 bị từ chối');
  err.code = 'E_AUTH';
  err.status = 401;
  err.secret = 'TOP_SECRET_VALUE';
  err.cause = new Error('network unreachable');

  const serialized = serializeErrorForTelemetry(err, { fallbackMessage: 'fallback' });

  assert.equal(serialized.name, 'Error');
  assert.equal(serialized.message, 'Token abc123 bị từ chối');
  assert.equal(serialized.code, 'E_AUTH');
  assert.equal(serialized.status, 401);
  assert.ok(serialized.stack, 'phải có stack cho Error');
  assert.deepEqual(serialized.cause, { name: 'Error', message: 'network unreachable' });
  assert.equal(Object.hasOwn(serialized, 'secret'), false, 'không được serialize field nhạy cảm tùy ý');
});

test('telemetry: serializeErrorForTelemetry xử lý non-error value', () => {
  const serialized = serializeErrorForTelemetry({ token: 'abc', reason: 'bad' }, { fallbackMessage: 'fallback' });

  assert.equal(serialized.name, 'NonError');
  assert.equal(serialized.type, 'object');
  assert.match(serialized.message, /\[object Object\]/);
});
