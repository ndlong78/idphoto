import { downloadBlobFile } from './download.js';
import { clearStagedExportForBundle } from './export-delivery-session.js';
import { clearExportRecovery } from './export-recovery.js';
import { recordExportReceipt } from './export-receipt.js';
import { createSinglePageJpegPdf } from './pdf-jpeg.js';
import { PRINT_SHEET_PAPERS } from './print-sheet-layout.js';
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

export async function createPrintSheetPdfBlob(options = {}, {
  createSheetBlob = createPrintSheetBlob,
  BlobRef = globalThis.Blob,
  ...sheetHarness
} = {}) {
  const sheet = await createSheetBlob(options, sheetHarness);
  if (typeof BlobRef !== 'function' || typeof sheet?.blob?.arrayBuffer !== 'function') {
    throw new TypeError('JPEG tờ in không hợp lệ.');
  }
  const { pageWidthMm, pageHeightMm } = resolvePageSize(sheet);
  const jpegBytes = new Uint8Array(await sheet.blob.arrayBuffer());
  const pdf = createSinglePageJpegPdf({
    jpegBytes,
    imageWidthPx: sheet.width,
    imageHeightPx: sheet.height,
    pageWidthMm,
    pageHeightMm,
  });
  const blob = createPdfBlob(pdf.bytes, BlobRef);

  return Object.freeze({
    ...sheet,
    blob,
    filename: createPdfFilename(sheet.filename),
    mode: 'print-sheet-pdf',
    mimeType: 'application/pdf',
    pageWidthMm,
    pageHeightMm,
    pageWidthPt: pdf.pageWidthPt,
    pageHeightPt: pdf.pageHeightPt,
    embeddedJpegSizeBytes: jpegBytes.length,
  });
}

export async function downloadPrintSheetPdf(options = {}, harness = {}) {
  clearExportRecovery();
  clearStagedExportForBundle();
  const result = await createPrintSheetPdfBlob(options, harness);
  downloadBlobFile(result.blob, result.filename, harness);
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
    note: `${result.paperLabel} · ${result.copies} ảnh · ${result.columns} cột × ${result.rowsUsed} hàng · PDF đúng khổ. Khi in chọn Actual size / 100%.`,
  });
  return Object.freeze({
    ...result,
    blobSize: result.blob.size,
  });
}

export { createPdfFilename as buildPrintSheetPdfFilename };
