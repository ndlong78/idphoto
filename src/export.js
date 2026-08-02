import { canvasToDpiBlob } from './image-metadata.js';
import { renderResult } from './render.js';
import { FMTS, state } from './state.js';

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
  return {
    ...preset,
    targetDpi,
    scale,
    width:  Math.round(format.w * scale),
    height: Math.round(format.h * scale),
  };
}

export async function createExportBlob(mode) {
  const format = FMTS[state.curFmt];
  const config = resolveExportConfig(mode, format);
  const canvas = await renderResult(config.scale);
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
  const { blob, filename } = await createExportBlob(mode);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = objectUrl;
  link.hidden = true;
  document.body?.appendChild(link);
  link.click();
  link.remove();

  // Giữ URL thêm một nhịp để Safari/Firefox hoàn tất việc nhận blob download.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}
