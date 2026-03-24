import { FMTS, state } from './state.js';
import { getControls } from './ui.js';
import {
  FLOOD_FILL_TOLERANCE,
  SKIN_MAX_BLEND,
  SKIN_BLUR_RADIUS_MAX,
} from './constants.js';

// ─── Canvas reuse ─────────────────────────────────────────────────────────────
let _outCanvas  = null;
let _maskCanvas = null;

// ─── Blur buffer reuse ────────────────────────────────────────────────────────
// FIX [SUGGESTION]: Tái sử dụng Float32Array thay vì cấp phát mới mỗi render.
// Với ảnh 600DPI (1200×1200), mỗi array ~5.5MB — gọi 2 lần/render gây GC pressure.
let _blurTmp = null;
let _blurOut = null;

// ─── Render lock ──────────────────────────────────────────────────────────────
// FIX [CRITICAL]: Ngăn race condition khi renderToPreview() được gọi đồng thời
// từ nhiều nguồn (slider debounce + drag + format change).
// await bên trong renderResult() nhường event loop → hai microtask có thể
// chạy xen kẽ và ghi đồng thời lên cùng _outCanvas/_maskCanvas.
let _renderLock = false;

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
  const fmt = FMTS[state.curFmt];
  const w   = Math.round(fmt.w * scale);
  const h   = Math.round(fmt.h * scale);

  _outCanvas  = getCanvas(_outCanvas,  w, h);
  _maskCanvas = getCanvas(_maskCanvas, w, h);

  const ctx = _outCanvas.getContext('2d');
  if (!ctx || !state.origImg) return _outCanvas;

  const crop = getCropRect();
  ctx.drawImage(state.origImg, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const bg = state.bgColor;

  if (state.aiMaskImg) {
    const mctx = _maskCanvas.getContext('2d');
    if (mctx) {
      mctx.clearRect(0, 0, w, h);
      mctx.drawImage(state.aiMaskImg, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
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

      blendAiAlpha(imageData.data, maskData.data, bg);
    }
  } else {
    const mask = floodFill(imageData, FLOOD_FILL_TOLERANCE);
    featherMask(mask, w, h, getControls().feather.valueAsNumber);
    applyFloodFillAlpha(imageData.data, mask, bg);
  }

  applyAdjustments(imageData);
  ctx.putImageData(imageData, 0, 0);
  return _outCanvas;
}

/**
 * Render ảnh kết quả vào canvas preview (#result-canvas).
 * Có render lock: bỏ qua nếu đang render để tránh race condition.
 *
 * @returns {Promise<void>}
 */
export async function renderToPreview() {
  // FIX [CRITICAL]: Lock để tránh hai render chạy đồng thời trên shared canvas.
  // Nếu đang render, bỏ qua request mới thay vì để chúng xen kẽ nhau.
  if (_renderLock) return;
  _renderLock = true;
  try {
    const preview = document.getElementById('result-canvas');
    const output  = await renderResult(1);
    preview.width  = output.width;
    preview.height = output.height;
    preview.getContext('2d')?.drawImage(output, 0, 0);
  } finally {
    _renderLock = false;
  }
}

// ─── Crop geometry ────────────────────────────────────────────────────────────

/**
 * FIX [WARNING]: Fallback cũ trả về state.frame.w/h (pixel màn hình) như
 * tọa độ ảnh gốc → render sai vùng ảnh.
 * Fallback đúng là toàn bộ ảnh gốc.
 */
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
  const { bright, contrast, sharp, skin } = getControls();
  const b  = bright.valueAsNumber;
  const c  = contrast.valueAsNumber;
  const s  = sharp.valueAsNumber / 100;
  const sk = skin.valueAsNumber;
  const d  = imageData.data;

  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = clamp(factor * (d[i]     - 128) + 128 + b);
    d[i + 1] = clamp(factor * (d[i + 1] - 128) + 128 + b);
    d[i + 2] = clamp(factor * (d[i + 2] - 128) + 128 + b);
  }

  if (sk > 0) applySkinSmoothing(imageData, sk);
  if (s > 0)  unsharpMask(imageData, 1.2, s * 1.2);
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

  while (head < queue.length) {
    const i = queue[head++];
    const x = i % W;
    const y = Math.floor(i / W);
    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    neighbors.forEach(([nx, ny]) => {
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) visit(nx, ny);
    });
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
 * Hỗ trợ nhiều sắc da từ sáng đến tối (Caucasian, East Asian, South Asian, African).
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

// ─── Box blur (separable) — với buffer reuse ──────────────────────────────────

function boxBlurRGB(src, W, H, r) {
  const len = src.length;

  // FIX [SUGGESTION]: Tái sử dụng buffer nếu đủ kích thước,
  // tránh cấp phát ~5.5MB × 2 mỗi lần render ảnh 600DPI.
  if (!_blurTmp || _blurTmp.length < len) _blurTmp = new Float32Array(len);
  if (!_blurOut || _blurOut.length < len) _blurOut = new Float32Array(len);

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
 * NaN và giá trị âm → 0; giá trị > 255 → 255.
 *
 * @param {number} v - Giá trị đầu vào
 * @returns {number} Số nguyên trong [0, 255]
 */
export function clamp(v) {
  const r = Math.round(v);
  if (!(r > 0)) return 0;
  return r > 255 ? 255 : r;
}
