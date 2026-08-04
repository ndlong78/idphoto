import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasStagedExportForBundle,
  stageExportForBundle,
} from '../src/export-delivery-session.js';
import {
  getExportRecoverySnapshot,
  hasExportRecovery,
  stageExportRecovery,
} from '../src/export-recovery.js';
import {
  exportReceiptStore,
  recordExportReceipt,
} from '../src/export-receipt.js';
import {
  clearExportSession,
  getExportSessionSnapshot,
} from '../src/export-session.js';
import { manualReviewStore } from '../src/manual-review.js';
import { resetState, state } from '../src/state.js';

function seedExportSession() {
  const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  stageExportForBundle({
    filename: 'photovisa_test.jpeg',
    bytes: imageBytes,
  });
  stageExportRecovery({
    imageFilename: 'photovisa_test.jpeg',
    imageBytes,
    imageMimeType: 'image/jpeg',
    auditFilename: 'photovisa_test.audit.json',
    auditContent: '{"kind":"idphoto-export-audit"}\n',
    mode: 'jpeg300',
    formatKey: 'passport-vn',
    widthPx: 472,
    heightPx: 709,
    dpi: 300,
  });
  recordExportReceipt({
    delivery: 'image-fallback',
    status: 'fallback',
    filename: 'photovisa_test.jpeg',
    sizeBytes: imageBytes.length,
    mimeType: 'image/jpeg',
    recoveryAvailable: true,
  });
}

test.beforeEach(() => {
  clearExportSession();
  manualReviewStore.reset(null);
});

test.afterEach(() => {
  clearExportSession();
  manualReviewStore.reset(null);
});

test('clearExportSession xóa receipt, recovery và staged ZIP cùng lúc', () => {
  seedExportSession();
  assert.deepEqual(getExportSessionSnapshot(), {
    hasStagedBundle: true,
    hasRecovery: true,
    hasReceipt: true,
  });

  clearExportSession();

  assert.deepEqual(getExportSessionSnapshot(), {
    hasStagedBundle: false,
    hasRecovery: false,
    hasReceipt: false,
  });
  assert.equal(hasStagedExportForBundle(), false);
  assert.equal(hasExportRecovery(), false);
  assert.equal(getExportRecoverySnapshot(), null);
  assert.equal(exportReceiptStore.get(), null);
});

test('manualReviewStore.reset xóa cả export session và audit preference', () => {
  const source = { name: 'first.png' };
  manualReviewStore.setAuditEnabled(source, true);
  manualReviewStore.setItem(source, 'passport-vn', 'manual:eyes', true);
  seedExportSession();

  manualReviewStore.reset({ name: 'second.png' });

  assert.deepEqual(getExportSessionSnapshot(), {
    hasStagedBundle: false,
    hasRecovery: false,
    hasReceipt: false,
  });
  assert.equal(manualReviewStore.isAuditEnabled({ name: 'second.png' }), false);
  assert.deepEqual(
    [...manualReviewStore.getCompletedKeys({ name: 'second.png' }, 'passport-vn')],
    [],
  );
});

test('resetState trả toàn bộ source state về mặc định nhưng giữ AI warm state', () => {
  seedExportSession();
  state.origImg = { width: 320, height: 480 };
  state.origFile = { name: 'first.png' };
  state.aiMaskImg = { width: 320, height: 480 };
  state.curFmt = 'us-visa';
  state.bgColor = { r: 201, g: 223, b: 240 };
  state.faceAdjust = { yOffsetPct: 12 };
  state.resultFaceOffsetPct = { x: 5, y: -3 };
  state.aiReady = true;

  resetState();

  assert.equal(state.origImg, null);
  assert.equal(state.origFile, null);
  assert.equal(state.aiMaskImg, null);
  assert.equal(state.curFmt, 'passport-vn');
  assert.deepEqual(state.bgColor, { r: 255, g: 255, b: 255 });
  assert.deepEqual(state.faceAdjust, { yOffsetPct: 0 });
  assert.deepEqual(state.resultFaceOffsetPct, { x: 0, y: 0 });
  assert.equal(state.aiReady, true);
  assert.deepEqual(getExportSessionSnapshot(), {
    hasStagedBundle: false,
    hasRecovery: false,
    hasReceipt: false,
  });
});
