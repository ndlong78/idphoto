import test from 'node:test';
import assert from 'node:assert/strict';

async function importMainForGuardTest() {
  const prevDocument = globalThis.document;
  globalThis.document = {
    addEventListener: () => {},
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    head: { appendChild: () => {} },
  };

  try {
    return await import(`../src/main.js?guard-test=${Date.now()}`);
  } finally {
    globalThis.document = prevDocument;
  }
}

test('assertBrowserFileInput: throw với undefined/null/fake object', async () => {
  const { assertBrowserFileInput } = await importMainForGuardTest();

  assert.throws(() => assertBrowserFileInput(undefined), /main\.handleFile/i);
  assert.throws(() => assertBrowserFileInput(null), /main\.handleFile/i);
  assert.throws(
    () => assertBrowserFileInput({ name: 'x.jpg', type: 'image/jpeg', size: 12 }),
    /fake object|không hợp lệ/i,
  );
});

test('assertBrowserFileInput: pass với File hợp lệ', async () => {
  const { assertBrowserFileInput } = await importMainForGuardTest();
  const file = new File([new Uint8Array(8)], 'ok.jpg', { type: 'image/jpeg' });

  assert.equal(assertBrowserFileInput(file), file);
});
