import test from 'node:test';
import assert from 'node:assert/strict';

const MODULES = [
  '../src/constants.js',
  '../src/state.js',
  '../src/security.js',
  '../src/telemetry.js',
  '../src/pipeline.js',
  '../src/dom.js',
  '../src/render.js',
  '../src/crop.js',
  '../src/ui.js',
  '../src/ai.js',
  '../src/main.js',
];

test('smoke: import toàn bộ module chính không lỗi parse/runtime top-level', async () => {
  const previousDocument = globalThis.document;

  globalThis.document = {
    addEventListener: () => {},
    querySelectorAll: () => [],
    getElementById: () => null,
    head: { appendChild: () => {} },
  };

  try {
    for (const modulePath of MODULES) {
      const mod = await import(modulePath);
      assert.ok(mod, `Module ${modulePath} phải import được`);
    }
  } finally {
    globalThis.document = previousDocument;
  }
});
