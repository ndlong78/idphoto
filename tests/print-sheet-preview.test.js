import test from 'node:test';
import assert from 'node:assert/strict';

import { computePrintSheetLayout } from '../src/print-sheet-layout.js';
import {
  computePrintSheetPreviewGeometry,
  renderPrintSheetPreview,
} from '../src/print-sheet-preview.js';

function createPreviewHarness() {
  const calls = [];
  const context = {
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    clearRect(...args) { calls.push(['clearRect', ...args]); },
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    strokeRect(...args) { calls.push(['strokeRect', ...args]); },
    drawImage(...args) { calls.push(['drawImage', ...args]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(...args) { calls.push(['moveTo', ...args]); },
    lineTo(...args) { calls.push(['lineTo', ...args]); },
    stroke() { calls.push(['stroke']); },
  };
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    dataset: {},
    getContext(type) {
      assert.equal(type, '2d');
      return context;
    },
  };
  return { calls, context, canvas };
}

test('preview 10x15 giữ đúng tỷ lệ giấy và giới hạn DPR ở 2x', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 35,
    photoHeightMm: 45,
  });
  const geometry = computePrintSheetPreviewGeometry(layout, {
    maxWidthCss: 240,
    maxHeightCss: 300,
    devicePixelRatio: 3,
  });

  assert.equal(geometry.cssWidth, 200);
  assert.equal(geometry.cssHeight, 300);
  assert.equal(geometry.pixelWidth, 400);
  assert.equal(geometry.pixelHeight, 600);
  assert.equal(geometry.devicePixelRatio, 2);
  assert.equal(geometry.positions.length, 6);
  assert.equal(Math.round(geometry.photoWidthPx), 140);
  assert.equal(Math.round(geometry.photoHeightPx), 180);
});

test('preview A4 ngang vừa khung 320px mà không đổi hướng layout', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'a4',
    photoWidthMm: 40,
    photoHeightMm: 60,
    copies: 3,
  });
  const geometry = computePrintSheetPreviewGeometry(layout, {
    maxWidthCss: 320,
    maxHeightCss: 320,
  });

  assert.equal(layout.orientation, 'landscape');
  assert.equal(geometry.cssWidth, 320);
  assert.equal(geometry.cssHeight, 226);
  assert.equal(geometry.positions.length, 3);
});

test('render preview dùng ảnh kết quả và ghi metadata debug không chứa dữ liệu nguồn', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 40,
    photoHeightMm: 60,
    copies: 2,
  });
  const harness = createPreviewHarness();
  const sourceCanvas = { width: 472, height: 709 };

  const result = renderPrintSheetPreview(sourceCanvas, layout, {
    canvas: harness.canvas,
    drawCropMarks: false,
    maxWidthCss: 200,
    maxHeightCss: 300,
    devicePixelRatio: 2,
  });

  assert.equal(result.sourceReady, true);
  assert.equal(harness.calls.filter(([name]) => name === 'drawImage').length, 2);
  assert.equal(harness.calls.filter(([name]) => name === 'strokeRect').length, 0);
  assert.equal(harness.canvas.dataset.previewPaper, 'photo-10x15');
  assert.equal(harness.canvas.dataset.previewCopies, '2');
  assert.equal(harness.canvas.dataset.previewSource, 'image');
  assert.equal(harness.canvas.dataset.previewRevision, '1');
  assert.equal('sourceFilename' in harness.canvas.dataset, false);
});

test('preview placeholder vẽ đủ slot khi ảnh kết quả chưa sẵn sàng', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 51,
    photoHeightMm: 51,
  });
  const harness = createPreviewHarness();

  const result = renderPrintSheetPreview(null, layout, {
    canvas: harness.canvas,
    drawCropMarks: true,
  });

  assert.equal(result.sourceReady, false);
  assert.equal(harness.calls.filter(([name]) => name === 'drawImage').length, 0);
  assert.equal(harness.calls.filter(([name]) => name === 'strokeRect').length, 2);
  assert.equal(harness.calls.filter(([name]) => name === 'beginPath').length, 2);
  assert.equal(harness.canvas.dataset.previewSource, 'placeholder');
});

test('preview từ chối layout, kích thước khung và canvas không hợp lệ', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 40,
    photoHeightMm: 60,
  });

  assert.throws(
    () => computePrintSheetPreviewGeometry({}, {}),
    /layout không hợp lệ/,
  );
  assert.throws(
    () => computePrintSheetPreviewGeometry(layout, { maxWidthCss: 0 }),
    /Chiều rộng preview/,
  );
  assert.throws(
    () => renderPrintSheetPreview(null, layout, { canvas: {} }),
    /Canvas preview không hợp lệ/,
  );
});
