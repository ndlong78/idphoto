import { downloadBlobFile } from './download.js';
import { clearStagedExportForBundle } from './export-delivery-session.js';
import { clearExportRecovery } from './export-recovery.js';
import { recordExportReceipt } from './export-receipt.js';
import { createMultiPageJpegPdf } from './pdf-jpeg.js';
import { PRINT_SHEET_PAPERS } from './print-sheet-layout.js';
import {
  formatPrintSheetPageDistribution,
  paginatePrintSheetCopies,
} from './print-sheet-pagination.js';
import { createPrintSheetBlob } from './print-sheet.js';
import { state } from './state.js';

function createPdfFilename(jpegFilename) {
  const filename = String(jpegFilename ?? '').trim();
  if (!filename) throw new TypeError('Tên file tờ in không hợp lệ.');
  if (!/\.jpe?g$/i.test(filename)) {
    throw new TypeError('Tên file tờ in phải có phần mở rộng JPEG.');
  }
  return filename.replace(/\.jpe?g$/i, '.pdf');
}

function createBatchPdfFilename(sheet, batch) {
  const source = String(sheet?.filename ?? '').trim();
  const suffixPattern = /_\d+copies_\d+x\d+_\d+dpi\.jpe?g$/i;
  const base = suffixPattern.test(source)
    ? source.replace(suffixPattern, '')
    : source.replace(/\.jpe?g$/i, '');
  if (!base) throw new TypeError('Tên file PDF nhiều trang không hợp lệ.');
  return `${base}_${batch.totalCopies}copies_${batch.pageCount}pages_${sheet.width}x${sheet.height}_${sheet.targetDpi}dpi.pdf`;
}

function createPdfBlob(bytes, BlobRef = globalThis.Blob) {
  if (typeof BlobRef !== 'function') {
    throw new Error('Trình duyệt không hỗ trợ tạo PDF Blob.');
  }
  return new BlobRef([bytes], { type: 'application/pdf' });
}

function resolvePageSize(sheet) {
  const paper = PRINT_SHEET_PAPERS[sheet?.paperKey];
  if (!paper) throw new RangeError(`Khổ giấy không hợp lệ: ${sheet?.paperKey}`);
  if (sheet.orientation === 'landscape') {
    return { pageWidthMm: paper.heightMm, pageHeightMm: paper.widthMm };
  }
  if (sheet.orientation !== 'portrait') {
    throw new RangeError(`Hướng giấy không hợp lệ: ${sheet.orientation}`);
  }
  return { pageWidthMm: paper.widthMm, pageHeightMm: paper.heightMm };
}

function validateSheet(sheet, expected, copies) {
  if (typeof sheet?.blob?.arrayBuffer !== 'function') {
    throw new TypeError('JPEG tờ in không hợp lệ.');
  }
  if (sheet.copies !== copies) {
    throw new Error(`Tờ in ${copies} ảnh trả về số bản không khớp.`);
  }
  const stableFields = ['paperKey', 'orientation', 'width', 'height', 'targetDpi'];
  for (const field of stableFields) {
    if (sheet[field] !== expected[field]) {
      throw new Error(`Tờ in nhiều trang không đồng nhất tại ${field}.`);
    }
  }
  return sheet;
}

function imageIdForCopies(copies) {
  return `sheet-${copies}-copies`;
}

export async function createPrintSheetPdfBlob(options = {}, {
  createSheetBlob = createPrintSheetBlob,
  BlobRef = globalThis.Blob,
  ...sheetHarness
} = {}) {
  if (typeof BlobRef !== 'function') {
    throw new TypeError('Trình duyệt không hỗ trợ PDF Blob.');
  }
  const { totalCopies: requestedTotalCopies = null, ...sheetOptions } = options;
  const initialSheet = await createSheetBlob(sheetOptions, sheetHarness);
  if (typeof initialSheet?.blob?.arrayBuffer !== 'function') {
    throw new TypeError('JPEG tờ in không hợp lệ.');
  }
  const batch = paginatePrintSheetCopies({
    totalCopies: requestedTotalCopies ?? initialSheet.copies,
    copiesPerPage: initialSheet.copies,
  });
  const sheetsByCopies = new Map([[initialSheet.copies, initialSheet]]);

  for (const copies of batch.uniquePageCopies) {
    if (sheetsByCopies.has(copies)) continue;
    const sheet = await createSheetBlob({
      ...sheetOptions,
      copies,
      orientation: initialSheet.orientation,
    }, sheetHarness);
    sheetsByCopies.set(copies, validateSheet(sheet, initialSheet, copies));
  }

  const primarySheet = sheetsByCopies.get(batch.pageCopies[0]);
  if (!primarySheet) throw new Error('Không tạo được trang PDF đầu tiên.');
  const { pageWidthMm, pageHeightMm } = resolvePageSize(primarySheet);
  const images = [];
  let embeddedJpegSizeBytes = 0;
  for (const copies of batch.uniquePageCopies) {
    const sheet = validateSheet(sheetsByCopies.get(copies), primarySheet, copies);
    const jpegBytes = new Uint8Array(await sheet.blob.arrayBuffer());
    embeddedJpegSizeBytes += jpegBytes.length;
    images.push({
      id: imageIdForCopies(copies),
      jpegBytes,
      imageWidthPx: sheet.width,
      imageHeightPx: sheet.height,
    });
  }

  const pdf = createMultiPageJpegPdf({
    images,
    pages: batch.pageCopies.map((copies) => ({ imageId: imageIdForCopies(copies) })),
    pageWidthMm,
    pageHeightMm,
  });
  const blob = createPdfBlob(pdf.bytes, BlobRef);
  const filename = batch.pageCount === 1
    ? createPdfFilename(primarySheet.filename)
    : createBatchPdfFilename(primarySheet, batch);

  return Object.freeze({
    ...primarySheet,
    blob,
    filename,
    mode: batch.pageCount === 1 ? 'print-sheet-pdf' : 'print-sheet-pdf-batch',
    mimeType: 'application/pdf',
    copies: batch.totalCopies,
    totalCopies: batch.totalCopies,
    copiesPerPage: batch.copiesPerPage,
    pageCount: batch.pageCount,
    pageCopies: batch.pageCopies,
    lastPageCopies: batch.lastPageCopies,
    hasPartialLastPage: batch.hasPartialLastPage,
    uniqueSheetCount: pdf.uniqueImageCount,
    reusedPageCount: pdf.pageCount - pdf.uniqueImageCount,
    pageWidthMm,
    pageHeightMm,
    pageWidthPt: pdf.pageWidthPt,
    pageHeightPt: pdf.pageHeightPt,
    embeddedJpegSizeBytes,
  });
}

export async function downloadPrintSheetPdf(options = {}, harness = {}) {
  clearExportRecovery();
  clearStagedExportForBundle();
  const result = await createPrintSheetPdfBlob(options, harness);
  downloadBlobFile(result.blob, result.filename, harness);
  const distribution = formatPrintSheetPageDistribution(result.pageCopies);
  recordExportReceipt({
    delivery: 'print-sheet-pdf',
    filename: result.filename,
    sizeBytes: result.blob.size,
    mimeType: result.mimeType,
    mode: result.mode,
    formatKey: state.curFmt,
    widthPx: result.width,
    heightPx: result.height,
    dpi: result.targetDpi,
    copies: result.totalCopies,
    pageCount: result.pageCount,
    note: `${result.paperLabel} · ${result.totalCopies} ảnh · ${result.pageCount} trang (${distribution}) · ${result.orientation === 'landscape' ? 'ngang' : 'dọc'} · lề ${result.marginMm} mm · PDF đúng khổ. Khi in chọn Actual size / 100%.`,
  });
  return Object.freeze({
    ...result,
    blobSize: result.blob.size,
  });
}

export {
  createBatchPdfFilename as buildPrintSheetBatchPdfFilename,
  createPdfFilename as buildPrintSheetPdfFilename,
};
