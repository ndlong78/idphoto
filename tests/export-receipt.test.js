import test from 'node:test';
import assert from 'node:assert/strict';

import { downloadExportAudit } from '../src/export-audit.js';
import {
  clearStagedExportForBundle,
  stageExportForBundle,
} from '../src/export-delivery-session.js';
import {
  buildExportReceipt,
  clearExportReceipt,
  createExportReceiptStore,
  exportReceiptStore,
  formatByteSize,
  recordExportReceipt,
} from '../src/export-receipt.js';
import { buildExportReceiptViewModel } from '../src/export-receipt-view.js';
import { manualReviewStore } from '../src/manual-review.js';

function createDownloadHarness() {
  const blobs = [];
  const clicks = [];
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
      blobs.push(blob);
      return `blob:receipt-${blobs.length}`;
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

test('receipt ảnh đơn chỉ giữ metadata đầu ra và cờ quyền riêng tư', () => {
  const receipt = buildExportReceipt({
    delivery: 'image',
    filename: 'photovisa_us-visa_1205x1205_600dpi.jpeg',
    sizeBytes: 456789,
    mimeType: 'image/jpeg',
    generatedAt: '2026-08-04T14:30:00.000Z',
    mode: 'jpeg600',
    formatKey: 'us-visa',
    widthPx: 1205,
    heightPx: 1205,
    dpi: 600,
  });

  assert.equal(receipt.delivery, 'image');
  assert.equal(receipt.filename, 'photovisa_us-visa_1205x1205_600dpi.jpeg');
  assert.equal(receipt.privacy.containsImageData, false);
  assert.equal(receipt.privacy.containsFaceGeometry, false);
  assert.equal(receipt.privacy.containsOriginalFilename, false);
  assert.equal(Object.hasOwn(receipt, 'sourceFilename'), false);
  assert.equal(Object.isFrozen(receipt), true);
});

test('receipt bundle giữ danh sách file bên trong', () => {
  const receipt = buildExportReceipt({
    delivery: 'bundle-zip',
    filename: 'photo.bundle.zip',
    sizeBytes: 4096,
    entries: [
      { name: 'photo.jpeg', sizeBytes: 3000 },
      { name: 'photo.audit.json', sizeBytes: 700 },
    ],
  });
  assert.deepEqual(receipt.entries.map((entry) => entry.name), [
    'photo.jpeg',
    'photo.audit.json',
  ]);
  assert.equal(Object.isFrozen(receipt.entries), true);
});

test('format dung lượng dễ đọc và có fallback', () => {
  assert.equal(formatByteSize(999), '999 B');
  assert.equal(formatByteSize(1024), '1.00 KB');
  assert.equal(formatByteSize(5 * 1024 * 1024), '5.00 MB');
  assert.equal(formatByteSize(null), 'Không rõ dung lượng');
});

test('receipt store phát trạng thái mới và clear trong phiên', () => {
  const store = createExportReceiptStore();
  const observed = [];
  const unsubscribe = store.subscribe((receipt) => observed.push(receipt?.delivery ?? null));
  store.record({ delivery: 'image', filename: 'photo.jpeg' });
  store.clear();
  unsubscribe();
  store.record({ delivery: 'audit-json', filename: 'photo.audit.json' });

  assert.deepEqual(observed, [null, 'image', null]);
  assert.equal(store.get().delivery, 'audit-json');
});

test('view model phân biệt ZIP và fallback', () => {
  const zipModel = buildExportReceiptViewModel(buildExportReceipt({
    delivery: 'bundle-zip',
    filename: 'photo.bundle.zip',
    sizeBytes: 5000,
    generatedAt: '2026-08-04T14:30:00.000Z',
    entries: [{ name: 'photo.jpeg', sizeBytes: 4000 }],
  }), { locale: 'vi-VN', timeZone: 'UTC' });
  assert.equal(zipModel.badge, 'Gói ZIP');
  assert.equal(zipModel.entries.length, 1);
  assert.equal(zipModel.tone, 'success');

  const fallbackModel = buildExportReceiptViewModel(buildExportReceipt({
    delivery: 'image-fallback',
    status: 'fallback',
    filename: 'photo.jpeg',
    note: 'ZIP lỗi.',
  }));
  assert.equal(fallbackModel.badge, 'Ảnh fallback');
  assert.equal(fallbackModel.tone, 'fallback');
  assert.match(fallbackModel.title, /dự phòng/);
});

test('bundle thành công ghi receipt ZIP với hai entry', () => {
  clearExportReceipt();
  clearStagedExportForBundle();
  stageExportForBundle({
    filename: 'photo.jpeg',
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    mimeType: 'image/jpeg',
    width: 1205,
    height: 1205,
    targetDpi: 600,
  });
  const harness = createDownloadHarness();
  const result = downloadExportAudit(minimalAudit(), harness);
  const receipt = exportReceiptStore.get();

  assert.equal(result.bundled, true);
  assert.equal(receipt.delivery, 'bundle-zip');
  assert.equal(receipt.filename, 'photo.bundle.zip');
  assert.equal(receipt.entries.length, 2);
  assert.equal(harness.clicks.length, 1);
});

test('bundle lỗi ghi receipt fallback và đánh dấu error', () => {
  clearExportReceipt();
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
  assert.equal(caught.imageFallbackDownloaded, true);
  assert.equal(receipt.delivery, 'image-fallback');
  assert.equal(receipt.status, 'fallback');
  assert.equal(receipt.filename, 'photo.audit.json');
  assert.equal(harness.clicks.length, 1);
});

test('reset ảnh nguồn xóa receipt toàn cục nhưng store thuần vẫn độc lập', () => {
  recordExportReceipt({ delivery: 'image', filename: 'old-photo.jpeg' });
  assert.equal(exportReceiptStore.get().filename, 'old-photo.jpeg');
  manualReviewStore.reset({});
  assert.equal(exportReceiptStore.get(), null);
});
