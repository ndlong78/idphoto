import { computePrintSheetLayout } from './print-sheet-layout.js';

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${label} phải là số nguyên dương.`);
  }
  return parsed;
}

function normalizePageNumber(value, pageCount) {
  const parsed = Number(value);
  const candidate = Number.isFinite(parsed) ? Math.trunc(parsed) : 1;
  return Math.min(Math.max(candidate, 1), pageCount);
}

function validateBaseLayout(layout) {
  if (
    !layout
    || typeof layout !== 'object'
    || !layout.paperKey
    || !layout.orientation
    || !Number.isInteger(layout.copies)
    || layout.copies <= 0
  ) {
    throw new TypeError('Layout trang đầy không hợp lệ.');
  }
  return layout;
}

function resolvePageCopies(pdfBatch, layoutCopies) {
  if (!pdfBatch) return Object.freeze([layoutCopies]);
  const pageCount = positiveInteger(pdfBatch.pageCount, 'Số trang PDF');
  if (!Array.isArray(pdfBatch.pageCopies) || pdfBatch.pageCopies.length !== pageCount) {
    throw new TypeError('Phân bổ trang PDF không hợp lệ.');
  }
  return Object.freeze(pdfBatch.pageCopies.map((copies) => {
    const normalized = positiveInteger(copies, 'Số ảnh trên trang');
    if (normalized > layoutCopies) {
      throw new RangeError('Số ảnh trên trang vượt bố cục trang đầy.');
    }
    return normalized;
  }));
}

function buildPageLayout(baseLayout, copies) {
  if (copies === baseLayout.copies) return baseLayout;
  return computePrintSheetLayout({
    paperKey: baseLayout.paperKey,
    photoWidthMm: baseLayout.photoWidthMm,
    photoHeightMm: baseLayout.photoHeightMm,
    copies,
    marginMm: baseLayout.marginMm,
    gapMm: baseLayout.gapMm,
    orientation: baseLayout.orientation,
    dpi: baseLayout.dpi,
  });
}

export function createPrintSheetPreviewPage({
  layout,
  pdfBatch = null,
  pageNumber = 1,
} = {}) {
  const baseLayout = validateBaseLayout(layout);
  const pageCopies = resolvePageCopies(pdfBatch, baseLayout.copies);
  const pageCount = pageCopies.length;
  const normalizedPageNumber = normalizePageNumber(pageNumber, pageCount);
  const copies = pageCopies[normalizedPageNumber - 1];
  const pageLayout = buildPageLayout(baseLayout, copies);

  return Object.freeze({
    schemaVersion: 1,
    pageNumber: normalizedPageNumber,
    pageCount,
    copies,
    pageCopies,
    isFirstPage: normalizedPageNumber === 1,
    isLastPage: normalizedPageNumber === pageCount,
    previousPage: Math.max(1, normalizedPageNumber - 1),
    nextPage: Math.min(pageCount, normalizedPageNumber + 1),
    label: `Trang ${normalizedPageNumber}/${pageCount} · ${copies} ảnh`,
    layout: pageLayout,
  });
}
