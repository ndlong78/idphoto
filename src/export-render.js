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
    width: hasPhysicalSize ? mmToPixels(format.mmW, targetDpi) : Math.round(format.w * scale),
    height: hasPhysicalSize ? mmToPixels(format.mmH, targetDpi) : Math.round(format.h * scale),
  };
}

export function ensureCanvasDimensions(sourceCanvas, width, height, {
  documentRef = globalThis.document,
} = {}) {
  if (!sourceCanvas || !Number.isFinite(sourceCanvas.width) || !Number.isFinite(sourceCanvas.height)) {
    throw new TypeError('A valid source canvas is required.');
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('Export dimensions must be positive integers.');
  }
  if (sourceCanvas.width === width && sourceCanvas.height === height) return sourceCanvas;
  if (!documentRef?.createElement) throw new Error('Unable to create an export canvas.');

  const exactCanvas = documentRef.createElement('canvas');
  exactCanvas.width = width;
  exactCanvas.height = height;
  const ctx = exactCanvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create an export canvas context.');
  ctx.drawImage(sourceCanvas, 0, 0, width, height);
  return exactCanvas;
}

export async function createExportCanvas(mode, {
  documentRef = globalThis.document,
  render = renderResult,
} = {}) {
  const format = FMTS[state.curFmt];
  const config = resolveExportConfig(mode, format);
  const renderedCanvas = await render(config.scale);
  const canvas = ensureCanvasDimensions(renderedCanvas, config.width, config.height, { documentRef });
  return { canvas, ...config };
}

export const SUPPORTED_EXPORT_MODES = Object.freeze(Object.keys(EXPORT_MODES));
