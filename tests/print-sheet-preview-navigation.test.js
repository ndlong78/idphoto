import test from 'node:test';
import assert from 'node:assert/strict';

import { computePrintSheetLayout } from '../src/print-sheet-layout.js';
import { createPrintSheetPreviewPage } from '../src/print-sheet-preview-navigation.js';
import { paginatePrintSheetCopies } from '../src/print-sheet-pagination.js';

function schengenLayout() {
  return computePrintSheetLayout({
    paperKey: 'photo-10x15',
    photoWidthMm: 35,
    photoHeightMm: 45,
    copies: 6,
    gapMm: 3,
  });
}

test('preview một trang giữ nguyên layout hiện có', () => {
  const layout = schengenLayout();
  const page = createPrintSheetPreviewPage({ layout });

  assert.equal(page.pageNumber, 1);
  assert.equal(page.pageCount, 1);
  assert.equal(page.copies, 6);
  assert.equal(page.layout, layout);
  assert.equal(page.isFirstPage, true);
  assert.equal(page.isLastPage, true);
  assert.equal(page.label, 'Trang 1/1 · 6 ảnh');
});

test('batch 6 + 6 + 2 trả đúng layout trang cuối và căn giữa hàng', () => {
  const layout = schengenLayout();
  const pdfBatch = paginatePrintSheetCopies({ totalCopies: 14, copiesPerPage: 6 });
  const page = createPrintSheetPreviewPage({
    layout,
    pdfBatch,
    pageNumber: 3,
  });

  assert.equal(page.pageNumber, 3);
  assert.equal(page.pageCount, 3);
  assert.equal(page.copies, 2);
  assert.equal(page.layout.orientation, layout.orientation);
  assert.equal(page.layout.paperWidthMm, layout.paperWidthMm);
  assert.equal(page.layout.paperHeightMm, layout.paperHeightMm);
  assert.equal(page.layout.positions.length, 2);
  assert.equal(page.layout.rowsUsed, 1);
  assert.equal(page.layout.positions[0].row, 0);
  assert.equal(page.layout.positions[1].row, 0);
  assert.equal(page.layout.positions[0].xMm, layout.positions[0].xMm);
  assert.ok(page.layout.positions[0].yMm > layout.positions[0].yMm);
  assert.equal(page.isFirstPage, false);
  assert.equal(page.isLastPage, true);
  assert.equal(page.previousPage, 2);
  assert.equal(page.nextPage, 3);
});

test('page number được clamp khi tổng số trang giảm', () => {
  const layout = schengenLayout();
  const pdfBatch = paginatePrintSheetCopies({ totalCopies: 8, copiesPerPage: 6 });
  const page = createPrintSheetPreviewPage({
    layout,
    pdfBatch,
    pageNumber: 99,
  });

  assert.equal(page.pageNumber, 2);
  assert.equal(page.pageCount, 2);
  assert.equal(page.copies, 2);
  assert.equal(page.nextPage, 2);
});

test('preview từ chối layout hoặc phân bổ trang không hợp lệ', () => {
  const layout = schengenLayout();

  assert.throws(
    () => createPrintSheetPreviewPage({ layout: {} }),
    /Layout trang đầy không hợp lệ/,
  );
  assert.throws(
    () => createPrintSheetPreviewPage({
      layout,
      pdfBatch: { pageCount: 2, pageCopies: [6] },
    }),
    /Phân bổ trang PDF không hợp lệ/,
  );
  assert.throws(
    () => createPrintSheetPreviewPage({
      layout,
      pdfBatch: { pageCount: 1, pageCopies: [7] },
    }),
    /vượt bố cục trang đầy/,
  );
});
