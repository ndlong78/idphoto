import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrintSheetPdfFilename,
  createPrintSheetPdfBlob,
  downloadPrintSheetPdf,
} from '../src/print-sheet-pdf.js';
import {
  clearExportReceipt,
  exportReceiptStore,
} from '../src/export-receipt.js';
import { buildExportReceiptViewModel } from '../src/export-receipt-view.js';

const JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xd9,
]);

function sheetFixture(overrides = {}) {
  return {
    blob: new Blob([JPEG_BYTES], { type: 'image/jpeg' }),
    filename: 'photovisa_sheet_photo-10x15_passport-vn_4copies_1181x1772_300dpi.jpeg',
    mode: 'print-sheet-300',
    mimeType: 'image/jpeg',
    width: 1181,
    height: 1772,
    targetDpi: 300,
    paperKey: 'photo-10x15',
    paperLabel: '10 × 15 cm',
    orientation: 'portrait',
    copies: 4,
    columns: 2,
    rowsUsed: 2,
    capacity: 4,
    gapMm: 3,
    marginMm: 4,
    drawCropMarks: true,
    photoWidth: 472,
    photoHeight: 709,
    ...overrides,
  };
}

function createDownloadHarness() {
  const blobs = [];
  const clicks = [];
  const documentRef = {
    body: { appendChild() {} },
    createElement(tag) {
      assert.equal(tag, 'a');
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
      return `blob:pdf-${blobs.length}`;
    },
    revokeObjectURL() {},
  };
  const windowRef = { setTimeout() { return 1; } };
  return { blobs, clicks, documentRef, urlApi, windowRef };
}

function asAscii(bytes) {
  return new TextDecoder('latin1').decode(bytes);
}

test('createPrintSheetPdfBlob bọc JPEG 10x15 vào PDF đúng khổ', async () => {
  const result = await createPrintSheetPdfBlob({}, {
    createSheetBlob: async () => sheetFixture(),
  });
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const text = asAscii(bytes);

  assert.equal(result.filename, 'photovisa_sheet_photo-10x15_passport-vn_4copies_1181x1772_300dpi.pdf');
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(result.mode, 'print-sheet-pdf');
  assert.equal(result.pageWidthMm, 100);
  assert.equal(result.pageHeightMm, 150);
  assert.equal(result.embeddedJpegSizeBytes, JPEG_BYTES.length);
  assert.equal(text.startsWith('%PDF-1.4'), true);
  assert.match(text, /\/MediaBox \[0 0 283\.4646 425\.1969\]/);
  assert.match(text, /\/Width 1181 \/Height 1772/);
});

test('A4 landscape tạo page ngang nhưng giữ kích thước ảnh nhúng', async () => {
  const result = await createPrintSheetPdfBlob({}, {
    createSheetBlob: async () => sheetFixture({
      filename: 'photovisa_sheet_a4_passport-vn_3copies_3508x2480_300dpi.jpeg',
      width: 3508,
      height: 2480,
      paperKey: 'a4',
      paperLabel: 'A4',
      orientation: 'landscape',
      copies: 3,
      columns: 6,
      rowsUsed: 1,
      capacity: 18,
    }),
  });
  const text = asAscii(new Uint8Array(await result.blob.arrayBuffer()));

  assert.equal(result.pageWidthMm, 297);
  assert.equal(result.pageHeightMm, 210);
  assert.match(text, /\/MediaBox \[0 0 841\.8898 595\.2756\]/);
  assert.match(text, /\/Width 3508 \/Height 2480/);
});

test('downloadPrintSheetPdf tải một file và ghi receipt PDF riêng tư', async () => {
  clearExportReceipt();
  const harness = createDownloadHarness();
  const result = await downloadPrintSheetPdf({}, {
    ...harness,
    createSheetBlob: async () => sheetFixture(),
  });
  const receipt = exportReceiptStore.get();
  const model = buildExportReceiptViewModel(receipt, {
    locale: 'vi-VN',
    timeZone: 'UTC',
  });

  assert.equal(harness.clicks.length, 1);
  assert.equal(harness.clicks[0].filename, result.filename);
  assert.equal(harness.blobs[0].type, 'application/pdf');
  assert.equal(receipt.delivery, 'print-sheet-pdf');
  assert.equal(receipt.mimeType, 'application/pdf');
  assert.equal(receipt.privacy.containsImageData, false);
  assert.equal(receipt.privacy.containsFaceGeometry, false);
  assert.equal(receipt.privacy.containsOriginalFilename, false);
  assert.equal(model.badge, 'PDF in');
  assert.match(model.note, /Actual size \/ 100%/);
});

test('PDF filename chỉ nhận tên JPEG hợp lệ', () => {
  assert.equal(
    buildPrintSheetPdfFilename('sheet.JPEG'),
    'sheet.pdf',
  );
  assert.throws(() => buildPrintSheetPdfFilename('sheet.png'), /JPEG/);
  assert.throws(() => buildPrintSheetPdfFilename(''), /không hợp lệ/);
});

test('PDF delivery từ chối paper hoặc orientation không hợp lệ', async () => {
  await assert.rejects(
    createPrintSheetPdfBlob({}, {
      createSheetBlob: async () => sheetFixture({ paperKey: 'letter' }),
    }),
    /Khổ giấy không hợp lệ/,
  );
  await assert.rejects(
    createPrintSheetPdfBlob({}, {
      createSheetBlob: async () => sheetFixture({ orientation: 'auto' }),
    }),
    /Hướng giấy không hợp lệ/,
  );
});
