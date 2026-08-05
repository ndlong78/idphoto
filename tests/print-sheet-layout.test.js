import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrintSheetFilename,
  computePrintSheetLayout,
  PRINT_SHEET_PAPERS,
} from '../src/print-sheet-layout.js';

test('10x15 xếp tối đa sáu ảnh 35x45 theo lưới 2x3', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 35,
    photoHeightMm: 45,
  });

  assert.equal(layout.paperLabel, '10 × 15 cm');
  assert.equal(layout.orientation, 'portrait');
  assert.equal(layout.columns, 2);
  assert.equal(layout.rows, 3);
  assert.equal(layout.capacity, 6);
  assert.equal(layout.copies, 6);
  assert.equal(layout.positions.length, 6);
});

test('10x15 xếp bốn ảnh hộ chiếu Việt Nam 40x60', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 40,
    photoHeightMm: 60,
  });

  assert.equal(layout.orientation, 'portrait');
  assert.equal(layout.columns, 2);
  assert.equal(layout.rows, 2);
  assert.equal(layout.capacity, 4);
});

test('10x15 xếp hai ảnh vuông US Visa 51x51', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 51,
    photoHeightMm: 51,
  });

  assert.equal(layout.orientation, 'portrait');
  assert.equal(layout.capacity, 2);
  assert.equal(layout.copies, 2);
});

test('A4 tự xoay ngang để xếp tối đa mười tám ảnh hộ chiếu 40x60', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'a4',
    photoWidthMm: 40,
    photoHeightMm: 60,
  });

  assert.equal(layout.orientation, 'landscape');
  assert.equal(layout.paperWidthMm, 297);
  assert.equal(layout.paperHeightMm, 210);
  assert.equal(layout.columns, 6);
  assert.equal(layout.rows, 3);
  assert.equal(layout.capacity, 18);
  assert.equal(layout.marginMm, PRINT_SHEET_PAPERS.a4.defaultMarginMm);
});

test('hàng cuối ít ảnh được căn giữa độc lập', () => {
  const layout = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 35,
    photoHeightMm: 45,
    copies: 5,
  });

  assert.equal(layout.rowsUsed, 3);
  const firstRow = layout.positions.filter((position) => position.row === 0);
  const lastRow = layout.positions.filter((position) => position.row === 2);
  assert.equal(firstRow.length, 2);
  assert.equal(lastRow.length, 1);
  assert.equal(lastRow[0].xMm, (layout.paperWidthMm - layout.photoWidthMm) / 2);
});

test('tăng khoảng cách có thể giảm sức chứa nhưng vẫn giữ ảnh đúng kích thước', () => {
  const compact = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 35,
    photoHeightMm: 45,
    gapMm: 2,
  });
  const spacious = computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 35,
    photoHeightMm: 45,
    gapMm: 8,
  });

  assert.equal(compact.capacity, 6);
  assert.ok(spacious.capacity < compact.capacity);
  assert.equal(spacious.photoWidthMm, 35);
  assert.equal(spacious.photoHeightMm, 45);
});

test('từ chối số bản vượt sức chứa hoặc cấu hình không hợp lệ', () => {
  assert.throws(
    () => computePrintSheetLayout({
      paperKey: 'photo-10x15',
      photoWidthMm: 40,
      photoHeightMm: 60,
      copies: 5,
    }),
    /vượt sức chứa 4/,
  );
  assert.throws(
    () => computePrintSheetLayout({
      paperKey: 'unknown',
      photoWidthMm: 40,
      photoHeightMm: 60,
    }),
    /Khổ giấy không được hỗ trợ/,
  );
  assert.throws(
    () => computePrintSheetLayout({
      paperKey: 'photo-10x15',
      photoWidthMm: 0,
      photoHeightMm: 60,
    }),
    /Chiều rộng ảnh/,
  );
});

test('filename tờ in chứa khổ giấy, preset, số bản, pixel và DPI', () => {
  assert.equal(
    buildPrintSheetFilename({
      paperKey: 'photo-10x15',
      formatKey: 'schengen',
      copies: 6,
      widthPx: 1181,
      heightPx: 1772,
      dpi: 300,
    }),
    'photovisa_sheet_photo-10x15_schengen_6copies_1181x1772_300dpi.jpeg',
  );
});
