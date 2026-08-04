import test from 'node:test';
import assert from 'node:assert/strict';

import { downloadExportAudit } from '../src/export-audit.js';
import {
  clearStagedExportForBundle,
  stageExportForBundle,
} from '../src/export-delivery-session.js';
import {
  clearExportRecovery,
  downloadRecoveryImage,
  getExportRecoverySnapshot,
  hasExportRecovery,
  retryExportBundle,
  stageExportRecovery,
} from '../src/export-recovery.js';
import {
  buildExportReceipt,
  clearExportReceipt,
  exportReceiptStore,
} from '../src/export-receipt.js';
import { buildExportReceiptViewModel } from '../src/export-receipt-view.js';
import { manualReviewStore } from '../src/manual-review.js';

function createDownloadHarness({ failZipDownloads = 0 } = {}) {
  const blobs = [];
  const clicks = [];
  let remainingZipFailures = failZipDownloads;
  const documentRef = {
    body: { appendChild() {} },
    createElement() {
      return {
        download: '',
        href: '',
        hidden: false,
        click() {
          clicks.push({ filename: this.download, href: this.href });
        },
        remove() {},
      };
    },
  };
  const urlApi = {
    createObjectURL(blob) {
      if (blob.type === 'application/zip' && remainingZipFailures > 0) {
        remainingZipFailures -= 1;
        throw new Error('Trình duyệt tạm thời từ chối ZIP.');
      }
      blobs.push(blob);
      return `blob:recovery-${blobs.length}`;
    },
    revokeObjectURL() {},
  };
  const windowRef = { setTimeout() { return 1; } };
  return { blobs, clicks, documentRef, urlApi, windowRef };
}

function minimalAudit(imageFilename = 'photo.jpeg') {
  return {
    schemaVersion: 1,
    kind: 'idphoto-export-audit',
    export: {
      imageFilename,
      mode: 'jpeg600',
      widthPx: 1205,
      heightPx: 1205,
      dpi: 600,
    },
    profile: { formatKey: 'us-visa' },
  };
}

function stageValidRecovery() {
  return stageExportRecovery({
    imageFilename: 'photo.jpeg',
    imageBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    imageMimeType: 'image/jpeg',
    auditFilename: 'photo.audit.json',
    auditContent: '{"schemaVersion":1}\n',
    mode: 'jpeg600',
    formatKey: 'us-visa',
    widthPx: 1205,
    heightPx: 1205,
    dpi: 600,
  });
}

test('recovery snapshot không làm lộ byte ảnh hoặc tên file nguồn', () => {
  clearExportRecovery();
  const snapshot = stageValidRecovery();
  assert.equal(snapshot.imageFilename, 'photo.jpeg');
  assert.equal(snapshot.imageSizeBytes, 4);
  assert.equal(snapshot.privacy.exposesImageBytes, false);
  assert.equal(snapshot.privacy.containsOriginalFilename, false);
  assert.equal(Object.hasOwn(snapshot, 'imageBytes'), false);
  assert.equal(Object.hasOwn(snapshot, 'auditContent'), false);
});

test('receipt fallback chỉ hiện recovery actions khi cache còn khả dụng', () => {
  const withoutRecovery = buildExportReceiptViewModel(buildExportReceipt({
    delivery: 'image-fallback',
    status: 'fallback',
    filename: 'photo.jpeg',
  }));
  assert.deepEqual(withoutRecovery.actions, []);

  const withRecovery = buildExportReceiptViewModel(buildExportReceipt({
    delivery: 'image-fallback',
    status: 'fallback',
    filename: 'photo.jpeg',
    recoveryAvailable: true,
  }));
  assert.deepEqual(withRecovery.actions.map((action) => action.id), [
    'retry-bundle',
    'download-image',
  ]);
});

test('lỗi gửi ZIP tải ảnh fallback và giữ dữ liệu để thử lại', () => {
  clearExportReceipt();
  clearExportRecovery();
  clearStagedExportForBundle();
  stageExportForBundle({
    filename: 'photo.jpeg',
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    mimeType: 'image/jpeg',
    width: 1205,
    height: 1205,
    targetDpi: 600,
  });
  const harness = createDownloadHarness({ failZipDownloads: 1 });

  let caught = null;
  try {
    downloadExportAudit(minimalAudit(), harness);
  } catch (error) {
    caught = error;
  }

  const receipt = exportReceiptStore.get();
  assert.equal(Boolean(caught), true);
  assert.equal(caught.imageFallbackDownloaded, true);
  assert.equal(caught.exportRecoveryAvailable, true);
  assert.equal(hasExportRecovery(), true);
  assert.equal(receipt.delivery, 'image-fallback');
  assert.equal(receipt.recoveryAvailable, true);
  assert.deepEqual(harness.clicks.map((click) => click.filename), ['photo.jpeg']);
});

test('thử lại ZIP thành công không render lại và xóa recovery cache', () => {
  clearExportReceipt();
  clearExportRecovery();
  stageValidRecovery();
  const harness = createDownloadHarness();
  const result = retryExportBundle(harness);
  const receipt = exportReceiptStore.get();

  assert.equal(result.recovered, true);
  assert.equal(result.filename, 'photo.bundle.zip');
  assert.equal(hasExportRecovery(), false);
  assert.equal(receipt.delivery, 'bundle-zip');
  assert.equal(receipt.entries.length, 2);
  assert.deepEqual(harness.clicks.map((click) => click.filename), ['photo.bundle.zip']);
});

test('thử lại ZIP thất bại vẫn giữ cache và recovery actions', () => {
  clearExportReceipt();
  clearExportRecovery();
  stageValidRecovery();
  const harness = createDownloadHarness({ failZipDownloads: 1 });

  assert.throws(() => retryExportBundle(harness), /từ chối ZIP/);
  const receipt = exportReceiptStore.get();
  assert.equal(hasExportRecovery(), true);
  assert.equal(receipt.delivery, 'image-fallback');
  assert.equal(receipt.recoveryAvailable, true);
  assert.match(receipt.note, /vẫn được giữ/);
});

test('tải lại ảnh đơn từ recovery rồi xóa cache', () => {
  clearExportReceipt();
  clearExportRecovery();
  stageValidRecovery();
  const harness = createDownloadHarness();
  const result = downloadRecoveryImage(harness);
  const receipt = exportReceiptStore.get();

  assert.equal(result.filename, 'photo.jpeg');
  assert.equal(hasExportRecovery(), false);
  assert.equal(receipt.delivery, 'image');
  assert.equal(receipt.recoveryAvailable, false);
  assert.deepEqual(harness.clicks.map((click) => click.filename), ['photo.jpeg']);
});

test('lỗi cấu trúc ZIP vẫn fallback nhưng không đề xuất retry vô ích', () => {
  clearExportReceipt();
  clearExportRecovery();
  clearStagedExportForBundle();
  stageExportForBundle({
    filename: 'photo.audit.json',
    bytes: new Uint8Array([9, 8, 7]),
    mimeType: 'image/jpeg',
    width: 600,
    height: 800,
    targetDpi: 300,
  });
  const harness = createDownloadHarness();

  let caught = null;
  try {
    downloadExportAudit(minimalAudit('photo.jpeg'), harness);
  } catch (error) {
    caught = error;
  }

  const receipt = exportReceiptStore.get();
  assert.equal(Boolean(caught), true);
  assert.equal(caught.exportRecoveryAvailable, false);
  assert.equal(hasExportRecovery(), false);
  assert.equal(receipt.recoveryAvailable, false);
});

test('upload ảnh mới xóa cả receipt và recovery cache', () => {
  clearExportReceipt();
  clearExportRecovery();
  stageValidRecovery();
  manualReviewStore.reset({});
  assert.equal(exportReceiptStore.get(), null);
  assert.equal(getExportRecoverySnapshot(), null);
});
