import './export-receipt-auto.js';
import { downloadBlobFile } from './download.js';
import {
  clearStagedExportForBundle,
  stageExportForBundle,
} from './export-delivery-session.js';
import { clearExportRecovery } from './export-recovery.js';
import { recordExportReceipt } from './export-receipt.js';
import { createExportCanvas } from './export-render.js';
import { canvasToDpiBlob } from './image-metadata.js';
import { manualReviewStore } from './manual-review.js';
import { state } from './state.js';

export {
  createExportCanvas,
  ensureCanvasDimensions,
  resolveExportConfig,
} from './export-render.js';

export async function createExportBlob(mode) {
  const { canvas, ...config } = await createExportCanvas(mode);
  const blob = await canvasToDpiBlob(canvas, config.mimeType, config.targetDpi, 1);
  const filename = [
    'photovisa',
    state.curFmt,
    `${config.width}x${config.height}`,
    `${config.targetDpi}dpi.${config.extension}`,
  ].join('_');

  return { blob, filename, ...config };
}

export async function downloadWithDpi(mode) {
  clearExportRecovery();
  clearStagedExportForBundle();
  const { blob, filename, ...config } = await createExportBlob(mode);
  const exportResult = {
    filename,
    ...config,
    blobSize: blob.size,
  };

  if (manualReviewStore.isAuditEnabled(state.origFile)) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    stageExportForBundle({
      ...exportResult,
      bytes,
    });
    return exportResult;
  }

  downloadBlobFile(blob, filename);
  recordExportReceipt({
    delivery: 'image',
    filename,
    sizeBytes: blob.size,
    mimeType: config.mimeType,
    mode,
    formatKey: state.curFmt,
    widthPx: config.width,
    heightPx: config.height,
    dpi: config.targetDpi,
    note: 'Ảnh đã được gửi tới trình duyệt để tải xuống.',
  });
  return exportResult;
}
