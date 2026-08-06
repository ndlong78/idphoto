import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExportReceipt,
  EXPORT_RECEIPT_DELIVERY_TYPES,
} from '../src/export-receipt.js';
import { buildExportReceiptViewModel } from '../src/export-receipt-view.js';

test('receipt tờ in giữ metadata đầu ra và cờ quyền riêng tư', () => {
  const receipt = buildExportReceipt({
    delivery: 'print-sheet',
    filename: 'photovisa_sheet_photo-10x15_schengen_6copies_1181x1772_300dpi.jpeg',
    sizeBytes: 654321,
    mimeType: 'image/jpeg',
    generatedAt: '2026-08-05T14:30:00.000Z',
    mode: 'print-sheet-300',
    formatKey: 'schengen',
    widthPx: 1181,
    heightPx: 1772,
    dpi: 300,
    note: '10 × 15 cm · 6 ảnh · 2 cột × 3 hàng · có dấu cắt.',
  });

  assert.equal(receipt.delivery, 'print-sheet');
  assert.equal(receipt.widthPx, 1181);
  assert.equal(receipt.heightPx, 1772);
  assert.equal(receipt.dpi, 300);
  assert.equal(receipt.privacy.containsImageData, false);
  assert.equal(receipt.privacy.containsFaceGeometry, false);
  assert.equal(receipt.privacy.containsOriginalFilename, false);
  assert.ok(EXPORT_RECEIPT_DELIVERY_TYPES.includes('print-sheet'));
});

test('view model hiển thị badge Tờ in và thông tin DPI/kích thước', () => {
  const model = buildExportReceiptViewModel(buildExportReceipt({
    delivery: 'print-sheet',
    filename: 'sheet.jpeg',
    sizeBytes: 2048,
    generatedAt: '2026-08-05T14:30:00.000Z',
    widthPx: 2480,
    heightPx: 3508,
    dpi: 300,
    note: 'A4 · 8 ảnh.',
  }), { locale: 'vi-VN', timeZone: 'UTC' });

  assert.equal(model.badge, 'Tờ in');
  assert.ok(model.meta.includes('300 DPI'));
  assert.ok(model.meta.includes('2480 × 3508 px'));
  assert.equal(model.note, 'A4 · 8 ảnh.');
});
