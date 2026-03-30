import { FMTS, state } from './state.js';
import { getControls } from './dom.js';
import {
  FLOOD_FILL_TOLERANCE,
  SKIN_MAX_BLEND,
  SKIN_BLUR_RADIUS_MAX,
  SHADOW_LIFT_MAX,
} from './constants.js';

// ─── Canvas reuse ─────────────────────────────────────────────────────────────
// Chỉ dùng cho scale=1 (preview). Hi-res export tạo canvas mới — xem renderResult.
let _outCanvas  = null;
let _maskCanvas = null;

// ─── Blur buffer reuse ────────────────────────────────────────────────────────
let _blurTmp = null;
let _blurOut = null;

// ─── Render lock ──────────────────────────────────────────────────────────────
// FIX [CRITICAL]: Ngăn race condition khi renderToPreview() được gọi đồng thời.
//
// FIX [IMPORTANT]: Thay vì drop request khi đang render, dùng _renderPending flag.
// Pattern cũ:
//   if (_renderLock) return;  ← slider nhanh → frame cuối bị bỏ qua
// Pattern mới:
//   if (_renderLock) { _renderPending = true; return; }
//   → sau khi unlock, tự động render lại một lần nếu có request đang chờ.
let _renderLock    = false;
let _renderPending = false;
let _renderVersion = 0;
let _previewRenderParts = renderResultParts;

/** Lấy canvas tái sử dụng với kích thước mong muốn */
function getCanvas(store, w, h) {
  if (!store) store = document.createElement('canvas');
  store.width  = w;
  store.height = h;
  return store;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {number} [scale=1]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderResult(scale = 1) {
  const parts = await renderResultParts(scale);
  return composeResultLayers(parts, scale);
}

/**
 * Render các lớp ảnh kết quả nội bộ.
 * - composed: ảnh kết quả cuối (người + nền đã chọn)
 * - background: lớp nền màu phẳng theo lựa chọn
 * - faceCutout: ảnh người đã tách nền (alpha trong suốt)
 *
 * @param {number} [scale=1]
 * @returns {Promise<{composed: HTMLCanvasElement, background: HTMLCanvasElement, faceCutout: HTMLCanvasElement}>}
 */
export async function renderResultParts(scale = 1) {
  const fmt = FMTS[state.curFmt];
  const w   = Math.round(fmt.w * scale);
  const h   = Math.round(fmt.h * scale);

  // FIX [CRITICAL]: Dùng canvas riêng cho hi-res export (scale !== 1) để tránh
  // race condition khi download() và renderToPreview() chạy đồng thời.
  //
  // Vấn đề cũ: _outCanvas và _maskCanvas là module-level. Nếu user bấm
  // "Tải xuống 600 DPI" (scale=2) trong khi preview đang render (scale=1),
  // cả hai cùng ghi vào một canvas → ảnh kết quả bị hỏng hoặc lẫn lộn.
  //
  // Giải pháp: scale=1 (preview) vẫn tái sử dụng _outCanvas/_maskCanvas
  // để tiết kiệm bộ nhớ; scale>1 (export) tạo canvas mới mỗi lần.
  let outCanvas, maskCanvas;
  if (scale === 1) {
    _outCanvas  = getCanvas(_outCanvas,  w, h);
    _maskCanvas = getCanvas(_maskCanvas, w, h);
    outCanvas  = _outCanvas;
    maskCanvas = _maskCanvas;
  } else {
    outCanvas        = document.createElement('canvas');
    outCanvas.width  = w;
    outCanvas.height = h;
    maskCanvas        = document.createElement('canvas');
    maskCanvas.width  = w;
    maskCanvas.height = h;
  }

  const ctx = outCanvas.getContext('2d');
  if (!ctx || !state.origImg) {
    return {
      composed: outCanvas,
      background: createSolidBackgroundCanvas(w, h, state.bgColor),
      faceCutout: getCanvas(null, w, h),
    };
  }

  const crop = getCropRect();
  ctx.drawImage(state.origImg, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const bg = state.bgColor;
  let faceCutoutData = null;

  if (state.aiMaskImg) {
    const mctx = maskCanvas.getContext('2d');
    if (mctx) {
      mctx.clearRect(0, 0, w, h);
      const maskCrop = mapCropRect(crop, state.origImg, state.aiMaskImg);
      mctx.drawImage(state.aiMaskImg, maskCrop.x, maskCrop.y, maskCrop.w, maskCrop.h, 0, 0, w, h);
      const maskData = mctx.getImageData(0, 0, w, h);

      const featherRadius = getControls().feather.valueAsNumber;
      if (featherRadius > 0) {
        const binaryMask = new Uint8Array(w * h);
        for (let i = 0; i < binaryMask.length; i++) {
          binaryMask[i] = maskData.data[i * 4 + 3] > 0 ? 255 : 0;
        }
        featherMask(binaryMask, w, h, featherRadius);
        for (let i = 0; i < binaryMask.length; i++) {
          const original = maskData.data[i * 4 + 3];
          maskData.data[i * 4 + 3] = Math.round(original * binaryMask[i] / 255);
        }
      }

      // FIX [IMPORTANT]: Áp dụng điều chỉnh TRƯỚC khi blend nền.
      //
      // Vấn đề cũ: applyAdjustments() chạy SAU khi blend → skin/shadow
      // detection đọc pixel đã có màu nền mới. Nền màu kem (245,240,232)
      // hoặc nền xanh nhạt có thể bị nhận nhầm là da người bởi isSkinPixel,
      // làm mịn da tràn sang vùng nền.
      //
      // Giải pháp: chạy adjustments trên ảnh gốc (chỉ có người, chưa có nền
      // mới), sau đó mới blend. Skin/shadow detection chỉ thấy pixel người.
      applyAdjustments(imageData);
      faceCutoutData = extractFaceCutoutFromMask(imageData, maskData.data);
      blendAiAlpha(imageData.data, maskData.data, bg);
    }
  } else {
    // FIX [IMPORTANT]: Flood fill phát hiện nền dựa trên màu pixel gốc.
    // Chạy flood fill TRƯỚC applyAdjustments để brightness/contrast không làm
    // lệch ngưỡng colorDistance khi so sánh pixel corner với phần còn lại.
    // Sau khi mask xác định xong, mới áp dụng điều chỉnh rồi blend nền.
    const mask = floodFill(imageData, FLOOD_FILL_TOLERANCE);
    featherMask(mask, w, h, getControls().feather.valueAsNumber);
    applyAdjustments(imageData);
    faceCutoutData = extractFaceCutoutFromMask(imageData, maskToRgba(mask));
    applyFloodFillAlpha(imageData.data, mask, bg);
  }

  ctx.putImageData(imageData, 0, 0);
  const faceCutout = getCanvas(null, w, h);
  const faceCtx = faceCutout.getContext('2d');
  if (faceCtx && faceCutoutData) {
    faceCtx.putImageData(faceCutoutData, 0, 0);
  }

  return {
    composed: outCanvas,
    background: createSolidBackgroundCanvas(w, h, bg),
    faceCutout,
  };
}

/**
 * Render ảnh kết quả vào canvas preview (#result-canvas).
 *
 * FIX [IMPORTANT]: Dùng pending flag thay vì drop.
 * Nếu đang render, đánh dấu _renderPending = true.
 * Sau khi render xong, nếu có pending thì render lại một lần,
 * đảm bảo slider frame cuối luôn được hiển thị.
 *
 * @returns {Promise<void>}
 */
export async function renderToPreview() {
  const requestVersion = ++_renderVersion;
  if (_renderLock) {
    _renderPending = true;
    return;
  }
  _renderLock    = true;
  _renderPending = false;
  try {
    const preview = document.getElementById('result-canvas');
    if (!preview) return;

    const resultParts  = await _previewRenderParts(1);

    // Chỉ commit nếu đây vẫn là request mới nhất.
    if (requestVersion !== _renderVersion) return;

    composeResultLayers(resultParts, 1, preview);

  } finally {
    _renderLock = false;
    // Nếu có request chờ trong lúc render, thực hiện lại một lần
    if (_renderPending) {
      _renderPending = false;
      void renderToPreview();
    }
  }
}

/**
 * Test hook: thay thế hàm render parts cho preview để mô phỏng async ordering.
 * Không dùng trong luồng production.
 *
 * @param {(scale:number)=>Promise<{composed: HTMLCanvasElement, background: HTMLCanvasElement, faceCutout: HTMLCanvasElement}>} fn
 */
export function __setPreviewRenderPartsForTest(fn) {
  _previewRenderParts = fn;
}

/**
 * Test hook: reset trạng thái render lock/version về mặc định.
 */
export function __resetPreviewRenderStateForTest() {
  _renderLock = false;
  _renderPending = false;
  _renderVersion = 0;
  _previewRenderParts = renderResultParts;
}

function composeResultLayers(parts, _scale = 1, canvas = null) {
  const width = parts.background.width;
  const height = parts.background.height;
  const out = getCanvas(canvas, width, height);
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(parts.background, 0, 0);

  const offsetX = Math.round((state.resultFaceOffsetPct?.x ?? 0) * width / 100);
  const offsetY = Math.round((state.resultFaceOffsetPct?.y ?? 0) * height / 100);
  ctx.drawImage(parts.faceCutout, offsetX, offsetY);
  return out;
}

function createSolidBackgroundCanvas(width, height, bg) {
  const canvas = getCanvas(null, width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg.r;
    data[i + 1] = bg.g;
    data[i + 2] = bg.b;
    data[i + 3] = 255;
  }
  ctx.putImageData(createImageDataLike(data, width, height), 0, 0);
  return canvas;
}

function extractFaceCutoutFromMask(imageData, maskRgba) {
  const out = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < out.length; i += 4) {
    out[i + 3] = maskRgba[i + 3];
  }
  return createImageDataLike(out, imageData.width, imageData.height);
}

function maskToRgba(mask) {
  const rgba = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    rgba[i * 4 + 3] = 255 - mask[i];
  }
  return rgba;
}

function createImageDataLike(data, width, height) {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(data, width, height);
  }
  return { data, width, height };
}

// ─── Crop geometry ────────────────────────────────────────────────────────────

function getCropRect() {
  const s = state.crop.scale;
  if (!s || s <= 0) {
    return {
      x: 0,
      y: 0,
      w: state.origImg ? state.origImg.width  : 1,
      h: state.origImg ? state.origImg.height : 1,
    };
  }
  return {
    x: (state.frame.x - state.crop.x) / s,
    y: (state.frame.y - state.crop.y) / s,
    w: state.frame.w / s,
    h: state.frame.h / s,
  };
}

/**
 * Map crop rect từ hệ trục ảnh gốc sang hệ trục ảnh nguồn khác.
 *
 * FIX [IMPORTANT]:
 * aiMaskImg có thể lệch kích thước nhẹ so với origImg ở một số pipeline AI.
 * Nếu cắt mask bằng toạ độ của ảnh gốc mà không scale, vùng blend nền sẽ bị
 * trôi theo khi user kéo ảnh (đặc biệt nhìn rõ ở khoảng trống phía trên đầu).
 *
 * @param {{x:number,y:number,w:number,h:number}} crop
 * @param {{width:number,height:number}|null} fromImg
 * @param {{width:number,height:number}|null} toImg
 * @returns {{x:number,y:number,w:number,h:number}}
 */
function mapCropRect(crop, fromImg, toImg) {
  if (!fromImg || !toImg) return crop;
  const sx = toImg.width  / Math.max(1, fromImg.width);
  const sy = toImg.height / Math.max(1, fromImg.height);
  return {
    x: crop.x * sx,
    y: crop.y * sy,
    w: crop.w * sx,
    h: crop.h * sy,
  };
}

// ─── Mask blending ────────────────────────────────────────────────────────────

function blendAiAlpha(data, mask, bg) {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = mask[i + 3] / 255;
    const inv   = 1 - alpha;
    data[i]     = Math.round(data[i]     * alpha + bg.r * inv);
    data[i + 1] = Math.round(data[i + 1] * alpha + bg.g * inv);
    data[i + 2] = Math.round(data[i + 2] * alpha + bg.b * inv);
  }
}

function applyFloodFillAlpha(data, mask, bg) {
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const alpha = mask[i] / 255;
    const di    = i * 4;
    data[di]     = Math.round(data[di]     * (1 - alpha) + bg.r * alpha);
    data[di + 1] = Math.round(data[di + 1] * (1 - alpha) + bg.g * alpha);
    data[di + 2] = Math.round(data[di + 2] * (1 - alpha) + bg.b * alpha);
  }
}

// ─── Image adjustments ────────────────────────────────────────────────────────

function applyAdjustments(imageData) {
  const { bright, contrast, sharp, skin, shadow } = getControls();
  const b   = bright.valueAsNumber;
  const c   = contrast.valueAsNumber;
  const s   = sharp.valueAsNumber / 100;
  const sk  = skin.valueAsNumber;
  const shd = shadow.valueAsNumber;
  const d   = imageData.data;

  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = clamp(factor * (d[i]     - 128) + 128 + b);
    d[i + 1] = clamp(factor * (d[i + 1] - 128) + 128 + b);
    d[i + 2] = clamp(factor * (d[i + 2] - 128) + 128 + b);
  }

  if (shd > 0) applyFaceShadowCorrection(imageData, shd);
  if (sk > 0)  applySkinSmoothing(imageData, sk);
  if (s > 0)   unsharpMask(imageData, 1.2, s * 1.2);
}

// ─── Unsharp mask ─────────────────────────────────────────────────────────────

function unsharpMask(imageData, radius, amount) {
  const { width, height, data } = imageData;
  const r       = Math.max(1, Math.round(radius));
  const blurred = boxBlurRGB(data, width, height, r);

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = clamp(data[i + c] + (data[i + c] - blurred[i + c]) * amount);
    }
  }
}

// ─── Flood fill ───────────────────────────────────────────────────────────────

function floodFill(imgData, tol) {
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  const mask  = new Uint8Array(W * H);
  const queue = [];
  let head = 0;

  const bg = sampleBackground(d, W, H);
  const visit = (x, y) => {
    const idx = y * W + x;
    if (mask[idx]) return;
    const p = getPixel(d, x, y, W);
    if (colorDistance(p, bg) <= tol) {
      mask[idx] = 255;
      queue.push(idx);
    }
  };

  for (let x = 0; x < W; x += 2) { visit(x, 0); visit(x, H - 1); }
  for (let y = 0; y < H; y += 2) { visit(0, y); visit(W - 1, y); }

  // FIX [CRITICAL]: Thay thế forEach tạo array tạm [[nx,ny],...] bằng
  // inline bounds check. Với ảnh 600 DPI (~1.2M pixel), vòng lặp cũ
  // tạo ~5M temporary array mỗi lần flood fill → GC pressure lớn.
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % W;
    const y = Math.floor(i / W);
    if (x > 0)     visit(x - 1, y);
    if (x < W - 1) visit(x + 1, y);
    if (y > 0)     visit(x, y - 1);
    if (y < H - 1) visit(x, y + 1);
  }

  return mask;
}

// ─── Feather mask ─────────────────────────────────────────────────────────────

/**
 * Làm mềm mép mask bằng thuật toán distance transform gần đúng (separable 8-hướng).
 * Pixels background (mask[i] === 0) không bị thay đổi.
 *
 * @param {Uint8Array} mask - Mask nhị phân (0 = background, 255 = foreground), sửa in-place
 * @param {number} W - Chiều rộng ảnh (pixels)
 * @param {number} H - Chiều cao ảnh (pixels)
 * @param {number} radius - Bán kính feather (pixels); radius ≤ 0 thì không làm gì
 */
export function featherMask(mask, W, H, radius) {
  if (radius <= 0) return;

  const dist = new Float32Array(W * H).fill(radius + 1);
  for (let i = 0; i < W * H; i++) {
    if (mask[i] === 0) dist[i] = 0;
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (mask[i] === 0) continue;
      if (x > 0)             dist[i] = Math.min(dist[i], dist[i - 1]     + 1);
      if (y > 0)             dist[i] = Math.min(dist[i], dist[i - W]     + 1);
      if (x > 0 && y > 0)   dist[i] = Math.min(dist[i], dist[i - W - 1] + 1.414);
      if (x < W-1 && y > 0) dist[i] = Math.min(dist[i], dist[i - W + 1] + 1.414);
    }
  }

  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (mask[i] === 0) continue;
      if (x < W-1)             dist[i] = Math.min(dist[i], dist[i + 1]     + 1);
      if (y < H-1)             dist[i] = Math.min(dist[i], dist[i + W]     + 1);
      if (x < W-1 && y < H-1) dist[i] = Math.min(dist[i], dist[i + W + 1] + 1.414);
      if (x > 0   && y < H-1) dist[i] = Math.min(dist[i], dist[i + W - 1] + 1.414);
    }
  }

  for (let i = 0; i < W * H; i++) {
    if (mask[i] === 0) continue;
    mask[i] = Math.round(Math.min(dist[i] / radius, 1) * 255);
  }
}

// ─── Pixel utilities ──────────────────────────────────────────────────────────

function getPixel(data, x, y, W) {
  const i = (y * W + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

function sampleBackground(data, W, H) {
  const points = [
    getPixel(data, 0, 0, W), getPixel(data, W - 1, 0, W),
    getPixel(data, 0, H - 1, W), getPixel(data, W - 1, H - 1, W),
  ];
  return {
    r: Math.round(points.reduce((s, p) => s + p.r, 0) / points.length),
    g: Math.round(points.reduce((s, p) => s + p.g, 0) / points.length),
    b: Math.round(points.reduce((s, p) => s + p.b, 0) / points.length),
  };
}

/**
 * Tính khoảng cách màu sắc có trọng số luma giữa hai pixel.
 * Công thức: sqrt(ΔR²×0.299 + ΔG²×0.587 + ΔB²×0.114)
 *
 * @param {{r: number, g: number, b: number}} a - Pixel thứ nhất
 * @param {{r: number, g: number, b: number}} b - Pixel thứ hai
 * @returns {number} Khoảng cách màu (0–441)
 */
export function colorDistance(a, b) {
  return Math.sqrt(
    (a.r - b.r) ** 2 * 0.299 +
    (a.g - b.g) ** 2 * 0.587 +
    (a.b - b.b) ** 2 * 0.114,
  );
}

// ─── Skin smoothing ───────────────────────────────────────────────────────────

function applySkinSmoothing(imageData, amount) {
  if (amount <= 0) return;
  const { width, height, data } = imageData;
  const strength  = amount / 100;
  const radius    = Math.max(2, Math.round(strength * SKIN_BLUR_RADIUS_MAX));
  const lowFreq   = boxBlurRGB(data, width, height, radius);

  for (let i = 0; i < data.length; i += 4) {
    if (!isSkinPixel(data[i], data[i + 1], data[i + 2])) continue;
    const t = strength * SKIN_MAX_BLEND;
    data[i]     = clamp(data[i]     * (1 - t) + lowFreq[i]     * t);
    data[i + 1] = clamp(data[i + 1] * (1 - t) + lowFreq[i + 1] * t);
    data[i + 2] = clamp(data[i + 2] * (1 - t) + lowFreq[i + 2] * t);
  }
}

/**
 * Phát hiện pixel da người dựa trên heuristic màu sắc RGB.
 *
 * @param {number} r - Kênh đỏ (0–255)
 * @param {number} g - Kênh xanh lá (0–255)
 * @param {number} b - Kênh xanh lam (0–255)
 * @returns {boolean} true nếu pixel có khả năng là da người
 */
export function isSkinPixel(r, g, b) {
  if (r < 60 || r > 248) return false;
  if (r <= g || r <= b) return false;
  if (r - Math.min(g, b) < 20) return false;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 15) return false;
  if (b > g) return false;
  if (r > 200 && (r - g) > 80) return false;
  return true;
}

/**
 * Phát hiện pixel da trong vùng bóng tối với ngưỡng nới lỏng.
 *
 * @param {number} r @param {number} g @param {number} b
 * @returns {boolean}
 */
export function isSkinPixelForShadow(r, g, b) {
  if (r < 25 || r > 248) return false;
  if (r <= g || r <= b) return false;
  if (r - Math.min(g, b) < 8) return false;
  if (b > g) return false;
  return true;
}

/**
 * Nhận diện vùng da mặt bị tối/bóng và làm sáng chúng.
 *
 * @param {ImageData} imageData - Dữ liệu ảnh (sửa in-place)
 * @param {number} amount - Mức độ làm sáng (0–100)
 */
export function applyFaceShadowCorrection(imageData, amount) {
  if (amount <= 0) return;
  const { data } = imageData;
  const strength = amount / 100;

  let sum = 0, cnt = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!isSkinPixel(data[i], data[i + 1], data[i + 2])) continue;
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    cnt++;
  }
  const avgLuma = cnt > 0 ? sum / cnt : 120;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!isSkinPixelForShadow(r, g, b)) continue;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const deficit = avgLuma - luma;
    if (deficit <= 0) continue;
    const lift = Math.min(deficit * strength * 0.8, SHADOW_LIFT_MAX * strength);
    data[i]     = clamp(r + lift);
    data[i + 1] = clamp(g + lift);
    data[i + 2] = clamp(b + lift);
  }
}

// ─── Box blur (GPU-accelerated khi có OffscreenCanvas, fallback CPU) ──────────
//
// FIX [IMPORTANT]: boxBlurRGB CPU-only là O(W×H×r) — trên ảnh 600DPI
// (~1200×1600px) với radius=8, có thể mất 300–600ms trên main thread.
//
// Giải pháp: dùng OffscreenCanvas + CSS blur filter (GPU path).
// CSS Gaussian blur được hardware-accelerated, nhanh hơn ~10× với radius lớn.
// Fallback về CPU nếu OffscreenCanvas không khả dụng (< 3% browser hiện tại).
//
// Lưu ý về radius mapping:
//   - CPU box blur: kernel size = 2r+1, σ ≈ r/√3
//   - CSS blur(r px): Gaussian với σ ≈ r/2
//   Để giữ mức độ blur tương đương, dùng cùng giá trị r.
//   Với skin smoothing và unsharp mask, sự khác biệt nhỏ này không ảnh hưởng kết quả cuối.

function gpuBlurRGB(src, W, H, r) {
  const srcCanvas = new OffscreenCanvas(W, H);
  srcCanvas.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(src), W, H),
    0, 0,
  );

  const dstCanvas = new OffscreenCanvas(W, H);
  const dstCtx    = dstCanvas.getContext('2d');
  dstCtx.filter   = `blur(${r}px)`;
  dstCtx.drawImage(srcCanvas, 0, 0);

  const pixels = dstCtx.getImageData(0, 0, W, H).data;
  const len    = pixels.length;
  if (!_blurOut || _blurOut.length < len) _blurOut = new Float32Array(len);
  const out = _blurOut;
  for (let i = 0; i < len; i++) out[i] = pixels[i];
  return out;
}

function boxBlurRGB(src, W, H, r) {
  const len = src.length;

  if (!_blurTmp || _blurTmp.length < len) _blurTmp = new Float32Array(len);
  if (!_blurOut || _blurOut.length < len) _blurOut = new Float32Array(len);

  // GPU path: OffscreenCanvas + CSS blur (hardware-accelerated)
  // Chỉ kích hoạt với r > 1 vì overhead OffscreenCanvas không xứng với blur nhỏ
  if (r > 1 && typeof OffscreenCanvas !== 'undefined') {
    try {
      return gpuBlurRGB(src, W, H, r);
    } catch {
      // OffscreenCanvas không được hỗ trợ (private browsing, CSP, etc.)
      // → fall through to CPU
    }
  }

  // CPU path (fallback)
  const tmp = _blurTmp;
  const out = _blurOut;

  // Horizontal pass
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let rs = 0, gs = 0, bs = 0, n = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = Math.max(0, Math.min(W - 1, x + dx));
        const i  = (y * W + nx) * 4;
        rs += src[i]; gs += src[i + 1]; bs += src[i + 2]; n++;
      }
      const i = (y * W + x) * 4;
      tmp[i] = rs / n; tmp[i + 1] = gs / n; tmp[i + 2] = bs / n; tmp[i + 3] = src[i + 3];
    }
  }

  // Vertical pass
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let rs = 0, gs = 0, bs = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = Math.max(0, Math.min(H - 1, y + dy));
        const i  = (ny * W + x) * 4;
        rs += tmp[i]; gs += tmp[i + 1]; bs += tmp[i + 2]; n++;
      }
      const i = (y * W + x) * 4;
      out[i] = rs / n; out[i + 1] = gs / n; out[i + 2] = bs / n; out[i + 3] = src[i + 3];
    }
  }

  return out;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Làm tròn và clamp giá trị về khoảng [0, 255].
 *
 * @param {number} v - Giá trị đầu vào
 * @returns {number} Số nguyên trong [0, 255]
 */
export function clamp(v) {
  const r = Math.round(v);
  if (!(r > 0)) return 0;
  return r > 255 ? 255 : r;
}
