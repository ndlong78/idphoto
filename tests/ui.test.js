import test from 'node:test';
import assert from 'node:assert/strict';

import { initUI, setSection } from '../src/ui.js';

test('initUI: không throw khi thiếu các DOM node critical', () => {
  const prevDocument = globalThis.document;
  const prevWindow = globalThis.window;

  globalThis.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  globalThis.window = {
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    cancelAnimationFrame: () => {},
  };

  try {
    assert.doesNotThrow(() => initUI({
      onPickFile: () => {},
      onReprocessAI: async () => {},
      onDownload: async () => {},
      onCopy: async () => {},
      onFileDrop: () => {},
      onFileInput: () => {},
    }));
  } finally {
    globalThis.document = prevDocument;
    globalThis.window = prevWindow;
  }
});

test('setSection: không throw khi thiếu section node', () => {
  const prevDocument = globalThis.document;
  globalThis.document = {
    getElementById: () => null,
  };

  try {
    assert.doesNotThrow(() => setSection('upload'));
    assert.doesNotThrow(() => setSection('loading'));
    assert.doesNotThrow(() => setSection('editor'));
  } finally {
    globalThis.document = prevDocument;
  }
});
