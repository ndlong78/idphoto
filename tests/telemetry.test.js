import test from 'node:test';
import assert from 'node:assert/strict';

import { clearTelemetryEvents, logEvent } from '../src/telemetry.js';

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
