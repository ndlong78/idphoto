import { FMTS, state } from './state.js';
import { getControls } from './ui.js';
import {
  FLOOD_FILL_TOLERANCE,
  SKIN_MAX_BLEND,
  SKIN_BLUR_RADIUS_MAX,
} from './constants.js';

// ─── Canvas reuse ─────────────────────────────────────────────────────────────
//
// Thay vì createElement('canvas') mỗi lần renderResult() được gọi
// (gây áp lực GC liên tục khi user kéo slider), ta giữ lại hai canvas:
//   _outCanvas  — canvas đầu ra chính (trả về cho caller)
//   _maskCanvas — canvas nội bộ để composite AI mask
//
// An toàn vì JS single-thread: không bao giờ có hai renderResult() chạy
// song song thực sự. Các caller gọi toDataURL() hoặc drawImage() đồng bộ
// ngay sau khi nhận canvas, trước khi render tiếp theo xảy ra.
// ─────────────────────────────────────────────────────────────────────────────
let _outCanvas  = null;
let _maskCanvas = null;

/** Lấy canvas tái sử dụng với kích thước mong muốn */
function getCanvas(store, w, h) {
  if (!store) store = document.createElement('canvas');
  store.width  = w;
  store.height = h;
  return store;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render ảnh kết quả ở tỉ lệ scale.
 *
 * Được khai báo async để API nhất quán với các caller đã dùng await,
 * và dễ nâng cấp lên OffscreenCanvas + Worker trong tương lai mà không
 * cần thay đổi signature ở caller.
 *
 * @param {number} [scale=1] - 1 = preview/300DPI, 2 = export/600DPI
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

      // FIX: Feather dùng binary mask riêng để chạy distance transform,
      // sau đó NHÂN (không thay thế) alpha gốc ISNet với hệ số feather.
      // Pixel tóc alpha=50 × hệ số 0.8 = 40 — smooth edge của ISNet được giữ nguyên.
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

      // AI mask: alpha cao = foreground (giữ lại pixel ảnh gốc)
      blendAiAlpha(imageData.data, maskData.data, bg);
    }
  } else {
    // Flood fill mask: giá trị cao = background (thay bằng màu nền)
    const mask = floodFill(imageData, FLOOD_FILL_TOLERANCE);
    featherMask(mask, w, h, getControls().feather.valueAsNumber);
    applyFloodFillAlpha(imageData.data, mask, bg);
  }

  applyAdjustments(imageData);
  ctx.putImageData(imageData, 0, 0);
  return _outCanvas;
}

export async function renderToPreview() {
  const preview = document.getElementById('result-canvas');
  const output  = await renderResult(1);
  preview.width  = output.width;
  preview.height = output.height;
  preview.getContext('2d')?.drawImage(output, 0, 0);
}

// ─── Crop geometry ────────────────────────────────────────────────────────────

/**
 * Tính toạ độ vùng cắt từ canvas crop sang toạ độ ảnh gốc.
 *
 * Guard: nếu scale ≤ 0 (state bị corrupt hoặc chưa khởi tạo),
 * trả về toàn bộ frame để tránh division-by-zero gây Infinity/NaN
 * lan sang getImageData và tạo canvas kích thước vô hạn.
 */
function getCropRect() {
  const s = state.crop.scale;
  if (!s || s <= 0) {
    // Fallback an toàn — trả về vùng frame không scaled
    return { x: 0, y: 0, w: state.frame.w || 1, h: state.frame.h || 1 };
  }
  return {
    x: (state.frame.x - state.crop.x) / s,
    y: (state.frame.y - state.crop.y) / s,
    w: state.frame.w / s,
    h: state.frame.h / s,
  };
}

// ─── Mask blending ────────────────────────────────────────────────────────────
//
// Chú ý: hai hàm dưới đây có ngữ nghĩa NGƯỢC NHAU.
// Đặt tên rõ ràng để tránh nhầm lẫn khi maintain:
//
//   blendAiAlpha       — alpha cao = FOREGROUND (giữ pixel ảnh)
//   applyFloodFillAlpha — giá trị cao = BACKGROUND (thay bằng màu nền)

/**
 * Blend AI mask vào ảnh.
 * alpha=255 tại pixel [i] → pixel ảnh gốc được giữ nguyên 100%.
 * alpha=0   tại pixel [i] → pixel được thay hoàn toàn bằng màu nền.
 */
function blendAiAlpha(data, mask, bg) {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = mask[i + 3] / 255;
    const inv   = 1 - alpha;
    data[i]     = Math.round(data[i]     * alpha + bg.r * inv);
    data[i + 1] = Math.round(data[i + 1] * alpha + bg.g * inv);
    data[i + 2] = Math.round(data[i + 2] * alpha + bg.b * inv);
  }
}

/**
 * Áp dụng flood fill mask vào ảnh.
 * mask[i]=255 → pixel là nền → thay bằng bg.
 * mask[i]=0   → pixel là foreground → giữ nguyên.
 *
 * Alpha là mức độ thay thế (0 = giữ nguyên, 255 = thay hoàn toàn).
 */
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

  // 1. Brightness & contrast (formula Photoshop-compatible)
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = clamp(factor * (d[i]     - 128) + 128 + b);
    d[i + 1] = clamp(factor * (d[i + 1] - 128) + 128 + b);
    d[i + 2] = clamp(factor * (d[i + 2] - 128) + 128 + b);
  }

  // 2. Skin smoothing (frequency separation — chạy trước sharpening)
  if (sk > 0) applySkinSmoothing(imageData, sk);

  // 3. Unsharp mask (tăng nét sau khi làm mịn)
  if (s > 0) unsharpMask(imageData, 1.2, s * 1.2);
}

// ─── Unsharp mask (separable) ─────────────────────────────────────────────────
//
// FIX PERFORMANCE: Phiên bản cũ dùng nested loop O(W·H·(2r+1)²).
// Phiên bản mới tái dùng boxBlurRGB (đã separable 2-pass, O(W·H·r)):
//   unsharp = original + (original − blurred) × amount
//
// Kết quả giống nhau về mặt thị giác vì box blur xấp xỉ Gaussian đủ tốt
// cho unsharp mask. Tốc độ cải thiện ~(2r+1)× trên ảnh lớn.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─── Feather mask (distance transform rút gọn) ───────────────────────────────
//
// Với mỗi pixel foreground gần biên, tính khoảng cách Manhattan đến
// pixel background gần nhất (hai lượt quét TL→BR và BR→TL).
// Alpha = clamp(dist / radius, 0, 1) → gradient mịn 0→255.
//
// Export để test có thể kiểm tra trực tiếp.

export function featherMask(mask, W, H, radius) {
  if (radius <= 0) return;

  const dist = new Float32Array(W * H).fill(radius + 1);
  for (let i = 0; i < W * H; i++) {
    if (mask[i] === 0) dist[i] = 0;
  }

  // Pass 1: top-left → bottom-right
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

  // Pass 2: bottom-right → top-left
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (mask[i] === 0) continue;
      if (x < W-1)           dist[i] = Math.min(dist[i], dist[i + 1]     + 1);
      if (y < H-1)           dist[i] = Math.min(dist[i], dist[i + W]     + 1);
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
 * Color distance có trọng số luma (Euclidean sRGB).
 * Export để test kiểm tra ngưỡng FLOOD_FILL_TOLERANCE.
 */
export function colorDistance(a, b) {
  return Math.sqrt(
    (a.r - b.r) ** 2 * 0.299 +
    (a.g - b.g) ** 2 * 0.587 +
    (a.b - b.b) ** 2 * 0.114,
  );
}

// ─── Skin smoothing (Frequency Separation) ───────────────────────────────────
//
// Chiến lược:
//   1. Tạo lớp low-frequency (box blur) của toàn ảnh.
//   2. Với mỗi pixel da, blend pixel gốc với lớp blurred.
//      → Làm phẳng màu sắc (low-freq) nhưng giữ lại một phần kết cấu.
//   3. Sharpening chạy SAU để phục hồi cạnh mắt, tóc, môi.
//
// Skin detection từ chối: nền trắng/xám, tóc tối, mắt tối,
// môi đỏ bão hòa cao, vùng lạnh/xanh.

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
 * Nhận diện màu da — bao phủ từ da nhợt đến da ngăm đậm.
 * Export để test có thể kiểm tra các trường hợp biên.
 *
 * @param {number} r - Red channel [0–255]
 * @param {number} g - Green channel [0–255]
 * @param {number} b - Blue channel [0–255]
 * @returns {boolean}
 */
export function isSkinPixel(r, g, b) {
  if (r < 60 || r > 248) return false;                             // quá tối (tóc/mắt) hoặc quá sáng (nền)
  if (r <= g || r <= b) return false;                              // R phải chiếm ưu thế (ấm)
  if (r - Math.min(g, b) < 20) return false;                      // phải có sắc ấm đủ mạnh
  if (Math.max(r, g, b) - Math.min(r, g, b) < 15) return false;  // không phải xám đều
  if (b > g) return false;                                         // loại màu lạnh/xanh
  if (r > 200 && (r - g) > 80) return false;                      // loại môi/má đỏ bão hòa
  return true;
}

// ─── Box blur (separable H+V pass) ───────────────────────────────────────────
//
// O(W·H·r) — dùng cho cả skin smoothing và unsharpMask.

function boxBlurRGB(src, W, H, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  // Horizontal pass: src → tmp
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

  // Vertical pass: tmp → out
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
 * Clamp giá trị về [0, 255] và làm tròn thành số nguyên.
 * Xử lý NaN → 0 để tránh pixel bị corrupt khi phép tính số học bị lỗi.
 * Export để test đường biên.
 *
 * Tại sao không dùng Math.max/Math.min:
 *   Math.max(0, NaN) = NaN — không giúp ích gì.
 * Trick !(r > 0): NaN > 0 = false → !(false) = true → trả 0. ✓
 */
export function clamp(v) {
  const r = Math.round(v);
  if (!(r > 0)) return 0;   // xử lý NaN, âm, 0
  return r > 255 ? 255 : r;
}
