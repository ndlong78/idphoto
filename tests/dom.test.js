import test from 'node:test';
import assert from 'node:assert/strict';

import { getControls, syncZoomUI } from '../src/dom.js';
import { state } from '../src/state.js';

test('getControls: fallback valueAsNumber=0 khi thiếu DOM controls', () => {
  const prevDocument = globalThis.document;
  globalThis.document = {
    getElementById: () => null,
  };

  try {
    const controls = getControls();
    assert.equal(controls.bright.valueAsNumber, 0);
    assert.equal(controls.contrast.valueAsNumber, 0);
    assert.equal(controls.sharp.valueAsNumber, 0);
    assert.equal(controls.skin.valueAsNumber, 0);
    assert.equal(controls.feather.valueAsNumber, 0);
    assert.equal(controls.shadow.valueAsNumber, 0);
  } finally {
    globalThis.document = prevDocument;
  }
});

test('syncZoomUI: không throw khi thiếu zoom-lbl/zoom-range', () => {
  const prevDocument = globalThis.document;
  const prevScale = state.crop.scale;

  globalThis.document = {
    getElementById: () => null,
  };

  state.crop.scale = 1.23;

  try {
    assert.doesNotThrow(() => syncZoomUI());
  } finally {
    state.crop.scale = prevScale;
    globalThis.document = prevDocument;
  }
});
