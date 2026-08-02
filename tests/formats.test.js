import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ensureCanvasDimensions, resolveExportConfig } from '../src/export.js';
import { FMTS, mmToPixels } from '../src/state.js';

test('mmToPixels: chuyển kích thước vật lý sang pixel theo DPI', () => {
  assert.equal(mmToPixels(40, 300), 472);
  assert.equal(mmToPixels(60, 300), 709);
  assert.equal(mmToPixels(51, 300), 602);
  assert.equal(mmToPixels(40, 600), 945);
  assert.equal(mmToPixels(60, 600), 1417);
});

test('FMTS: hộ chiếu Việt Nam dùng ảnh 40 × 60 mm', () => {
  const format = FMTS['passport-vn'];
  assert.deepEqual(
    { mmW: format.mmW, mmH: format.mmH, w: format.w, h: format.h, dpi: format.dpi, lbl: format.lbl },
    { mmW: 40, mmH: 60, w: 472, h: 709, dpi: 300, lbl: '40 × 60 mm' },
  );
});

test('FMTS: mọi preset có pixel khớp kích thước vật lý', () => {
  for (const [key, format] of Object.entries(FMTS)) {
    assert.equal(format.w, mmToPixels(format.mmW, format.dpi), `${key}: width`);
    assert.equal(format.h, mmToPixels(format.mmH, format.dpi), `${key}: height`);
  }
});

test('export: hộ chiếu Việt Nam xuất đúng kích thước 300 và 600 DPI', () => {
  const format = FMTS['passport-vn'];
  assert.deepEqual(
    resolveExportConfig('jpeg300', format),
    {
      mimeType: 'image/jpeg',
      extension: 'jpeg',
      dpiMultiplier: 1,
      targetDpi: 300,
      scale: 1,
      width: 472,
      height: 709,
    },
  );
  assert.deepEqual(
    resolveExportConfig('jpeg600', format),
    {
      mimeType: 'image/jpeg',
      extension: 'jpeg',
      dpiMultiplier: 2,
      targetDpi: 600,
      scale: 2,
      width: 945,
      height: 1417,
    },
  );
});

test('ensureCanvasDimensions: chỉ resample khi kích thước render lệch do làm tròn', () => {
  const previousDocument = globalThis.document;
  const drawCalls = [];
  const exactCanvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (...args) => drawCalls.push(args),
    }),
  };
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, 'canvas');
      return exactCanvas;
    },
  };

  try {
    const sourceCanvas = { width: 944, height: 1418 };
    const output = ensureCanvasDimensions(sourceCanvas, 945, 1417);
    assert.equal(output, exactCanvas);
    assert.equal(output.width, 945);
    assert.equal(output.height, 1417);
    assert.deepEqual(drawCalls, [[sourceCanvas, 0, 0, 945, 1417]]);

    assert.equal(ensureCanvasDimensions(output, 945, 1417), output);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('UI và README không còn quảng bá hộ chiếu Việt Nam 35 × 45 mm', async () => {
  const [html, readme] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /Hộ chiếu VN<\/span><span class="fs">40 × 60 mm<\/span>/);
  assert.match(html, /id="size-badge">40 × 60 mm<\/div>/);
  assert.doesNotMatch(html, /Hộ chiếu VN<\/span><span class="fs">35 × 45 mm<\/span>/);
  assert.doesNotMatch(html, /chuẩn quốc tế/i);
  assert.match(readme, /Hộ chiếu VN \(40×60mm\)/);
});
