import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatPrintSheetPageDistribution,
  normalizePrintSheetPdfTotalCopies,
  paginatePrintSheetCopies,
  PRINT_SHEET_PDF_MAX_TOTAL_COPIES,
} from '../src/print-sheet-pagination.js';

test('14 ảnh với sáu ảnh mỗi trang tạo phân bổ 6 + 6 + 2', () => {
  const result = paginatePrintSheetCopies({ totalCopies: 14, copiesPerPage: 6 });
  assert.equal(result.pageCount, 3);
  assert.equal(result.fullPageCount, 2);
  assert.equal(result.lastPageCopies, 2);
  assert.equal(result.hasPartialLastPage, true);
  assert.deepEqual(result.pageCopies, [6, 6, 2]);
  assert.deepEqual(result.uniquePageCopies, [6, 2]);
  assert.equal(Object.isFrozen(result.pageCopies), true);
});

test('bội số chính xác chỉ cần một loại trang', () => {
  const result = paginatePrintSheetCopies({ totalCopies: 18, copiesPerPage: 6 });
  assert.equal(result.pageCount, 3);
  assert.equal(result.fullPageCount, 3);
  assert.equal(result.lastPageCopies, 6);
  assert.equal(result.hasPartialLastPage, false);
  assert.deepEqual(result.pageCopies, [6, 6, 6]);
  assert.deepEqual(result.uniquePageCopies, [6]);
});

test('tổng số ảnh được làm tròn và chặn trong giới hạn an toàn', () => {
  assert.equal(normalizePrintSheetPdfTotalCopies('8.6'), 9);
  assert.equal(normalizePrintSheetPdfTotalCopies('không hợp lệ', { fallback: 6 }), 6);
  assert.equal(normalizePrintSheetPdfTotalCopies(999), PRINT_SHEET_PDF_MAX_TOTAL_COPIES);
  assert.equal(normalizePrintSheetPdfTotalCopies(-2), 1);
});

test('format phân bổ ngắn và rút gọn chuỗi nhiều trang', () => {
  assert.equal(formatPrintSheetPageDistribution([6, 6, 2]), '6 + 6 + 2');
  assert.equal(formatPrintSheetPageDistribution([6, 6, 6, 6, 6, 6, 6]), '6 × 7 trang');
  assert.equal(formatPrintSheetPageDistribution([6, 6, 6, 6, 6, 6, 2]), '6 × 6 trang + 2');
});

test('pagination từ chối số ảnh mỗi trang hoặc phân bổ không hợp lệ', () => {
  assert.throws(() => paginatePrintSheetCopies({ totalCopies: 10, copiesPerPage: 0 }), /số nguyên dương/i);
  assert.throws(() => formatPrintSheetPageDistribution([]), /mảng không rỗng/i);
  assert.throws(() => formatPrintSheetPageDistribution([2, 0]), /số nguyên dương/i);
});
