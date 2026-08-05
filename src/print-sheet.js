import { downloadBlobFile } from './download.js';
import { clearStagedExportForBundle } from './export-delivery-session.js';
import { createExportCanvas } from './export-render.js';
import { clearExportRecovery } from './export-recovery.js';
import { recordExportReceipt } from './export-receipt.js';
import { canvasToDpiBlob } from './image-metadata.js';
import {
  buildPrintSheetFilename,
  computePrintSheetLayout,
} from './print-sheet-layout.js';
import { FMTS, mmToPixels, state } from './state.js';

const MILLIMETERS_PER_INCH = 25.4;
const PRINT_SHEET_DPI = 300;

function millimetersToPixels(millimeters, dpi) {
  return Math.round((millimeters / MILLIMETERS_PER_INCH) * dpi);
}

function validatePhotoCanvas(photoCanvas) {
  if (!photoCanvas || !Number.isInteger(photoCanvas.width) || photoCanvas.width <= 0) {
    throw new TypeError('Canvas ảnh nguồn không hợp lệ.');
  }
  if (!Number.isInteger(photoCanvas.height) || photoCanvas.height <= 0) {
    throw new TypeError('Canvas ảnh nguồn không hợp lệ.');
  }
  return photoCanvas;
}

function drawCornerCropMarks(ctx, x, y, width, height, dpi, gapMm) {
  if (gapMm < 1.5) return;
  const offset = Math.max(1, millimetersToPixels(Math.min(0.8, gapMm / 4), dpi));
  const length = Math.max(2, millimetersToPixels(Math.min(2, gapMm / 2), dpi));
  const left = x - offset;
  const right = x + width + offset;
  const top = y - offset;
  const bottom = y + height + offset;

  ctx.beginPath();
  ctx.moveTo(left - length, top);
  ctx.lineTo(left, top);
  ctx.lineTo(left, top - length);
  ctx.moveTo(right + length, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, top - length);
  ctx.moveTo(left - length, bottom);
  ctx.lineTo(left, bottom);
  ctx.lineTo(left, bottom + length);
  ctx.moveTo(right + length, bottom);
  ctx.lineTo(right, bottom);
  ctx.lineTo(right, bottom + length);
  ctx.stroke();
}

export function composePrintSheetCanvas(photoCanvas, layout, {
  documentRef = globalThis.document,
  drawCropMarks = true,
} = {}) {
  validatePhotoCanvas(photoCanvas);
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.positions)) {
    throw new TypeError('Print sheet layout không hợp lệ.');
  }
  if (!documentRef?.createElement) {
    throw new Error('Trình duyệt không hỗ trợ tạo canvas tờ in.');
  }

  const sheetCanvas = documentRef.createElement('canvas');
  sheetCanvas.width = mmToPixels(layout.paperWidthMm, layout.dpi);
  sheetCanvas.height = mmToPixels(layout.paperHeightMm, layout.dpi);
  const ctx = sheetCanvas.getContext('2d');
  if (!ctx) throw new Error('Không tạo được canvas context cho tờ in.');

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (const position of layout.positions) {
    const x = millimetersToPixels(position.xMm, layout.dpi);
    const y = millimetersToPixels(position.yMm, layout.dpi);
    ctx.drawImage(photoCanvas, x, y, photoCanvas.width, photoCanvas.height);
  }

  if (drawCropMarks) {
    ctx.strokeStyle = 'rgba(80, 90, 110, 0.55)';
    ctx.lineWidth = Math.max(1, millimetersToPixels(0.15, layout.dpi));
    ctx.lineCap = 'square';
    for (const position of layout.positions) {
      const x = millimetersToPixels(position.xMm, layout.dpi);
      const y = millimetersToPixels(position.yMm, layout.dpi);
      drawCornerCropMarks(
        ctx,
        x,
        y,
        photoCanvas.width,
        photoCanvas.height,
        layout.dpi,
        layout.gapMm,
      );
    }
  }
  ctx.restore();
  return sheetCanvas;
}

export async function createPrintSheetBlob({
  paperKey = 'photo-10x15',
  copies = 'max',
  gapMm = null,
  marginMm = null,
  orientation = 'auto',
  drawCropMarks = true,
} = {}, {
  documentRef = globalThis.document,
  createPhotoCanvas = () => createExportCanvas('jpeg300'),
} = {}) {
  const format = FMTS[state.curFmt];
  if (!format) throw new RangeError(`Preset ảnh không hợp lệ: ${state.curFmt}`);
  const layout = computePrintSheetLayout({
    paperKey,
    photoWidthMm: format.mmW,
    photoHeightMm: format.mmH,
    copies,
    gapMm,
    marginMm,
    orientation,
    dpi: PRINT_SHEET_DPI,
  });
  const { canvas: photoCanvas, width, height, targetDpi } = await createPhotoCanvas();
  validatePhotoCanvas(photoCanvas);
  if (targetDpi !== PRINT_SHEET_DPI) {
    throw new RangeError(`Ảnh nguồn tờ in phải là ${PRINT_SHEET_DPI} DPI.`);
  }
  if (photoCanvas.width !== width || photoCanvas.height !== height) {
    throw new Error('Canvas ảnh nguồn không khớp kích thước export 300 DPI.');
  }

  const canvas = composePrintSheetCanvas(photoCanvas, layout, {
    documentRef,
    drawCropMarks,
  });
  const blob = await canvasToDpiBlob(canvas, 'image/jpeg', PRINT_SHEET_DPI, 0.94);
  const filename = buildPrintSheetFilename({
    paperKey,
    formatKey: state.curFmt,
    copies: layout.copies,
    widthPx: canvas.width,
    heightPx: canvas.height,
    dpi: PRINT_SHEET_DPI,
  });

  return {
    blob,
    filename,
    mode: 'print-sheet-300',
    mimeType: 'image/jpeg',
    width: canvas.width,
    height: canvas.height,
    targetDpi: PRINT_SHEET_DPI,
    paperKey,
    paperLabel: layout.paperLabel,
    orientation: layout.orientation,
    copies: layout.copies,
    columns: layout.columns,
    rowsUsed: layout.rowsUsed,
    capacity: layout.capacity,
    gapMm: layout.gapMm,
    marginMm: layout.marginMm,
    drawCropMarks: Boolean(drawCropMarks),
    photoWidth: photoCanvas.width,
    photoHeight: photoCanvas.height,
  };
}

export async function downloadPrintSheet(options = {}, harness = {}) {
  clearExportRecovery();
  clearStagedExportForBundle();
  const result = await createPrintSheetBlob(options, harness);
  downloadBlobFile(result.blob, result.filename, harness);
  recordExportReceipt({
    delivery: 'print-sheet',
    filename: result.filename,
    sizeBytes: result.blob.size,
    mimeType: result.mimeType,
    mode: result.mode,
    formatKey: state.curFmt,
    widthPx: result.width,
    heightPx: result.height,
    dpi: result.targetDpi,
    note: `${result.paperLabel} · ${result.copies} ảnh · ${result.columns} cột × ${result.rowsUsed} hàng${result.drawCropMarks ? ' · có dấu cắt' : ''}.`,
  });
  return {
    ...result,
    blobSize: result.blob.size,
  };
}

export const PRINT_SHEET_EXPORT_DPI = PRINT_SHEET_DPI;
