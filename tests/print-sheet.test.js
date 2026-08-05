import test from 'node:test';
import assert from 'node:assert/strict';

import { computePrintSheetLayout } from '../src/print-sheet-layout.js';
import { composePrintSheetCanvas } from '../src/print-sheet.js';

function createCanvasHarness() {
  const calls = [];
  const context = {
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    drawImage(...args) { calls.push(['drawImage', ...args]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(...args) { calls.push(['moveTo', ...args]); },
    lineTo(...args) { calls.push(['lineTo', ...args]); },
    stroke() { calls.push(['stroke']); },
  };
  const sheetCanvas = {
    width: 0,
    height: 0,
    getContext(type) {
      assert.equal(type, '2d');
      return context;
    },
  };
  const documentRef = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return sheetCanvas;
    },
  };
  return { calls, context, documentRef, sheetCanvas };
}

test('composePrintSheetCanvas tạo đúng canvas 10x15 300 DPI và vẽ đủ sáu ảnh', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 35,
    photoHeightMm: 45,
  });
  const photoCanvas = { width: 413, height: 531 };
  const harness = createCanvasHarness();

  const sheet = composePrintSheetCanvas(photoCanvas, layout, {
    documentRef: harness.documentRef,
    drawCropMarks: false,
  });

  assert.equal(sheet.width, 1181);
  assert.equal(sheet.height, 1772);
  assert.equal(harness.calls.filter(([name]) => name === 'drawImage').length, 6);
  assert.deepEqual(harness.calls.find(([name]) => name === 'fillRect'), [
    'fillRect',
    0,
    0,
    1181,
    1772,
  ]);
  assert.equal(harness.context.fillStyle, '#ffffff');
  assert.equal(harness.context.imageSmoothingEnabled, true);
  assert.equal(harness.context.imageSmoothingQuality, 'high');
});

test('composePrintSheetCanvas vẽ crop marks ngoài từng ảnh khi được bật', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 40,
    photoHeightMm: 60,
    copies: 2,
  });
  const harness = createCanvasHarness();

  composePrintSheetCanvas({ width: 472, height: 709 }, layout, {
    documentRef: harness.documentRef,
    drawCropMarks: true,
  });

  assert.equal(harness.calls.filter(([name]) => name === 'drawImage').length, 2);
  assert.equal(harness.calls.filter(([name]) => name === 'beginPath').length, 2);
  assert.equal(harness.calls.filter(([name]) => name === 'stroke').length, 2);
  assert.ok(harness.calls.filter(([name]) => name === 'lineTo').length >= 16);
});

test('composePrintSheetCanvas từ chối canvas hoặc layout không hợp lệ', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 40,
    photoHeightMm: 60,
  });
  const harness = createCanvasHarness();

  assert.throws(
    () => composePrintSheetCanvas({ width: 0, height: 100 }, layout, {
      documentRef: harness.documentRef,
    }),
    /Canvas ảnh nguồn không hợp lệ/,
  );
  assert.throws(
    () => composePrintSheetCanvas({ width: 472, height: 709 }, {}, {
      documentRef: harness.documentRef,
    }),
    /layout không hợp lệ/,
  );
});
