import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrintSheetBatchPdfFilename,
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
const PARTIAL_JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x05, 0x00, 0x01, 0x02,
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
  assert.equal(result.pageCount, 1);
  assert.equal(result.totalCopies, 4);
  assert.equal(result.pageWidthMm, 100);
  assert.equal(result.pageHeightMm, 150);
  assert.equal(result.embeddedJpegSizeBytes, JPEG_BYTES.length);
  assert.equal(text.startsWith('%PDF-1.4'), true);
  assert.match(text, /\/MediaBox \[0 0 283\.4646 425\.1969\]/);
  assert.match(text, /\/Width 1181 \/Height 1772/);
});

test('PDF batch 10 ảnh tạo ba trang nhưng chỉ nhúng hai JPEG duy nhất', async () => {
  const requestedCopies = [];
  const result = await createPrintSheetPdfBlob({ totalCopies: 10 }, {
    createSheetBlob: async (options) => {
      const copies = options.copies === 2 ? 2 : 4;
      requestedCopies.push(copies);
      return sheetFixture({
        copies,
        rowsUsed: copies === 2 ? 1 : 2,
        blob: new Blob([copies === 2 ? PARTIAL_JPEG_BYTES : JPEG_BYTES], { type: 'image/jpeg' }),
        filename: `photovisa_sheet_photo-10x15_passport-vn_${copies}copies_1181x1772_300dpi.jpeg`,
      });
    },
  });
  const text = asAscii(new Uint8Array(await result.blob.arrayBuffer()));

  assert.deepEqual(requestedCopies, [4, 2]);
  assert.equal(result.filename, 'photovisa_sheet_photo-10x15_passport-vn_10copies_3pages_1181x1772_300dpi.pdf');
  assert.equal(result.mode, 'print-sheet-pdf-batch');
  assert.equal(result.totalCopies, 10);
  assert.equal(result.copiesPerPage, 4);
  assert.equal(result.pageCount, 3);
  assert.deepEqual(result.pageCopies, [4, 4, 2]);
  assert.equal(result.lastPageCopies, 2);
  assert.equal(result.uniqueSheetCount, 2);
  assert.equal(result.reusedPageCount, 1);
  assert.equal(result.embeddedJpegSizeBytes, JPEG_BYTES.length + PARTIAL_JPEG_BYTES.length);
  assert.match(text, /\/Count 3/);
  assert.equal((text.match(/\/Subtype \/Image/g) ?? []).length, 2);
  assert.equal((text.match(/\/MediaBox \[0 0 283\.4646 425\.1969\]/g) ?? []).length, 3);
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

test('downloadPrintSheetPdf ghi receipt tổng ảnh và số trang riêng tư', async () => {
  clearExportReceipt();
  const harness = createDownloadHarness();
  const result = await downloadPrintSheetPdf({ totalCopies: 10 }, {
    ...harness,
    createSheetBlob: async (options) => {
      const copies = options.copies === 2 ? 2 : 4;
      return sheetFixture({
        copies,
        rowsUsed: copies === 2 ? 1 : 2,
        blob: new Blob([copies === 2 ? PARTIAL_JPEG_BYTES : JPEG_BYTES], { type: 'image/jpeg' }),
        filename: `photovisa_sheet_photo-10x15_passport-vn_${copies}copies_1181x1772_300dpi.jpeg`,
      });
    },
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
  assert.equal(receipt.copies, 10);
  assert.equal(receipt.pageCount, 3);
  assert.equal(receipt.privacy.containsImageData, false);
  assert.equal(receipt.privacy.containsFaceGeometry, false);
  assert.equal(receipt.privacy.containsOriginalFilename, false);
  assert.equal(model.badge, 'PDF in');
  assert.equal(model.meta.includes('10 ảnh'), true);
  assert.equal(model.meta.includes('3 trang'), true);
  assert.match(model.note, /4 \+ 4 \+ 2/);
  assert.match(model.note, /Actual size \/ 100%/);
});

test('PDF filename giữ tương thích một trang và mô tả batch nhiều trang', () => {
  assert.equal(buildPrintSheetPdfFilename('sheet.JPEG'), 'sheet.pdf');
  assert.equal(
    buildPrintSheetBatchPdfFilename(sheetFixture(), { totalCopies: 10, pageCount: 3 }),
    'photovisa_sheet_photo-10x15_passport-vn_10copies_3pages_1181x1772_300dpi.pdf',
  );
  assert.throws(() => buildPrintSheetPdfFilename('sheet.png'), /JPEG/);
  assert.throws(() => buildPrintSheetPdfFilename(''), /không hợp lệ/);
});

test('PDF delivery từ chối paper, orientation hoặc sheet không đồng nhất', async () => {
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
  await assert.rejects(
    createPrintSheetPdfBlob({ totalCopies: 6 }, {
      createSheetBlob: async (options) => sheetFixture({
        copies: options.copies === 2 ? 2 : 4,
        width: options.copies === 2 ? 999 : 1181,
      }),
    }),
    /không đồng nhất/,
  );
});
