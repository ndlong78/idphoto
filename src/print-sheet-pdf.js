import { downloadBlobFile } from './download.js';
import { clearStagedExportForBundle } from './export-delivery-session.js';
import { clearExportRecovery } from './export-recovery.js';
import { recordExportReceipt } from './export-receipt.js';
import { createSinglePageJpegPdf } from './pdf-jpeg.js';
import { createPrintSheetBlob } from './print-sheet.js';
import { state } from './state.js';

function createPdfFilename(jpegFilename) {
  const filename = String(jpegFilename ?? '').trim();
  if (!filename) throw new TypeError('Tên file tờ in không hợp lệ.');
  return filename.replace(/\.jpe?g$/i, '.pdf');
}

function createPdfBlob(bytes, BlobRef = globalThis.Blob) {
  if (typeof BlobRef !== 'function') {
    throw new Error('Trình duyệt không hỗ trợ tạo PDF Blob.');
  }
  return new BlobRef([bytes], { type: 'application/pdf' });
}

export async function createPrintSheetPdfBlob(options = {}, {
  createSheetBlob = createPrintSheetBlob,
  BlobRef = globalThis.Blob,
  ...sheetHarness
} = {}) {
  const sheet = await createSheetBlob(options, sheetHarness);
  if (!(sheet?.blob instanceof BlobRef) && typeof sheet?.blob?.arrayBuffer !== 'function') {
    throw new TypeError('JPEG tờ in không hợp lệ.');
  }
  const jpegBytes = new Uint8Array(await sheet.blob.arrayBuffer());
  const pdf = createSinglePageJpegPdf({
    jpegBytes,
    imageWidthPx: sheet.width,
    imageHeightPx: sheet.height,
    pageWidthMm: sheet.paperWidthMm,
    pageHeightMm: sheet.paperHeightMm,
  });
  const blob = createPdfBlob(pdf.bytes, BlobRef);

  return Object.freeze({
    ...sheet,
    blob,
    filename: createPdfFilename(sheet.filename),
    mode: 'print-sheet-pdf',
    mimeType: 'application/pdf',
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
