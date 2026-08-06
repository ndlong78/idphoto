const DEFAULT_MAX_WIDTH_CSS = 320;
const DEFAULT_MAX_HEIGHT_CSS = 320;
const MAX_DEVICE_PIXEL_RATIO = 2;

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`${label} phải là số dương hữu hạn.`);
  }
  return parsed;
}

function validateLayout(layout) {
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.positions)) {
    throw new TypeError('Print sheet preview layout không hợp lệ.');
  }
  positiveNumber(layout.paperWidthMm, 'Chiều rộng giấy');
  positiveNumber(layout.paperHeightMm, 'Chiều cao giấy');
  positiveNumber(layout.photoWidthMm, 'Chiều rộng ảnh');
  positiveNumber(layout.photoHeightMm, 'Chiều cao ảnh');
  return layout;
}

function resolveDevicePixelRatio(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, parsed));
}

export function computePrintSheetPreviewGeometry(layout, {
  maxWidthCss = DEFAULT_MAX_WIDTH_CSS,
  maxHeightCss = DEFAULT_MAX_HEIGHT_CSS,
  devicePixelRatio = 1,
} = {}) {
  validateLayout(layout);
  const widthLimit = positiveNumber(maxWidthCss, 'Chiều rộng preview');
  const heightLimit = positiveNumber(maxHeightCss, 'Chiều cao preview');
  const dpr = resolveDevicePixelRatio(devicePixelRatio);
  const cssScale = Math.min(
    widthLimit / layout.paperWidthMm,
    heightLimit / layout.paperHeightMm,
  );
  const cssWidth = Math.max(1, Math.round(layout.paperWidthMm * cssScale));
  const cssHeight = Math.max(1, Math.round(layout.paperHeightMm * cssScale));
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  const scaleX = pixelWidth / layout.paperWidthMm;
  const scaleY = pixelHeight / layout.paperHeightMm;

  return Object.freeze({
    cssWidth,
    cssHeight,
    pixelWidth,
    pixelHeight,
    devicePixelRatio: dpr,
    scaleX,
    scaleY,
    photoWidthPx: layout.photoWidthMm * scaleX,
    photoHeightPx: layout.photoHeightMm * scaleY,
    positions: Object.freeze(layout.positions.map((position) => Object.freeze({
      index: position.index,
      x: position.xMm * scaleX,
      y: position.yMm * scaleY,
      width: position.widthMm * scaleX,
      height: position.heightMm * scaleY,
    }))),
  });
}

function validSourceCanvas(sourceCanvas) {
  return Boolean(
    sourceCanvas
    && Number.isFinite(Number(sourceCanvas.width))
    && Number(sourceCanvas.width) > 0
    && Number.isFinite(Number(sourceCanvas.height))
    && Number(sourceCanvas.height) > 0
  );
}

function drawPreviewCropMarks(ctx, position, layout, geometry) {
  if (layout.gapMm < 1.5) return;
  const gapPx = layout.gapMm * Math.min(geometry.scaleX, geometry.scaleY);
  const offset = Math.max(1, Math.min(3, gapPx / 4));
  const length = Math.max(2, Math.min(7, gapPx / 2));
  const left = position.x - offset;
  const right = position.x + position.width + offset;
  const top = position.y - offset;
  const bottom = position.y + position.height + offset;

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

export function renderPrintSheetPreview(sourceCanvas, layout, {
  canvas,
  drawCropMarks = true,
  maxWidthCss = DEFAULT_MAX_WIDTH_CSS,
  maxHeightCss = DEFAULT_MAX_HEIGHT_CSS,
  devicePixelRatio = 1,
} = {}) {
  validateLayout(layout);
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('Canvas preview không hợp lệ.');
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không tạo được canvas context cho preview tờ in.');

  const geometry = computePrintSheetPreviewGeometry(layout, {
    maxWidthCss,
    maxHeightCss,
    devicePixelRatio,
  });
  canvas.width = geometry.pixelWidth;
  canvas.height = geometry.pixelHeight;
  if (canvas.style) {
    canvas.style.width = `${geometry.cssWidth}px`;
    canvas.style.height = `${geometry.cssHeight}px`;
  }

  const sourceReady = validSourceCanvas(sourceCanvas);
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (const position of geometry.positions) {
    if (sourceReady) {
      ctx.drawImage(
        sourceCanvas,
        position.x,
        position.y,
        position.width,
        position.height,
      );
    } else {
      ctx.fillStyle = '#edf1f6';
      ctx.fillRect(position.x, position.y, position.width, position.height);
      ctx.strokeStyle = 'rgba(102, 116, 138, 0.45)';
      ctx.lineWidth = Math.max(1, geometry.devicePixelRatio);
      ctx.strokeRect(position.x, position.y, position.width, position.height);
    }
  }

  if (drawCropMarks) {
    ctx.strokeStyle = 'rgba(70, 82, 102, 0.65)';
    ctx.lineWidth = Math.max(1, geometry.devicePixelRatio * 0.75);
    ctx.lineCap = 'square';
    for (const position of geometry.positions) {
      drawPreviewCropMarks(ctx, position, layout, geometry);
    }
  }
  ctx.restore();

  if (canvas.dataset) {
    const previousRevision = Number(canvas.dataset.previewRevision) || 0;
    canvas.dataset.previewRevision = String(previousRevision + 1);
    canvas.dataset.previewPaper = String(layout.paperKey ?? '');
    canvas.dataset.previewOrientation = String(layout.orientation ?? '');
    canvas.dataset.previewCopies = String(layout.copies ?? layout.positions.length);
    canvas.dataset.previewColumns = String(layout.columns ?? '');
    canvas.dataset.previewRows = String(layout.rowsUsed ?? '');
    canvas.dataset.previewCropMarks = String(Boolean(drawCropMarks));
    canvas.dataset.previewSource = sourceReady ? 'image' : 'placeholder';
  }

  return Object.freeze({
    ...geometry,
    sourceReady,
    drawCropMarks: Boolean(drawCropMarks),
  });
}

export const PRINT_SHEET_PREVIEW_LIMITS = Object.freeze({
  maxWidthCss: DEFAULT_MAX_WIDTH_CSS,
  maxHeightCss: DEFAULT_MAX_HEIGHT_CSS,
  maxDevicePixelRatio: MAX_DEVICE_PIXEL_RATIO,
});
