import {
  clearStagedExportForBundle,
  stageExportForBundle,
} from './export-delivery-session.js';
import { canvasToDpiBlob } from './image-metadata.js';
import { manualReviewStore } from './manual-review.js';
import { renderResult } from './render.js';
import { FMTS, mmToPixels, state } from './state.js';

const EXPORT_MODES = Object.freeze({
  jpeg300: { mimeType: 'image/jpeg', extension: 'jpeg', dpiMultiplier: 1 },
  jpeg600: { mimeType: 'image/jpeg', extension: 'jpeg', dpiMultiplier: 2 },
  png600:  { mimeType: 'image/png',  extension: 'png',  dpiMultiplier: 2 },
});

export function resolveExportConfig(mode, format = FMTS[state.curFmt]) {
  const preset = EXPORT_MODES[mode];
  if (!preset) throw new RangeError(`Unsupported export mode: ${mode}`);
  if (!format || !Number.isFinite(format.w) || !Number.isFinite(format.h) || !Number.isFinite(format.dpi)) {
    throw new TypeError('Invalid photo format configuration.');
  }

  const targetDpi = Math.round(format.dpi * preset.dpiMultiplier);
  const scale = targetDpi / format.dpi;
  const hasPhysicalSize = Number.isFinite(format.mmW) && Number.isFinite(format.mmH);
  return {
    ...preset,
    targetDpi,
    scale,
    // Tính trực tiếp từ mm ở DPI đích để không nhân đôi sai số làm tròn 300 DPI.
    width:  hasPhysicalSize ? mmToPixels(format.mmW, targetDpi) : Math.round(format.w * scale),
    height: hasPhysicalSize ? mmToPixels(format.mmH, targetDpi) : Math.round(format.h * scale),
  };
}

/**
 * Chuẩn hóa canvas về đúng kích thước pixel cuối cùng.
 * renderResult() dùng scale đồng nhất; do làm tròn độc lập theo mm, mỗi chiều có
 * thể lệch 1 pixel ở 600 DPI. Chỉ resample khi thật sự cần thiết.
 */
export function ensureCanvasDimensions(sourceCanvas, width, height) {
  if (!sourceCanvas || !Number.isFinite(sourceCanvas.width) || !Number.isFinite(sourceCanvas.height)) {
    throw new TypeError('A valid source canvas is required.');
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('Export dimensions must be positive integers.');
  }
  if (sourceCanvas.width === width && sourceCanvas.height === height) return sourceCanvas;

  const exactCanvas = document.createElement('canvas');
  exactCanvas.width = width;
  exactCanvas.height = height;
  const ctx = exactCanvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create an export canvas context.');
  ctx.drawImage(sourceCanvas, 0, 0, width, height);
  return exactCanvas;
}

export async function createExportBlob(mode) {
  const format = FMTS[state.curFmt];
  const config = resolveExportConfig(mode, format);
  const renderedCanvas = await renderResult(config.scale);
  const canvas = ensureCanvasDimensions(renderedCanvas, config.width, config.height);
  const blob = await canvasToDpiBlob(canvas, config.mimeType, config.targetDpi, 1);
  const filename = [
    'photovisa',
    state.curFmt,
    `${config.width}x${config.height}`,
    `${config.targetDpi}dpi.${config.extension}`,
  ].join('_');

  return { blob, filename, ...config };
}

export function downloadBlobFile(
  blob,
  filename,
  {
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    windowRef = globalThis.window,
  } = {},
) {
  if (!(blob instanceof Blob)) throw new TypeError('Download blob không hợp lệ.');
  if (typeof filename !== 'string' || !filename) throw new TypeError('Download filename là bắt buộc.');
  if (!documentRef || !urlApi?.createObjectURL) {
    throw new Error('Trình duyệt không hỗ trợ tải file.');
  }

  const objectUrl = urlApi.createObjectURL(blob);
  const link = documentRef.createElement('a');
  link.download = filename;
  link.href = objectUrl;
  link.hidden = true;
  documentRef.body?.appendChild(link);
  link.click();
  link.remove();
  windowRef?.setTimeout?.(() => urlApi.revokeObjectURL(objectUrl), 30_000);
  return { filename, sizeBytes: blob.size };
}

export async function downloadWithDpi(mode) {
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

  clearStagedExportForBundle();
  downloadBlobFile(blob, filename);
  return exportResult;
}
