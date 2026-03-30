import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderToPreview,
  __setPreviewRenderPartsForTest,
  __resetPreviewRenderStateForTest,
} from '../src/render.js';

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function makeParts(tag) {
  return {
    background: { width: 2, height: 2, __tag: `bg:${tag}` },
    faceCutout: { width: 2, height: 2, __tag: `face:${tag}` },
    composed: { width: 2, height: 2, __tag: `composed:${tag}` },
  };
}

test('renderToPreview: request cũ hoàn tất sau không được ghi đè request mới nhất', async () => {
  const prevDocument = globalThis.document;

  const previewCanvas = {
    width: 0,
    height: 0,
    style: {},
    lastFaceTag: '',
    getContext: () => ({
      clearRect: () => {},
      drawImage: (img) => {
        if (img?.__tag?.startsWith('face:')) {
          previewCanvas.lastFaceTag = img.__tag;
        }
      },
    }),
  };

  globalThis.document = {
    getElementById: (id) => (id === 'result-canvas' ? previewCanvas : null),
  };

  const first = deferred();
  let callCount = 0;

  __resetPreviewRenderStateForTest();
  __setPreviewRenderPartsForTest(async () => {
    callCount += 1;
    if (callCount === 1) return first.promise;
    return makeParts('new');
  });

  try {
    const p1 = renderToPreview();
    const p2 = renderToPreview();

    first.resolve(makeParts('old'));

    await Promise.all([p1, p2]);

    assert.equal(callCount, 2, 'Phải có render pending chạy lại sau request đầu');
    assert.equal(previewCanvas.lastFaceTag, 'face:new');
  } finally {
    __resetPreviewRenderStateForTest();
    globalThis.document = prevDocument;
  }
});
